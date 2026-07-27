# PostgreSQL

## 1. Tek cümlede

PostgreSQL, ayrı bir sunucu süreci olarak çalışan, ilişkisel, açık kaynak, **eklenti
mimarisi** olan bir veritabanı yönetim sistemidir.

**Bu projede:** v16.13 + PostGIS 3.4.2. Tek gerçek kaynak (ADR-009).

---

## 2. Hangi problemi çözmek için doğdu

1986'da Berkeley'de Michael Stonebraker'ın derdi şuydu: dönemin ilişkisel veritabanları
**yeni veri tipi eklemeye kapalıydı.** Tarih, para, metin — tamam. Peki bir coğrafi
poligon? Bir IP adresi aralığı? Bir kimyasal molekül?

Cevabı **genişletilebilirlik** oldu: veritabanının kendisi, tip/operatör/indeks/fonksiyon
tanımlarını bir katalogda tutsun ve bunlar **dışarıdan eklenebilsin.** Adı da buradan
geliyor: **POST-inGRES** — Ingres'ten sonrası.

Bu karar 40 yıl sonra bu projeyi doğrudan etkiliyor: **PostGIS bir eklentidir.**
`CREATE EXTENSION postgis;` yazdığınızda veritabanına yeni tipler (`geometry`,
`geography`), yeni operatörler (`<->`), yeni indeks türleri (GiST) ve yüzlerce fonksiyon
(`ST_Contains`, `ST_Distance`) ekleniyor — çekirdek kodu değiştirmeden.

Aynı mimari `pgvector` (yapay zekâ embedding'leri), `TimescaleDB` (zaman serisi) ve
`pg_trgm` (bulanık metin arama) eklentilerini de mümkün kılıyor.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **SQLite** | sıfır kurulum, tek dosya, gömülü | **mekansal sorgu yok**; eşzamanlılık garantisi tek-yazıcı kısıtından "ödünç" alınıyordu (ADR-009) |
| **MySQL / MariaDB** | yaygın, hosting bol | mekansal desteği PostGIS'in yanında zayıf; `SERIALIZABLE` semantiği farklı |
| **MongoDB** | şemasız, hızlı başlangıç | veri **doğal olarak ilişkisel** (tesis→rezervasyon→sipariş→kalem); JOIN'siz hayat burada zorlaştırır. Çok-belgeli transaction 4.0'a kadar yoktu |
| **Oracle / SQL Server** | kurumsal destek | lisans; öğrenme projesi için ağır |

### SQLite'tan geçişin gerçek hikâyesi

Proje SQLite ile başladı. Geçişin sebebi "PostgreSQL daha iyi" değildi — **iki iddia
karşılıksız kalmıştı:**

1. *"Bu bir Web GIS projesi"* — ama mekansal işlerin hiçbiri veritabanında değildi.
   İlçe-tesis eşlemesi JavaScript'te elle yazılmış ray-casting, mesafe elle yazılmış
   Haversine, "en yakın 3 tesis" tüm tabloyu belleğe alıp JS'te sıralama.
2. *"Eşzamanlılık güvenli"* — doğruydu, ama korumayı **kod sağlamıyordu.** SQLite
   `BEGIN IMMEDIATE` ile tüm yazıcıları sıraya sokuyordu; yani doğruluk, veritabanının
   eşzamanlılık **yeteneksizliğinden** geliyordu.

> İkinci madde bu projenin en iyi anlatısı: *"Bir garantinin çalıştığını görmek yetmiyor;
> onu neyin sağladığını bilmek gerekiyor. Benimki ödünç alınmış bir garantiydi ve
> PostgreSQL'e geçince kayboldu — çünkü PostgreSQL gerçekten paralel yazıyor."*

**Kaybedilenler** (ADR-009'da kayıtlı): sıfır bağımlılık, tek komutla kurulum, veritabanını
dosya olarak kopyalama kolaylığı, ve tüm kodun async'e çevrilmesi.

---

## 4. Bu projede tam olarak nerede

**Şema tek yerde tanımlı:** `backend/database.js` içindeki numaralı `MIGRATIONS` dizisi.
`npm start` her açılışta eksik migration'ları uygular — **idempotent**, kaç kez çalışırsa
çalışsın aynı yere gelir. `schema.sql` bundan **türetilir** (`npm run export:schema`) ve
elle düzenlenmez.

**12 tablo.** Öne çıkanlar:

```
facilities      tesisler; geom GENERATED kolonu lat/lng'den üretilir
districts       ilçe poligonları (PostGIS)
users           parola PHC formatında
reservations    kapasite kontrolü + kısmi UNIQUE indeks
orders          durum makinesi: submitted → served → paid
order_items     fiyat SNAPSHOT (captured data)
audit_log       append-only, mutasyonla aynı transaction'da
daily_stats     rollup (türetilmiş, silinip yeniden üretilebilir)
ispark_holds    yer kapma sahipliği
```

**Kullanılan PostgreSQL'e özgü özellikler** — projeyi taşınabilir olmaktan çıkaran, ama
karşılığında gerçek şeyler kazandıran seçimler:

| Özellik | Ne kazandırıyor |
|---|---|
| `GENERATED ALWAYS AS` kolon | `geom` ile lat/lng **asla ayrışamaz** |
| Kısmi indeks (`WHERE status <> 'cancelled'`) | iptal edilen rezervasyon slotu bloke etmiyor |
| `SERIALIZABLE` + `40001` retry | write skew'e karşı gerçek koruma |
| `RETURNING` | ekle-ve-oku tek turda |
| `::bigint` cast | para toplamlarında int4 taşmasını önlüyor |
| `information_schema` / `pg_catalog` | şemayı **sorgulayarak** keşfetme |
| Şema (namespace) | test izolasyonu ve `demo` sunum şeması |

---

## 5. Bilinmesi gereken üç tuzak

### (a) `int4` toplamda taşar — projede gerçekten oldu

Para kuruş cinsinden tam sayı (doğru karar, ADR-001). Ama toplam `::int` cast ediliyordu:

```
int4 üst sınırı 2.147.483.647 kuruş = yalnızca 21,5 milyon TL
gerçek ciro                          = 106 milyon TL   (5 katı)
```

PostgreSQL sessizce yanlış sonuç vermek yerine `22003 integer out of range` fırlattı ve
analitik paneli tamamen çöktü. **Doğru tipi seçmek yetmiyor, toplamın tipini de düşünmek
gerekiyor.**

> Ve PostgreSQL'in patlaması bir **özelliktir**, kusur değil. MySQL'in varsayılan
> modu sessizce kırpardı — o zaman yanlış rakamı yıllarca rapor ederdiniz.

### (b) `READ COMMITTED` (varsayılan) write skew'i engellemez

Sezgi "veritabanı halleder" der; ölçüm aksini söyler:

```
40 worker, kapasite 10
  READ COMMITTED  → 18-22 rezervasyon geçti   (aşırı rezervasyon)
  SERIALIZABLE    → tam 10                    (doğru)
```

SERIALIZABLE bedava değil: çakışan transaction `40001` ile **reddedilir** ve uygulama
yeniden denemek zorundadır. Bu kod projede `database.js`'te.

### (c) Bağlantı havuzunda "yaz-sonra-oku" masum değil

Havuzdan aldığınız bir sonraki bağlantı, henüz commit edilmemiş satırı **göremez**.
SQLite'ta tek bağlantı olduğu için bu hata hiç görünmemişti; PostgreSQL'e geçişte
`createFacility` `null` döndürmeye başladı. Aynı transaction'da kalması gereken işler
`transaction()` sarmalayıcısıyla yapılmalı.

---

## 6. Kendin dene

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c \
  "SELECT version(), postgis_version();"

# tip katılığı: SQLite bunu kabul ederdi
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
VALUES ((SELECT MIN(id) FROM users),(SELECT MIN(id) FROM facilities),'2027-13-45','19:00',2,'x');"
# beklenen: ERROR: date/time field value out of range: "2027-13-45"

# taşma sınırını görün
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
SELECT 2147483647 AS int4_ust_siniri,
       ROUND(2147483647/100.0/1000000,1) AS bu_kac_milyon_TL,
       ROUND(SUM(amount_minor)/100.0/1000000,1) AS gercek_ciro_milyon_TL
FROM reservations WHERE status <> 'cancelled';"

# write skew'i ölçün
node backend/test-concurrency.js
```

---

## 7. Daha fazlası için

- Resmî doküman: <https://www.postgresql.org/docs/16/>
- İzolasyon seviyeleri: <https://www.postgresql.org/docs/16/transaction-iso.html>
- Hata kodları: <https://www.postgresql.org/docs/16/errcodes-appendix.html>
- Bu kitapta: [04 — Neden PostgreSQL?](../04-neden-postgresql.md),
  [06 — Aynı anda iki kişi](../06-ayni-anda-iki-kisi.md)
- Projede: `docs/adr/ADR-009-postgresql-postgis.md`, `DATABASE.md`
