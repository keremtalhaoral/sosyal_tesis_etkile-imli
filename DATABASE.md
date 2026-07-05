# Merkezi Veri Mimarisi (DDIA Tabanlı Tasarım)

Bu doküman, projenin veri katmanının neden ve nasıl merkezileştirildiğini açıklar.
Rehber kaynak: **Designing Data-Intensive Applications (Martin Kleppmann)** — aşağıda
her karar ilgili DDIA bölümüne bağlanmıştır.

## Önceki Durum: Üç Kopya, Sıfır Tutarlılık

| Konum | Saklama biçimi | İçerik | Sorun |
|---|---|---|---|
| `backend/db.js` | JS kodu içine gömülü sabitler | 30 tesis, ilçe nüfusları | Kalıcılık yok: sunucu kapanınca yeni veri kaybolur |
| `advanced-gis/data/database.db` | Ayrı SQLite | Sadece 10 tesis, 2 kullanıcı | Ana veriyle kopuk, git'e commit edilmiş türetilmiş binary |
| `docs/app.js` (GitHub Pages) | Tarayıcı `localStorage` | Kendi mock kopyası | Cihaza hapsolmuş, diğerleriyle senkronsuz |

Aynı kavramsal veri üç yerde, üç biçimde ve üç farklı içerikle yaşıyordu.
DDIA'nın deyimiyle klasik bir **çift-yazma (dual write) tutarsızlığı**: hangisi doğru bilinemez.

## Yeni Durum: Tek Gerçek Kaynak

```
data/
├── seed.json    <- KANONİK VERİ (git'te; elle düzenlenir; tüm servisler buradan tohumlar)
└── app.db       <- ÇALIŞMA ZAMANI VERİTABANI (git'te DEĞİL; seed + kullanıcı yazmalarından türer)

backend/  (Node/Express)  ──┐
                            ├──> data/app.db  (paylaşılan SQLite, WAL modu)
advanced-gis/  (Python)   ──┘

docs/  (GitHub Pages)     ──> statik/serverless olduğu için localStorage'da
                              seed'in TÜRETİLMİŞ bir kopyasını kullanır (çevrimdışı replika)
```

- **Yeni veriler** (rezervasyonlar, yeni tesisler, kullanıcılar) artık tek yere yazılır: `data/app.db`.
- Node backend ve Python advanced-gis servisi **aynı dosyayı, aynı şemayla** kullanır.
- Parola hash'i (PBKDF2-HMAC-SHA256, 100k iterasyon) ve JWT (HS256) iki dilde **bit-uyumludur**;
  bir serviste açılan hesapla diğerine giriş yapılabilir.

## Kararlar ve DDIA Gerekçeleri

### 1. Neden SQLite? (Bölüm 3 — Storage and Retrieval)
Tek düğüm, düşük yazma hacmi, ilişkisel veri. Bu profil için sunucusuz, ACID garantili,
gömülü bir B-tree veritabanı doğru araçtır. Node 22'nin yerleşik `node:sqlite` modülü
sayesinde sıfır dış bağımlılıkla çalışır. README'deki PostgreSQL + PostGIS hedefi geçerliliğini
korur; geçiş yolu aşağıda.

### 2. Dayanıklılık: WAL modu (Bölüm 7 — Transactions / Bölüm 3 — WAL)
`PRAGMA journal_mode = WAL`: onaylanmış her yazma önce log'a gider; süreç çökse bile
commit edilmiş veri kaybolmaz, okuyucular yazıcıyı bloklamaz. Restart sonrası veri
kalıcılığı testle doğrulanmıştır.

### 3. Atomik transaction'lar (Bölüm 7 — ACID)
Rezervasyon oluşturma = kapasite kontrolü + doluluk güncellemesi + kayıt ekleme,
**tek transaction**. Herhangi bir adım başarısız olursa tamamı geri alınır — doluluk oranı
ile rezervasyon kayıtları asla birbirinden kopamaz. (`backend/db.js -> createReservation`,
`advanced-gis/app/models.py -> create_reservation`)

### 4. Kısıtlar: geçersiz durumu imkânsız kıl (Bölüm 7 — invariants)
Uygulama koduna güvenmek yerine invariant'lar veritabanı seviyesinde zorlanır:
- `UNIQUE (user_id, facility_id, reserve_date, reserve_time)` -> çifte rezervasyon imkânsız
- `CHECK (capacity > 0)`, `CHECK (occupancy BETWEEN 0 AND 100)`, koordinat aralık kontrolleri
- `FOREIGN KEY ... ON DELETE CASCADE` -> tesis silinince yetim rezervasyon kalmaz

### 5. Şema evrimi: versiyonlu migration (Bölüm 4 — Encoding and Evolution)
`schema_migrations` tablosu hangi şema versiyonunun uygulandığını izler
(`backend/database.js -> MIGRATIONS`). Gelecekte kolon eklemek = yeni migration eklemek;
mevcut veritabanları güvenle ileri taşınır.

### 6. İndeksler sorgu desenine göre (Bölüm 3 — B-tree indexes)
- `idx_reservations_user` -> "kullanıcının rezervasyonları" sorgusu
- `idx_reservations_facility_date` -> "tesisin o günkü rezervasyonları" sorgusu
- `users.username` ve `facilities.kod` UNIQUE indeksleri -> login ve kod bazlı erişim

### 7. Kanonik seed + türetilmiş veri ayrımı (Bölüm 11 — Derived Data)
- `data/seed.json` = kayıt sistemi öncesi kanonik başlangıç verisi (git'te, insan-okur)
- `data/app.db` = türetilmiş + kullanıcı üretimi veri (git'te değil; `.gitignore`)
- Seed **idempotenttir** (`INSERT OR IGNORE`): tekrar çalıştırmak veriyi bozmaz.
- Eski `advanced-gis/data/database.db` git geçmişinden çıkarıldı — türetilmiş binary
  dosyalar versiyon kontrolüne girmez.

### 8. GeoJSON neden veritabanında değil?
İlçe sınırları (3.7MB geometri) salt-okunur **referans verisidir** ve SQLite'ta mekânsal
olarak sorgulanamaz. Değişebilen demografi (nüfus) DB'ye taşındı (`districts` tablosu);
geometri dosyada kaldı. PostGIS'e geçişte geometri `geometry` kolonuna yüklenir.

## GitHub Pages (docs/) Neden Hâlâ localStorage?
Pages statik hosting'dir; sunucu süreci çalıştıramaz. `docs/app.js` bu yüzden seed verisinin
tarayıcı içi **çevrimdışı replikasını** kullanır. Bu bilinçli bir "derived data" kararıdır:
kanonik kaynak `data/seed.json`'dır, Pages kopyası ondan türetilir ve sunum/demo amaçlıdır.

Uygulanışı (`docs/app.js -> bootstrapCentralSeed`):
- Sayfa açılışında `docs/data/seed.json` (kanonik seed'in kopyası) fetch edilir ve
  localStorage replikası tohumlanır - koda gömülü 10 tesislik eski mock kaldırıldı,
  Pages artık merkezi 30 tesislik veriyle birebir aynıdır.
- `mufettis_seed_version` anahtarı ile versiyon takibi yapılır: seed.json'da `version`
  yükseltilirse ziyaretçilerin eski replikası otomatik yenilenir (rezervasyonlardan
  hâlâ geçerli tesise ait olanlar korunur). Türetilmiş veri her zaman kaynaktan
  yeniden inşa edilebilir (DDIA Bölüm 11).
- `data/seed.json` değiştiğinde `docs/data/seed.json`'a kopyalanmalı ve `version`
  artırılmalıdır: `cp data/seed.json docs/data/seed.json`
- Leaflet ve Turf.js kütüphaneleri CDN yerine `docs/vendor/` altına alındı: site,
  unpkg/jsdelivr erişimi olmayan ağlarda da (kurum ağı, çevrimdışı demo) çalışır.
  Varsayılan Pages girişleri: `admin/adminpassword`, `user/userpassword`.

## PostgreSQL + PostGIS'e Geçiş Yolu
1. Şema birebir taşınır (tipler zaten uyumlu; `TEXT` tarihler `date`/`time` olur).
2. `facilities(lat,lng)` -> `geometry(Point, 4326)` kolonu; GeoJSON ilçeler `districts.geom`'a yüklenir.
3. `backend/db.js` içindeki JS mekânsal fonksiyonları SQL'e çevrilir (kodda karşılıkları yorum
   olarak hazır): ray-casting -> `ST_Contains`, Haversine -> `ST_Distance`, KNN sıralama -> `<->` operatörü.
4. Replikasyon/eşzamanlılık ihtiyacı doğduğunda (DDIA Bölüm 5) tek-lider replikasyon yeterlidir.

## Çalıştırma

```bash
# Node backend (ilk açılışta migration + seed otomatik)
cd backend && npm install && npm start        # http://localhost:8085

# Python advanced-gis (aynı veritabanını kullanır)
cd advanced-gis && python3 scripts/seed.py    # idempotent
python3 server.py

# Veri katmanı testleri (geçici DB ile, gerçek veriye dokunmaz)
node backend/test-db.js
```

### Yeni API uçları (Node backend)
| Metod | Yol | Auth | Açıklama |
|---|---|---|---|
| POST | `/api/auth/register` | - | Kayıt; token döner |
| POST | `/api/auth/login` | - | Giriş; token döner |
| GET | `/api/reservations` | Bearer | Kullanıcının rezervasyonları |
| POST | `/api/reservations` | Bearer | Rezervasyon (atomik; çifte kayıt 409) |
| POST | `/api/facilities` | admin | Yeni tesis (kalıcı) |
| PATCH | `/api/facilities/:id` | admin | Doluluk güncelle |
| DELETE | `/api/facilities/:id` | admin | Tesis sil (cascade) |

Varsayılan kullanıcılar (`data/seed.json`): `admin/adminpassword`, `user/userpassword`.
