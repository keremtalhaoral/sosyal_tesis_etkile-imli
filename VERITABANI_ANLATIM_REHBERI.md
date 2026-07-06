# Veri Mimarisini Mentöre Anlatma Rehberi

> Mentörün sorusu: *"Verilerini nerelerde tutuyorsun? Yeni kullanıcılar, tesisler vesaire —
> projeyle ilgili tüm verileri SQL bilginle anlat."*
>
> Bu belge, o soruya **kendi projenin gerçek kodu ve gerçek sorgularıyla** cevap vermen için
> hazırlandı. Amaç ezber değil: her başlıkta önce **kavram**, sonra **projedeki karşılığı**,
> sonra **mentöre söyleyeceğin cümle** var. Belgedeki her SQL sorgusu bu projenin
> veritabanında gerçekten çalıştırılıp doğrulanmıştır.

---

## 1. Tek Cümlelik Cevap (Elevator Pitch)

> "Projenin tüm kalıcı verisi — tesisler, kullanıcılar, rezervasyonlar, ilçe demografisi —
> repo kökündeki **`data/app.db`** adlı tek bir SQLite veritabanında tutuluyor. Node.js
> backend'i ve Python servisi aynı dosyayı paylaşıyor; başlangıç verisi **`data/seed.json`**
> adlı kanonik kaynaktan geliyor. Yani tek gerçek kaynak (single source of truth) ilkesini
> uyguluyorum."

Bu cümleden sonra mentör detaya inecektir. Aşağıdaki bölümler o detaylar.

---

## 2. Veri Nerede Yaşıyor? (Katman Katman)

| Yer | Ne tutuyor | Neden orada |
|---|---|---|
| `data/seed.json` | 30 tesis + ulaşım bilgisi, 39 ilçe nüfusu (TÜİK 2023), varsayılan kullanıcılar | **Kanonik başlangıç verisi.** İnsan-okur, git'te versiyonlanır. Veritabanı silinse bile buradan yeniden inşa edilir. |
| `data/app.db` | Çalışma zamanındaki CANLI veri: seed + sonradan eklenen her şey (yeni kullanıcılar, yeni tesisler, rezervasyonlar) | **Tek gerçek kaynak.** SQLite, WAL modunda. Git'te DEĞİL (`.gitignore`) çünkü türetilmiş veridir — kod deposuna binary veritabanı konmaz. |
| `backend/data/istanbul-districts.geojson` | İlçe sınır geometrileri (3.7 MB poligon verisi) | **Statik referans verisi.** Hiç değişmez, mekânsal sorgusu SQLite'ta yapılamaz. PostGIS'e geçilirse `geometry` kolonuna taşınır. |
| GitHub Pages (`docs/`) → tarayıcı `localStorage` | Seed'in **türetilmiş çevrimdışı replikası** | Pages statik hosting'dir, sunucu/veritabanı çalıştıramaz. Sayfa açılışında `docs/data/seed.json` fetch edilip localStorage'a yazılır; versiyon numarasıyla güncel tutulur. |

**Mentöre söyleyeceğin kritik ayrım:** *"Kanonik veri ile türetilmiş veriyi ayırıyorum.
seed.json kanonik; app.db ve Pages'taki localStorage ondan türetiliyor. Türetilmiş veri her
zaman kaynaktan yeniden üretilebilir, o yüzden git'e koymuyorum."* (Bu, DDIA kitabının
11. bölümündeki derived data kavramı.)

**Öğrendiğim ders:** Önceden veri üç ayrı yerde kopyaydı (JS kodunun içine gömülü diziler,
ayrı bir SQLite, localStorage) ve üçü birbirini tutmuyordu — buna **dual-write tutarsızlığı**
denir. Merkezileştirince bu sınıf hata tamamen ortadan kalktı.

---

## 3. Şema: 4 Tablo + 1 Migration Tablosu

Şema `backend/database.js` (Node) ve `advanced-gis/app/models.py` (Python) içinde birebir
aynıdır. İlişkiyi şöyle anlat:

```
users (1) ────< reservations >──── (1) facilities        districts (bağımsız referans)
         bir kullanıcının          bir tesisin
         çok rezervasyonu          çok rezervasyonu
```

### 3.1 `users` — kullanıcılar

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,                    -- düz metin DEĞİL: PBKDF2 hash (aşağıda)
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Anlatacağın kavramlar:
- **PRIMARY KEY + AUTOINCREMENT**: her satırın benzersiz kimliği; id'ler yeniden kullanılmaz.
- **UNIQUE**: aynı kullanıcı adıyla ikinci kayıt veritabanı seviyesinde reddedilir —
  uygulama kodu unutsa bile.
- **CHECK**: role kolonuna 'user' ve 'admin' dışında değer yazılamaz. *"Geçersiz durumu
  uygulamada kontrol etmek yerine veritabanında imkânsız kılıyorum."*
- **Parola güvenliği**: parolalar PBKDF2-HMAC-SHA256 ile 100.000 iterasyon hash'lenir.
  *"Veritabanı sızsa bile parolalar okunamaz."*

### 3.2 `facilities` — sosyal tesisler

```sql
CREATE TABLE facilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kod TEXT UNIQUE NOT NULL,                  -- ALTY-01 gibi işletme kodu
    ad TEXT NOT NULL,
    adres TEXT,
    lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    occupancy INTEGER NOT NULL DEFAULT 0 CHECK (occupancy BETWEEN 0 AND 100),
    iett_info TEXT NOT NULL DEFAULT 'Mevcut Değil',
    vapur_info TEXT NOT NULL DEFAULT 'Mevcut Değil',
    transit_transfer TEXT NOT NULL DEFAULT 'Mevcut Değil',
    route_description TEXT NOT NULL DEFAULT 'Mevcut Değil',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Anlatacağın kavramlar:
- **Doğal anahtar vs yapay anahtar**: `id` yapay (surrogate) anahtar, `kod` (ALTY-01)
  doğal iş anahtarı — ikisi de benzersiz ama FK ilişkileri `id` üzerinden kurulur.
- **CHECK ile alan doğrulama**: koordinat Dünya sınırları dışında olamaz, kapasite
  pozitif olmak zorunda, doluluk yüzde olduğu için 0-100 arası.
- **Denormalizasyon kararı**: ulaşım bilgileri (otobüs/vapur/aktarma) ayrı tabloya
  bölünebilirdi ama hep tesisle birlikte okunuyor; JOIN maliyetine değmezdi.
  *"Normalizasyonun ne zaman durdurulacağını da öğrendim."*

### 3.3 `reservations` — rezervasyonlar (ilişki tablosu)

```sql
CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    reserve_date TEXT NOT NULL,
    reserve_time TEXT NOT NULL,
    guests INTEGER NOT NULL CHECK (guests > 0),
    crypto_signature TEXT NOT NULL,            -- HMAC-SHA256 bütünlük imzası
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, facility_id, reserve_date, reserve_time)   -- çifte rezervasyon engeli
);
```

Bu tablo şemanın en zengin öğretim malzemesi — üç kavram birden:
- **FOREIGN KEY (referans bütünlüğü)**: var olmayan kullanıcıya veya tesise rezervasyon
  yazılamaz.
- **ON DELETE CASCADE**: tesis silinirse rezervasyonları otomatik silinir — "yetim kayıt"
  (orphan row) kalmaz. *"Temizliği uygulama koduna bırakmıyorum; ilişkiyi veritabanı yönetiyor."*
- **Bileşik UNIQUE kısıtı**: aynı kullanıcı, aynı tesise, aynı gün ve saate ikinci kez
  rezervasyon yapamaz. Dört kolonun **birlikte** benzersiz olması gerekir — tek tek değil.

### 3.4 `districts` — ilçe demografisi

```sql
CREATE TABLE districts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    population INTEGER NOT NULL CHECK (population >= 0)
);
```

*"Nüfus verisi değişebilir (TÜİK her yıl günceller), o yüzden veritabanında; ilçe sınır
geometrisi değişmez, o yüzden dosyada."* — veri sınıflandırma kararı.

### 3.5 `schema_migrations` — şema evrimi

```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

*"Şemayı elle değiştirmiyorum. Her değişiklik numaralı bir migration; veritabanı hangi
versiyonda olduğunu kendisi biliyor ve açılışta eksik migration'ları sırayla uyguluyor.
Böylece 6 ay sonraki app.db de bugünkü de aynı yoldan geçmiş oluyor."*

---

## 4. İndeksler: Hangi Sorgu İçin Hangi İndeks

```sql
CREATE INDEX idx_reservations_user          ON reservations(user_id);
CREATE INDEX idx_reservations_facility_date ON reservations(facility_id, reserve_date);
-- Ayrıca UNIQUE kısıtları otomatik indeks oluşturur: users(username), facilities(kod)
```

Mentöre anlatım: *"İndeksi rastgele değil, sorgu desenine göre açtım. 'Bu kullanıcının
rezervasyonları' sorgusu `user_id` ile filtreliyor → onun indeksi var. 'Bu tesisin şu
tarihteki rezervasyonları' iki kolonla filtreliyor → bileşik (composite) indeks var.
İndeks B-tree yapısıdır; tablo taraması O(n) yerine O(log n) arama sağlar. Ama her
indeks yazma maliyeti ekler, o yüzden her kolona indeks açılmaz."*

---

## 5. Transaction: Projenin En Kritik SQL Dersi

Rezervasyon oluşturmak tek işlem değil, **üç adımlık bir zincir**:

```sql
BEGIN IMMEDIATE;
  -- 1. Kapasite kontrolü
  SELECT capacity, occupancy FROM facilities WHERE id = ?;
  -- (uygulama: yeni doluluk hesaplanır; kapasite aşılıyorsa ROLLBACK)

  -- 2. Doluluk güncelle
  UPDATE facilities SET occupancy = ?, updated_at = datetime('now') WHERE id = ?;

  -- 3. Rezervasyonu ekle (UNIQUE ihlali olursa buradan hata fırlar)
  INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
  VALUES (?, ?, ?, ?, ?, ?);
COMMIT;   -- hata olursa: ROLLBACK → doluluk güncellemesi de geri alınır
```

Mentöre anlatım: *"Bu üç adım atomiktir — ya hepsi olur ya hiçbiri. Diyelim 2. adım geçti
ama 3. adım çifte rezervasyon yüzünden UNIQUE hatası verdi: ROLLBACK sayesinde doluluk
oranı da eski haline döner. Transaction olmasaydı tesis '4 kişi doldu' gösterip ortada
rezervasyon olmayan tutarsız bir duruma düşerdi. Bu, ACID'in A'sı: Atomicity."*

Testle kanıtı da var: `backend/test-db.js` içinde "rollback doluluğu geri aldı" testi
tam bu senaryoyu doğruluyor.

**ACID'i kendi projenle eşleştir:**
- **A**tomicity → yukarıdaki rezervasyon zinciri
- **C**onsistency → CHECK/UNIQUE/FK kısıtları her commit'te korunur
- **I**solation → `BEGIN IMMEDIATE` yazma kilidi alır; iki eşzamanlı rezervasyon çakışamaz
- **D**urability → WAL modu (aşağıda)

---

## 6. WAL Modu: Dayanıklılık ve Eşzamanlılık

```sql
PRAGMA journal_mode = WAL;    -- Write-Ahead Log
PRAGMA foreign_keys = ON;     -- SQLite'ta FK'ler varsayılan KAPALIDIR, açmak gerekir!
PRAGMA busy_timeout = 5000;   -- kilit çakışmasında 5 sn bekle, hemen hata verme
```

Mentöre anlatım: *"Her onaylanmış yazma önce log dosyasına (app.db-wal) yazılır, sonra ana
dosyaya taşınır. Süreç tam commit anında çökse bile açılışta log'dan kurtarılır — commit
edilmiş veri kaybolmaz. Ayrıca WAL'da okuyucular yazıcıyı bloklamaz: Node servisi yazarken
Python servisi okumaya devam edebilir."*

İnce ama etkileyici detay: *"SQLite'ta FOREIGN KEY zorlaması varsayılan olarak kapalıdır;
`PRAGMA foreign_keys = ON` demeyi öğrendim — birçok kişinin gözünden kaçan bir tuzak."*

---

## 7. Canlı Demo: Mentörün Önünde Çalıştıracağın Sorgular

Terminalde (`sqlite3 data/app.db` ile ya da `node` üzerinden) sırayla göster.
Hepsi bu projede test edilmiş, gerçek çıktı veren sorgulardır.

```sql
-- 1. Tablolar ve şema
.tables
.schema reservations

-- 2. Basit SELECT + ORDER BY + LIMIT: en dolu 5 tesis
SELECT ad, occupancy FROM facilities ORDER BY occupancy DESC LIMIT 5;

-- 3. Agregasyon: sistemin genel fotoğrafı
SELECT COUNT(*) AS tesis_sayisi,
       SUM(capacity) AS toplam_kapasite,
       ROUND(AVG(occupancy), 1) AS ortalama_doluluk
FROM facilities;

-- 4. CASE + GROUP BY: doluluk kategorilerine göre dağılım
SELECT CASE
         WHEN occupancy >= 80 THEN 'Kritik'
         WHEN occupancy >= 60 THEN 'Orta'
         ELSE 'Sakin'
       END AS kategori,
       COUNT(*) AS adet,
       ROUND(AVG(capacity), 1) AS ort_kapasite
FROM facilities
GROUP BY kategori;

-- 5. Çoklu JOIN: kim, hangi tesise, ne zaman, kaç kişilik?
SELECT u.username, f.ad AS tesis, r.reserve_date, r.reserve_time, r.guests
FROM reservations r
JOIN users u      ON u.id = r.user_id
JOIN facilities f ON f.id = r.facility_id
ORDER BY r.reserve_date;

-- 6. Kısıtların canlı kanıtı: bunlar HATA VERMELİ (bilerek göster!)
INSERT INTO facilities (kod, ad, lat, lng, capacity, occupancy)
VALUES ('ALTY-01', 'Kopya Tesis', 41, 29, 100, 50);
-- → UNIQUE constraint failed: facilities.kod

INSERT INTO facilities (kod, ad, lat, lng, capacity, occupancy)
VALUES ('TEST-99', 'Uzayda Tesis', 999, 29, 100, 50);
-- → CHECK constraint failed: lat BETWEEN -90 AND 90

-- 7. Sorgu planı: indeksin gerçekten kullanıldığını göster
EXPLAIN QUERY PLAN
SELECT * FROM reservations WHERE user_id = 2;
-- → "SEARCH ... USING INDEX idx_reservations_user" (SCAN değil SEARCH!)
```

Demo taktiği: 6. maddedeki **bilerek hata aldırma** çok etkilidir — "kısıtlarım çalışıyor"
demek yerine gösterirsin. 7. maddede `SCAN` yerine `SEARCH ... USING INDEX` görünmesi,
indeks anlatımının kanıtıdır.

---

## 8. Mentörün Muhtemel Soruları ve Cevap Anahtarları

**"Neden SQLite? Neden PostgreSQL/MySQL değil?"**
> "Ölçeğe uygun araç seçtim: tek sunucu, düşük yazma hacmi, ilişkisel veri. SQLite gömülü
> çalışır, ayrı sunucu süreci istemez, ACID garantisi tamdır ve Node 22'nin yerleşik
> `node:sqlite` modülüyle sıfır bağımlılık. Ama mimariyi PostgreSQL+PostGIS'e geçecek
> şekilde tasarladım: mekânsal fonksiyonlarımın SQL karşılıkları kodda yorum olarak hazır
> (ST_Contains, ST_Distance, KNN `<->` operatörü) ve geçiş planı DATABASE.md'de yazılı."

**"Neden NoSQL değil?"**
> "Verim doğal olarak ilişkisel: kullanıcı-rezervasyon-tesis arasında katı ilişkiler ve
> güçlü tutarlılık ihtiyacı var (çifte rezervasyon, kapasite aşımı). Şemam belli ve stabil.
> NoSQL'in esnek şeması burada avantaj değil, kısıtları kaybetme riski olurdu."

**"İki servis aynı dosyaya yazarsa çakışmaz mı?"**
> "WAL modunda çok okuyucu + tek yazıcı modeli var; yazma kilidi çakışırsa
> `busy_timeout = 5000` ile 5 saniye beklenir. Bu iş yükünde (saniyede birkaç yazma bile
> değil) fazlasıyla yeterli. Yazma hacmi büyürse zaten PostgreSQL'e geçerim — bu da
> ölçeklendirme sinyallerini bilmek demek."

**"Parolaları nasıl saklıyorsun?"**
> "Asla düz metin değil. PBKDF2-HMAC-SHA256, 100.000 iterasyon, sabit uygulama salt'ı.
> Hash tek yönlü: veritabanı sızsa bile parola geri çıkarılamaz. İyileştirme alanı olarak
> kullanıcı başına rastgele salt'a geçilebileceğini de biliyorum."

**"Sunucu çökerse veri gider mi?"**
> "Commit edilmiş hiçbir şey gitmez — WAL bunu garanti eder. Test de ettim: sunucuyu
> öldürüp yeniden başlattım, API'den eklediğim tesis ve rezervasyon aynen duruyordu."

**"GitHub Pages'ta veritabanı yokken site nasıl çalışıyor?"**
> "Pages statik hosting; sunucu çalıştıramaz. Orada mimari bilinçli olarak değişiyor:
> kanonik seed.json sayfa açılışında indirilip tarayıcının localStorage'ına 'çevrimdışı
> replika' olarak yazılıyor. Versiyon numarası tutuyorum; seed güncellenince ziyaretçinin
> replikası otomatik yenileniyor. Yani Pages, merkezi verinin türetilmiş bir kopyası —
> ayrı bir gerçek kaynak değil."

**"Veri nasıl yedeklenir / yeniden kurulur?"**
> "app.db tek dosya — kopyalamak yedeklemektir. Ayrıca sıfırdan kurulum idempotenttir:
> dosyayı silsen bile açılışta migration şemayı kurar, seed.json'dan 30 tesis + kullanıcılar
> yüklenir. `INSERT OR IGNORE` kullandığım için seed'i iki kez çalıştırmak veri bozmaz."

---

## 9. 5 Dakikalık Anlatım Planı

1. **(30 sn)** Elevator pitch — Bölüm 1'deki cümle.
2. **(1 dk)** Veri katmanları tablosu: kanonik seed → canlı DB → türetilmiş replika ayrımı.
3. **(1.5 dk)** Şemayı çiz (users —< reservations >— facilities), `reservations` tablosu
   üzerinden UNIQUE + FK + CASCADE anlat.
4. **(1.5 dk)** Canlı demo: JOIN sorgusu + bilerek hata aldırma + EXPLAIN QUERY PLAN.
5. **(30 sn)** Transaction hikayesi: "rezervasyon üç adım, ya hep ya hiç" + WAL ile kapanış.

Süre artarsa: migration sistemi ve PostGIS geçiş planı — bunlar "ileriyi de düşünmüş"
izlenimi bırakır.

---

## 10. Bu Projeden Öğrendiklerim (Özet Liste)

Mentör "ne öğrendin?" derse madde madde:

1. **Tek gerçek kaynak** ilkesi ve dual-write tutarsızlığının neden tehlikeli olduğu
2. **Kanonik veri / türetilmiş veri** ayrımı (seed.json vs app.db vs localStorage)
3. Şema tasarımı: PRIMARY KEY, doğal-yapay anahtar ayrımı, NOT NULL / DEFAULT
4. **Kısıtlarla savunma**: UNIQUE (tekil + bileşik), CHECK, FOREIGN KEY + CASCADE —
   geçersiz durumu uygulamada yakalamak yerine veritabanında imkânsız kılmak
5. **Transaction ve ACID**: çok adımlı yazmalarda atomiklik, ROLLBACK'in değeri
6. **WAL modu**: dayanıklılık + okuyucu/yazıcı eşzamanlılığı; SQLite'ta FK'lerin
   varsayılan kapalı olduğu tuzağı
7. **İndeks stratejisi**: sorgu desenine göre indeks; bileşik indeks; EXPLAIN QUERY PLAN
   ile doğrulama; indeksin yazma maliyeti
8. **Migration ile şema evrimi**: elle ALTER yerine versiyonlu, tekrarlanabilir değişiklik
9. **Idempotent seed**: INSERT OR IGNORE ile güvenli tekrar çalıştırma
10. **Parola güvenliği**: hash vs şifreleme farkı, PBKDF2, iterasyon sayısının anlamı
11. **Araç seçimi**: SQLite'ın doğru olduğu ölçek, PostgreSQL+PostGIS'e geçiş sinyalleri
12. **Türetilmiş replika ile çevrimdışı çalışma**: statik hosting kısıtında veri dağıtımı
