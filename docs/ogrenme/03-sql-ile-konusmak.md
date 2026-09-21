# 03 — SQL ile konuşmak

> Veritabanının ne olduğunu gördük. Şimdi ona soru sormayı öğrenelim.

---

## 1. Bir cümlede

SQL, veritabanına **ne istediğinizi** söylediğiniz dildir — *nasıl bulacağını* değil.

---

## 2. Benzetme: garsona sipariş

Garsona *"mutfağa git, üçüncü rafı aç, tavayı çıkar…"* demezsiniz. *"Bir omlet"* dersiniz.
**Nasıl** yapılacağı mutfağın işi.

SQL de böyledir. `SELECT * FROM facilities WHERE capacity > 100` dersiniz;
"indeksi kullan mı yoksa tabloyu tara mı" kararını veritabanı verir. Buna **bildirimsel**
(declarative) dil denir.

**Benzetme nerede bozuluyor:** Garson menüdekinden fazlasını yapamaz. SQL ise şaşırtıcı
derecede güçlüdür — verileri birleştirebilir, gruplayabilir, pencereler açabilir, hatta
özyinelemeli sorgular yazabilir. Ayrıca *nasıl* yapılacağını göremezsiniz ama
**`EXPLAIN` ile sorabilirsiniz** — mutfağa kamera koymak gibi.

---

## 3. Dört temel fiil

```sql
SELECT  -- oku
INSERT  -- ekle
UPDATE  -- değiştir
DELETE  -- sil
```

### SELECT — okuma

```sql
SELECT ad, capacity FROM facilities WHERE capacity > 100 ORDER BY capacity DESC LIMIT 5;
--     └──────┬────┘      └────┬───┘ └──────┬──────────┘ └─────────┬────────┘ └──┬──┘
--       hangi kolonlar    hangi tablo   hangi satırlar        sıralama       kaç tane
```

Okuma sırası aslında farklıdır — önce `FROM` (hangi tablo), sonra `WHERE` (hangi satırlar),
sonra `SELECT` (hangi kolonlar). Zihninizde böyle kurarsanız karmaşık sorgular kolaylaşır.

### JOIN — tabloları birleştirmek

Rezervasyonlar tablosunda tesis **adı** yok, sadece `facility_id` var. Adı görmek için
iki tabloyu birleştiririz:

```sql
SELECT r.id, u.username, f.ad AS tesis, r.guests
FROM reservations r
JOIN users u      ON u.id = r.user_id       -- eşleştirme kuralı
JOIN facilities f ON f.id = r.facility_id
ORDER BY r.id DESC LIMIT 5;
```

`ON` satırı "hangi satır hangisiyle eşleşiyor" der. Bu, [02. bölümdeki](02-veritabani-nedir.md)
yabancı anahtarın kullanımıdır.

**`JOIN` ile `LEFT JOIN` farkı** — projede kritik:

```sql
-- JOIN: eşleşme YOKSA satır hiç görünmez
SELECT d.name, COUNT(f.id) FROM districts d
JOIN facilities f ON ST_Contains(d.geom, f.geom) GROUP BY d.id;
-- -> tesisi olmayan ilçeler listede YOK

-- LEFT JOIN: sol taraf HER ZAMAN görünür, sağ taraf boşsa NULL
SELECT d.name, COUNT(f.id) FROM districts d
LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom) GROUP BY d.id;
-- -> tesisi olmayan ilçeler 0 ile görünür
```

Projede **`LEFT JOIN` şart**: "hangi ilçede tesis eksik?" sorusunun cevabı tam olarak
tesisi **olmayan** ilçelerdir. `JOIN` kullansaydık aradığımız ilçeler listeden düşerdi —
sessizce yanlış cevap.

### GROUP BY — özetlemek

```sql
SELECT to_char(reserve_date,'YYYY-MM') AS ay,
       COUNT(*)                        AS rezervasyon,
       SUM(guests)                     AS toplam_misafir,
       ROUND(AVG(guests), 1)           AS ortalama_grup
FROM reservations
WHERE status <> 'cancelled'
GROUP BY ay
ORDER BY ay DESC;
```

`GROUP BY ay` "aynı aya düşen satırları tek satırda topla" der. `COUNT`, `SUM`, `AVG`
gibi fonksiyonlar **agregasyon** fonksiyonlarıdır — birçok satırı tek değere indirirler.

**Sık yapılan hata:** `GROUP BY`'da olmayan bir kolonu `SELECT`'e koymak. PostgreSQL
buna izin vermez, çünkü "aynı gruptaki 500 satırın hangi `guests` değerini göstereyim?"
sorusunun cevabı yoktur.

### WHERE ile HAVING farkı

```sql
WHERE  status <> 'cancelled'    -- gruplamadan ÖNCE satırları eler
HAVING SUM(guests) > 100        -- gruplamadan SONRA grupları eler
```

`WHERE` tek tek satırlara bakar; `HAVING` gruplara. Agregasyon fonksiyonu `WHERE`'de
kullanılamaz — henüz gruplar oluşmamıştır.

### INSERT / UPDATE / DELETE

```sql
INSERT INTO facilities (kod, ad, lat, lng, capacity)
VALUES ('YENI-01', 'Yeni Tesis', 41.0, 29.0, 50)
RETURNING id, kod;              -- eklenen satırı geri ver

UPDATE facilities SET capacity = capacity + 20 WHERE kod = 'YENI-01';

DELETE FROM facilities WHERE kod = 'YENI-01';
```

> **`WHERE` yazmayı unutmak en pahalı SQL hatasıdır.** `DELETE FROM facilities;` tüm
> tabloyu siler. Alışkanlık edinin: önce `SELECT` ile hangi satırların etkileneceğine
> bakın, sonra `SELECT`'i `DELETE`/`UPDATE` ile değiştirin.

**`RETURNING`** PostgreSQL'in güzel bir eklentisidir: eklenen/değişen satırı aynı sorguda
geri verir. "Ekle, sonra `SELECT` ile bul" iki turunu bire indirir.

---

## 4. Projede tam olarak nerede

Uygulamanın çalıştırdığı SQL'lerin hepsi iki dosyada:

- **`backend/db.js`** — tesis/rezervasyon/sipariş sorguları
- **`backend/analytics.js`** — analitik agregasyonlar

Örnek — kapasite kontrolü (`db.js`, `createReservation`):

```js
const { booked } = await tx.one(`
  SELECT COALESCE(SUM(guests), 0)::int AS booked FROM reservations
  WHERE facility_id = $1 AND reserve_date = $2::date AND reserve_time = $3::time
    AND status <> 'cancelled'
`, [facilityId, reserveDate, reserveTime]);
```

İki detaya dikkat:

**`$1`, `$2` nedir?** Bunlar **parametre yer tutucularıdır**. Değerleri sorgu metnine
yapıştırmayız:

```js
// ASLA BÖYLE YAPMAYIN:
`... WHERE facility_id = ${facilityId}`
```

Kullanıcı `facilityId` yerine `1; DROP TABLE users;--` gönderirse sorgu metni değişir ve
tablo silinir. Buna **SQL enjeksiyonu** denir. Parametre kullandığınızda değer *veri*
olarak gider, asla *kod* olarak yorumlanmaz. Projede tüm sorgular parametreli.

**`COALESCE(..., 0)`** nedir? Hiç rezervasyon yoksa `SUM` **`NULL`** döner (sıfır değil!).
`NULL + 5` de `NULL`'dur. `COALESCE` "NULL ise 0 kullan" der.

> **`NULL` tuzağı:** `NULL` "değer yok" demektir, sıfır ya da boş metin değil.
> `NULL = NULL` bile **doğru değildir** (sonuç `NULL`). Karşılaştırmak için `IS NULL`
> kullanılır. Bu, SQL'de en sık yapılan hatalardan biridir.

---

## 5. Kendin dene

`queries.sql` dosyası **16 bölümde 90'dan fazla** çalıştırılabilir sorgu içeriyor ve
her biri gerçek veritabanına karşı doğrulandı. Anlatımı `docs/sorgu-defteri.md`'de.

Bağlanın:

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis
```

Basitten başlayın:

```sql
SELECT COUNT(*) FROM facilities;
SELECT ad, capacity FROM facilities ORDER BY capacity DESC LIMIT 5;
```

JOIN deneyin:

```sql
SELECT r.id, u.username, f.ad AS tesis, r.guests, r.status
FROM reservations r
JOIN users u ON u.id = r.user_id
JOIN facilities f ON f.id = r.facility_id
ORDER BY r.id DESC LIMIT 5;
```

GROUP BY deneyin:

```sql
SELECT to_char(reserve_date,'YYYY-MM') AS ay,
       COUNT(*) AS rez, SUM(guests) AS misafir
FROM reservations WHERE status <> 'cancelled'
GROUP BY ay ORDER BY ay DESC LIMIT 6;
```

**JOIN vs LEFT JOIN farkını gözünüzle görün:**

```sql
-- tesisi OLMAYAN ilçeler görünmez
SELECT COUNT(*) FROM (
  SELECT d.id FROM districts d
  JOIN facilities f ON ST_Contains(d.geom, f.geom) GROUP BY d.id) x;

-- tesisi olmayanlar da görünür
SELECT COUNT(*) FROM (
  SELECT d.id FROM districts d
  LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
  WHERE d.geom IS NOT NULL GROUP BY d.id) x;
```

İkinci sayı daha büyük — aradaki fark, **tesisi olmayan ilçelerdir**. Projenin
"nerede eksik?" sorusunun cevabı tam olarak orada.

Çıkmak için `\q`.

---

## 6. Mentör sorarsa

**"SQL enjeksiyonuna karşı ne yaptın?"**
> *"Tüm sorgular parametreli — `$1`, `$2` yer tutucularıyla. Değeri hiçbir zaman sorgu
> metnine yapıştırmıyorum, o yüzden kullanıcı girdisi kod olarak yorumlanamıyor."*

**"JOIN ile LEFT JOIN farkı nedir, projende nerede önemli?"**
> *"JOIN yalnız eşleşenleri getirir, LEFT JOIN sol taraftakilerin hepsini. İlçe-tesis
> analizinde LEFT JOIN şart: tesisi olmayan ilçeler benim asıl aradığım şey. JOIN
> kullansaydım aradığım ilçeler listeden düşerdi."*

**"NULL nedir?"**
> *"'Değer yok' demek — sıfır ya da boş metin değil. `NULL = NULL` bile doğru değil,
> `IS NULL` kullanmak gerekiyor. Toplamlarda `COALESCE` ile 0'a çeviriyorum, yoksa hiç
> kayıt olmayan durumda `NULL` dönüp hesabı bozardı."*

---

## Sırada ne var

SQL öğrendik. Ama hangi veritabanı? Proje SQLite ile başladı, PostgreSQL'e geçti — neden?
**[04 — Neden PostgreSQL?](04-neden-postgresql.md)**
