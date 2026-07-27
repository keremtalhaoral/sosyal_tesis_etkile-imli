# ADR-009: SQLite'tan PostgreSQL + PostGIS'e Geçiş

- **Durum:** Kabul edildi
- **Bağlam fazı:** v2-08 (veritabanı platformu değişimi)
- **İlgili:** ADR-003 (eşzamanlılık), ADR-004 (analytics), DATABASE.md'deki "PostGIS geçiş yolu"

## Bağlam

SQLite bu proje için doğru bir başlangıçtı (ADR öncesi karar, DATABASE.md Karar 1): tek düğüm,
düşük yazma hacmi, ilişkisel veri, sıfır kurulum. Ama iki iddia zamanla karşılıksız kaldı:

1. **"Web GIS projesi"** olmasına rağmen mekansal işlerin hiçbiri veritabanında değildi.
   `backend/db.js` içinde elle yazılmış ray-casting point-in-polygon, `acos()` tabanlı Haversine
   ve JS'te sıralanan KNN vardı. 3.7 MB'lık ilçe geometrisi her açılışta belleğe okunuyordu.
   SQLite bunları sorgulayamadığı için başka çare yoktu.
2. **Eşzamanlılık garantisi ödünçtü.** ADR-003 "write-skew'e kapalı" diyor ve bu doğruydu —
   ama korumayı sağlayan şey bizim kodumuz değil, SQLite'ın `BEGIN IMMEDIATE` ile TÜM yazıcıları
   serileştirmesiydi. Yani doğruluğu, veritabanının eşzamanlılık yeteneksizliğinden alıyorduk.

## Karar

**Tam geçiş: PostgreSQL 16 + PostGIS 3.4.** SQLite tamamen kaldırıldı; çift sürücü tutulmadı.

### Karar 1 — Neden çift sürücü (SQLite + PostgreSQL) DEĞİL

Ortak bir repository arayüzü ardında iki sürücü tutmak cazipti (testler SQLite'ta hızlı kalır).
Reddedildi: her sorguyu iki lehçede tutmak kalıcı bir bakım vergisidir ve asıl kazancı
(PostGIS, SERIALIZABLE) **ortak paydaya** indirger — yani hiç kullanamazdık. Tek platform,
tek doğru.

**Bedeli açıkça kabul ediliyor:** "veritabanı için sıfır dış bağımlılık" iddiası bitti.
Artık `pg` paketi ve çalışan bir sunucu gerekiyor. Docker Compose bu maliyeti tek komuta indiriyor.

### Karar 2 — PostGIS: mekansal işler veritabanına indi

| Önce (JS, `db.js`) | Sonra (SQL) |
|---|---|
| ray-casting `pointInPolygon` | `ST_Contains(d.geom, f.geom)` |
| Haversine `calculateGeodesicDistance` | `ST_Distance(geom::geography, ...)` |
| tüm tesisleri map+sort ile KNN | `ORDER BY geom <-> point` (GiST indeksli) |
| 3.7 MB GeoJSON bellekte | `districts.geom geometry(MultiPolygon,4326)` |

`facilities.geom` **generated** kolondur (`ST_SetSRID(ST_MakePoint(lng,lat),4326)` STORED):
elle yazılamaz, dolayısıyla nokta ile lat/lng **asla ayrışamaz**. Bu, SQLite'ta sağlanamayan
bir invariant'tı; test bunu doğruluyor.

**Ölçülen doğruluk kazancı:** `geometry <-> ` operatörü DERECE cinsinden düzlemsel mesafe
ölçer. 41°N'de bir boylam derecesi bir enlem derecesinden ~%25 kısa olduğu için derece
sıralaması metre sıralamasıyla uyuşmuyor — ilk denemede 2302 m'lik tesis 2308 m'likten sonra
listelendi. Bu yüzden `idx_facilities_geog` (geography GiST) eklendi ve KNN `::geography`
üzerinden koşuyor. Eski JS Haversine de aynı sınıfa giriyordu (`acos` küçük mesafelerde
hassasiyet kaybeder); artık jeodezik hesap PostGIS'in.

### Karar 3 — SERIALIZABLE + retry (geçişin en kritik noktası)

PostgreSQL çok yazıcılıdır. `createReservation`'daki "oku → kontrol et → yaz" dizisi, VARSAYILAN
READ COMMITTED altında **artık güvenli değil**: iki işlem aynı `SUM(guests)`'i okuyup ikisi de
yazabilir. Kimse kimsenin satırını ezmez (lost update yok), ama birlikte kapasite invariant'ını
kırarlar — **write skew** (DDIA Böl. 7.2.3). Çakışma henüz var olmayan satırlar üzerinde olduğu
için (phantom) satır kilidi de çözmez.

`transaction()` varsayılan olarak `BEGIN ISOLATION LEVEL SERIALIZABLE` açar ve `40001`
(serialization_failure) alınca jitter'lı geri çekilmeyle 5 kez yeniden dener.

**Reddedilen alternatif:** `SELECT ... FROM facilities WHERE id = $1 FOR UPDATE` ile tesis
satırını mutex gibi kullanmak. Daha ucuz ve burada yeterli olurdu; reddedildi çünkü korumayı
**çağrı yerinin disiplinine** bağlar — ileride eklenecek bir sorgu kilidi almayı unutabilir ve
hata sessizce geri gelir. SSI'yı atlamak ise mümkün değil.

**Ölçüm (`test-concurrency.js`, 40 paralel worker, kapasite 10):**

| Yol | Sonuç |
|---|---|
| READ COMMITTED (aynı kod, düşük izolasyon) | **18-22 rezervasyon** — overbook |
| Transaction dışı oku-sonra-yaz (naif) | **18-26 rezervasyon** — overbook |
| **SERIALIZABLE + retry (üretimdeki yol)** | **tam 10** — overbook YOK |

Bu tablo geçişin özeti: *aynı uygulama kodu*, izolasyon seçimine göre doğru ya da yanlış
çalışıyor. SQLite bu seçimi bizden gizliyordu.

**İstisna:** İSPARK yer kapma (`UPDATE ... WHERE occupied < capacity`) SERIALIZABLE gerektirmez.
Çakışma **var olan tek satır** üzerindedir; satır kilidi yeterlidir. Rollup yeniden inşası
(`rebuildDailyStats`) ise bilinçli olarak `REPEATABLE READ` kullanır: tutarlı tek snapshot
gerekir ama SERIALIZABLE altında her eşzamanlı rezervasyonla çakışıp sürekli yeniden denerdi.

### Karar 4 — Gerçek tipler (TEXT değil)

`reserve_date TEXT` → `date`, `reserve_time TEXT` → `time`, `is_available INTEGER` → `boolean`,
`audit_log.detail TEXT` → `jsonb`.

- `'2027-13-45'` gibi imkansız tarihler artık **veritabanı seviyesinde** reddediliyor (test var).
- Tarih gruplaması `substr(d,1,7)` string kesme değil, `to_char(d,'YYYY-MM')` takvim fonksiyonu.
  Hafta artık ISO-8601 (`IYYY-"W"IW`) — SQLite'ın `%W`'si yılın son günlerini yanlış haftaya
  koyabiliyordu.
- `detail` JSONB olduğu için audit log artık **sorgulanabilir**: `detail->>'kod' = 'ADM-01'`.

API sözleşmesi korunuyor: `pg` tip ayrıştırıcıları `date`'i `'YYYY-MM-DD'` string, `time`'ı
`'HH:MM'` string, `int8`'i (COUNT/SUM) JS `Number` olarak döndürecek şekilde ayarlandı.
(int8 varsayılanı string'dir; düzeltilmezse tüm analitik toplama `"10"+"5"="105"` olurdu.)

### Karar 5 — Senkron → async

`node:sqlite` senkron, `pg` async. Tüm repository/analytics fonksiyonları `async` oldu;
Express handler'ları `asyncHandler` ile sarıldı (reddedilen Promise artık isteği askıda
bırakmıyor, global hata middleware'ine gidiyor).

Geçişte yakalanan **gerçek bir hata:** `createFacility` dönüş değerini transaction'ın İÇİNDEN
okuyordu. SQLite'ta tek bağlantı olduğu için çalışıyordu; PostgreSQL'de havuzdaki başka bir
bağlantı henüz commit edilmemiş satırı göremez ve fonksiyon `null` dönüyordu. Okuma commit
sonrasına alındı.

### Karar 6 — Testlerde şema başına izolasyon

SQLite'ta her test kendi geçici DOSYASINI kullanıyordu. Karşılığı: her test dosyası rastgele
adlı bir PostgreSQL şeması açar (`PG_SCHEMA` → `search_path`), migration'lar oraya kurulur,
sonda `DROP SCHEMA CASCADE`. `public` search_path'te kalır çünkü PostGIS tipleri orada yaşıyor.
Testler gerçek veriye dokunmaz ve birbirlerini görmez.

## Sonuçlar

**Kazanılan**
- Mekansal sorgular veritabanında, indeksli ve jeodezik olarak doğru.
- Eşzamanlılık koruması artık **açık bir karar** ve testle kanıtlı — ödünç alınmış değil.
- Şema gerçek tiplerle geçersiz durumları daha fazla engelliyor.
- Toplu yükleme daha hızlı: 213 bin rezervasyon 15.6 s (SQLite'ta 29.4 s).

**Kaybedilen / bedeli**
- "DB için sıfır dış bağımlılık" iddiası bitti (`pg` + çalışan sunucu).
- Kurulum artık tek komut değil iki: `npm run db:up` sonra `npm start`.
- `data/app.db` dosyasını kopyalayıp taşımak gibi bir kolaylık yok; yedek `pg_dump` işi.

**Değişmeyen**
- `docs/` (GitHub Pages) tamamen aynı: sunucusuz, `seed.json` + `localStorage` ile çalışıyor.
  Geçiş yalnız `backend/` ve `scripts/`'i etkiledi.
- `data/seed.json` hâlâ kanonik başlangıç verisi; `schema.sql` hâlâ türetilmiş doküman.
