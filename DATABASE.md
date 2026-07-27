# Merkezi Veri Mimarisi (DDIA Tabanlı Tasarım)

Bu doküman, projenin veri katmanının neden ve nasıl kurulduğunu açıklar.
Rehber kaynak: **Designing Data-Intensive Applications (Martin Kleppmann)** — aşağıda
her karar ilgili DDIA bölümüne bağlanmıştır.

> **Platform:** PostgreSQL 16 + PostGIS 3.4. Proje SQLite ile başladı; geçişin gerekçesi,
> ölçülen kazançları ve **bedeli** [ADR-009](docs/adr/ADR-009-postgresql-postgis.md)'da.

## Önceki Durum: Üç Kopya, Sıfır Tutarlılık

| Konum | Saklama biçimi | İçerik | Sorun |
|---|---|---|---|
| `backend/db.js` | JS koduna gömülü sabitler | 30 tesis, ilçe nüfusları | Kalıcılık yok: sunucu kapanınca yeni veri kaybolur |
| İkinci bir SQLite (ayrı kopya) | Ayrı SQLite | Sadece 10 tesis, 2 kullanıcı | Ana veriyle kopuk, git'e commit edilmiş türetilmiş binary |
| `docs/app.js` (GitHub Pages) | Tarayıcı `localStorage` | Kendi mock kopyası | Cihaza hapsolmuş, diğerleriyle senkronsuz |

Aynı kavramsal veri üç yerde, üç biçimde ve üç farklı içerikle yaşıyordu.
DDIA'nın deyimiyle klasik bir **çift-yazma (dual write) tutarsızlığı**: hangisi doğru bilinemez.

## Yeni Durum: Tek Gerçek Kaynak

```
data/seed.json          <- KANONİK BAŞLANGIÇ VERİSİ (git'te; elle düzenlenir)
docs/data/
  istanbul-districts.geojson  <- ilçe geometrisi (git'te; Pages de aynı dosyayı okur)

        │  npm start (migration + seed)        │  npm run db:load-geo
        v                                      v
PostgreSQL 16 + PostGIS  ────────────────────────────────  tek gerçek kaynak
        ^
backend/ (Node/Express + pg)  ──> API, port 8085

docs/ (GitHub Pages)  ──> sunucusuz: seed.json'ın localStorage replikası
                          + analytics.json snapshot (türetilmiş)
```

- **Yeni veriler** (rezervasyon, sipariş, tesis, kullanıcı) tek yere yazılır: veritabanı.
- Parola hash'i (PBKDF2-HMAC-SHA256, **600.000 iterasyon**, kullanıcı başına rastgele salt,
  PHC formatı) ve JWT (HS256) `backend/security.js` + `backend/database.js` içinde.

## Kararlar ve DDIA Gerekçeleri

### 1. Neden PostgreSQL + PostGIS? (Bölüm 3 — Storage and Retrieval)
Proje bir **Web GIS** projesi; mekansal sorgu birinci sınıf ihtiyaç. SQLite bunları
yapamadığı için point-in-polygon, mesafe ve KNN JS'te elle yazılmıştı. PostGIS ile bunlar
indeksli SQL oldu. İkinci sebep eşzamanlılık (aşağıda Karar 3). Bedeli — `pg` bağımlılığı
ve çalışan bir sunucu — ADR-009'da açıkça kabul ediliyor.

### 2. Dayanıklılık: WAL + fsync (Bölüm 7 — Transactions)
PostgreSQL onaylanmış her yazmayı önce write-ahead log'a yazar; süreç çökse bile commit
edilmiş veri kaybolmaz.

### 3. Atomik transaction + DOĞRU İZOLASYON (Bölüm 7 — ACID, 7.2.3 — Write Skew)
Rezervasyon = kapasite kontrolü + kayıt ekleme, **tek transaction**. Ama PostgreSQL çok
yazıcılı olduğu için atomiklik TEK BAŞINA yetmez: varsayılan READ COMMITTED altında iki
işlem aynı `SUM(guests)`'i okuyup ikisi de yazabilir (**write skew**).

`transaction()` bu yüzden **SERIALIZABLE** açar ve `40001`'de yeniden dener.

Ölçüm (`npm test` içinde, 40 paralel worker / kapasite 10):

| Yol | Sonuç |
|---|---|
| READ COMMITTED | 18-22 rezervasyon → **overbook** |
| Transaction dışı oku-sonra-yaz | 18-26 rezervasyon → **overbook** |
| **SERIALIZABLE + retry** | **tam 10** → doğru |

### 4. Kısıtlar: geçersiz durumu imkânsız kıl (Bölüm 7 — invariants)
- `UNIQUE (user_id, facility_id, reserve_date, reserve_time)` → çifte rezervasyon imkânsız
- `CHECK (capacity > 0)`, `CHECK (manual_occupancy BETWEEN 0 AND 100)`, koordinat aralıkları
- `FOREIGN KEY ... ON DELETE CASCADE` → tesis silinince yetim rezervasyon kalmaz
- **Gerçek tipler:** `reserve_date date`, `reserve_time time` → `'2027-13-45'` gibi imkansız
  tarihler veritabanı seviyesinde reddedilir (SQLite'ta TEXT olduğu için kabul ediliyordu)
- `facilities.geom` **GENERATED ALWAYS AS ... STORED** → geometri lat/lng ile asla ayrışamaz

### 5. Şema evrimi: versiyonlu migration (Bölüm 4 — Encoding and Evolution)
`schema_migrations` tablosu hangi sürümün uygulandığını izler
(`backend/database.js -> MIGRATIONS`, şu an v1…v8). Her migration kendi transaction'ında
koşar — PostgreSQL'de DDL transaction'a girdiği için yarım uygulanmış şema oluşamaz.

### 6. İndeksler sorgu desenine göre (Bölüm 3 — B-tree + GiST)
- `idx_reservations_slot` → per-slot kapasite sorgusu (EXPLAIN ile doğrulandı: Index Scan)
- `idx_reservations_user`, `idx_reservations_facility_date`, `idx_reservations_date`
- `idx_facilities_geom` (GiST) → `ST_Contains` mekansal join
- `idx_facilities_geog` (GiST, `geom::geography`) → KNN `<->` **metre** sıralaması
- `users.username`, `facilities.kod` UNIQUE → login ve kod bazlı erişim

### 7. Kanonik seed + türetilmiş veri ayrımı (Bölüm 11 — Derived Data)
- `data/seed.json` = kanonik başlangıç verisi (git'te, insan-okur)
- Veritabanı = türetilmiş + kullanıcı üretimi veri
- `schema.sql`, `docs/data/analytics.json`, `docs/data/transit-routes.geojson` = **türetilmiş
  dokümanlar**; elle düzenlenmez, script'lerle yeniden üretilir
- Seed **idempotenttir** (`ON CONFLICT DO NOTHING`): tekrar çalıştırmak veriyi bozmaz
- `daily_stats` rollup'ı da türetilmiştir: `rebuildDailyStats()` kaynaktan yeniden kurar

### 8. Para: tam sayı kuruş ve TAŞMA (Bölüm 4)
Para her yerde `*_minor` (kuruş, tam sayı) — float yuvarlama hatası imkansız. **Ama** kuruş
cinsinden toplamlar `int4` sınırını (2.147.483.647 = ~21,5M TL) kolayca aşar. Bu yüzden tüm
para toplamları `::bigint` cast edilir; aksi halde PostgreSQL `22003` fırlatır ve dashboard
tamamen çöker (yaşandı, regresyon testi eklendi).

### 9. Doluluk türetilmiştir, saklanmaz (Bölüm 11)
`facilities.manual_occupancy` adminin **elle girdiği bir işarettir** ve öyle adlandırılmıştır.
Kullanıcıya gösterilen gerçek doluluk, o günün iptal edilmemiş rezervasyonlarından
LATERAL alt sorguyla hesaplanır. Önceden kolon `occupancy` adını taşıyor ama rezervasyonlarla
hiç güncellenmiyordu — bir yıllık veri üretilse bile harita aynı sabit sayıyı gösteriyordu.

## GitHub Pages (docs/) Neden localStorage?
Pages statik hosting'dir; sunucu süreci çalıştıramaz. `docs/app.js` seed verisinin tarayıcı
içi **çevrimdışı replikasını** kullanır. Bu bilinçli bir "derived data" kararıdır: kanonik
kaynak `data/seed.json`, Pages kopyası ondan türetilir.

- `mufettis_seed_version` anahtarı ile versiyon takibi: `seed.json`'da `version` artınca
  ziyaretçilerin eski replikası otomatik yenilenir.
- `data/seed.json` değişince `docs/data/seed.json`'a kopyalanmalı ve `version` artırılmalıdır.
- Leaflet/Turf/Chart.js CDN yerine `docs/vendor/` altında (kurum ağı / çevrimdışı demo).
- Pages girişleri (`seed.json -> demo_users`) gerçek backend parolalarından **bağımsızdır**:
  `demo/demo1234`, `demo-admin/demo1234` (statik siteye gerçek hash asla gönderilmez, ADR-002).

## Çalıştırma

```bash
npm install
npm run db:up          # PostgreSQL + PostGIS (docker compose)
npm start              # migration + seed otomatik -> http://localhost:8085
npm run db:load-geo    # ilçe sınırlarını PostGIS'e yükle (bir kez)
npm test               # her test kendi izole şemasında; gerçek veriye dokunmaz
```

Docker kullanmıyorsanız yerel PostgreSQL 16 + PostGIS 3 yeterli; bağlantı için `.env.example`.

### API uçları

| Metod | Yol | Auth | Açıklama |
|---|---|---|---|
| POST | `/api/auth/register` | - | Kayıt; token döner |
| POST | `/api/auth/login` | - | Giriş; token döner |
| GET | `/api/facilities` | - | Tesisler (doluluk **türetilmiş**) |
| POST | `/api/facilities` | admin | Yeni tesis (opsiyonel İSPARK kapasitesi) |
| PATCH | `/api/facilities/:id` | admin | Elle girilen doluluk işaretini güncelle |
| DELETE | `/api/facilities/:id` | admin | Tesis sil (cascade) |
| GET | `/api/districts` | - | İlçe sınırları + demografi + alarm (`ST_Contains`) |
| GET | `/api/proximity?lat&lng` | - | En yakın 3 tesis (KNN `<->`, metre) |
| GET | `/api/reservations` | Bearer | Kullanıcının rezervasyonları |
| POST | `/api/reservations` | Bearer | Rezervasyon (SERIALIZABLE; çifte kayıt 409) |
| GET | `/api/menu?facilityId` | - | Tesis menüsü |
| POST | `/api/orders` | Bearer | Sipariş (tutar sunucuda hesaplanır ve imzalanır) |
| GET | `/api/reservations/:id/orders` | Bearer | Rezervasyonun siparişleri (sahiplik zorunlu) |
| PATCH | `/api/orders/:id/status` | admin | Durum ilerlet (submitted→served→paid; ADR-007) |
| GET | `/api/ispark/:facilityId` | - | Otopark doluluk durumu |
| POST | `/api/ispark/:facilityId/take` | Bearer | Yer kap (atomik compare-and-set) |
| POST | `/api/ispark/:facilityId/release` | Bearer | Yer bırak |
| GET | `/api/analytics/dashboard` | - | Tüm analitik bloklar tek payload |
| GET | `/api/analytics/revenue` | - | Ciro zaman serisi |
| GET | `/api/admin/reservations` | admin | Tüm rezervasyonlar (sahiplik filtresiz gözetim) |
| GET | `/api/admin/orders` | admin | Tüm siparişler (sahiplik filtresiz gözetim) |
| GET | `/api/admin/audit-log` | admin | Son admin işlemleri (append-only) |
| GET | `/api/weather?lat&lng` | - | Hava durumu (anahtar yoksa deterministik demo) |

Varsayılan kullanıcılar (`admin`, `user`): parolalar **rastgele üretilir**,
`data/dev-credentials.json`'a yazılır (gitignored; ADR-002).
