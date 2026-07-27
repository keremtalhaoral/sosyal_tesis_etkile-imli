# 05 — Harita verisi ve PostGIS

> "Web GIS projesi" cümlesindeki GIS burada başlıyor. Bilgisayar bir haritayı nasıl anlar?

---

## 1. Bir cümlede

PostGIS, PostgreSQL'e **"nerede?"** sorusunu sorma yeteneği katan bir eklentidir.

---

## 2. Benzetme: satranç tahtası

Bir satranç tahtasında her karenin adresi vardır: `e4`, `d5`. "Şah nerede?" sorusunun net
bir cevabı olur, hatta "şah ile vezir arasındaki mesafe" bile hesaplanabilir.

Dünya da böyle adreslenmiştir: **enlem** (kuzey-güney) ve **boylam** (doğu-batı).
İstanbul yaklaşık `41.0 K, 29.0 D`.

**Benzetme nerede bozuluyor — ve bu projede gerçek bir hataya yol açtı:** Satranç tahtası
**düzdür ve kareleri eşittir**. Dünya ise küredir ve kareleri **eşit değildir**.
Ekvatorda 1 derece boylam ≈ 111 km, kutupta ise 0 km'ye iner. İstanbul'un enleminde (41°K)
bir boylam derecesi, bir enlem derecesinden **yaklaşık %25 kısadır**.

Bu yüzden "derece cinsinden en yakın" ile "metre cinsinden en yakın" **farklı sonuçlar
verebilir**. Projede tam olarak bu oldu — aşağıda anlatıyorum.

---

## 3. Temel kavramlar

### Koordinat ve SRID

Bir noktayı `(41.0578, 28.9456)` diye yazmak yetmez: **hangi koordinat sistemine göre?**
Bunu **SRID** (Spatial Reference System Identifier) söyler.

**SRID 4326** = WGS84, GPS'in ve tüm dünya haritalarının kullandığı sistem. Projede her
geometri bu sistemde.

> **Sık yapılan hata — sıra karışıklığı.** Konuşurken "enlem, boylam" deriz (41, 29).
> Ama GeoJSON ve PostGIS `ST_MakePoint` **önce boylamı** ister: `ST_MakePoint(lng, lat)`.
> Karıştırırsanız tesisleriniz İstanbul yerine Somali açıklarında belirir. Projede bu
> yüzden `load-geo.js` yükleme sonunda "kaç tesis bir ilçeye düştü?" diye **kontrol
> ediyor** — sıfırsa sıra karışmış demektir.

### Geometri tipleri

| Tip | Nedir | Projede |
|---|---|---|
| `POINT` | tek nokta | tesis konumu |
| `LINESTRING` | noktalar zinciri | otobüs/metro güzergahı |
| `POLYGON` | kapalı alan | ilçe sınırı |
| `MULTIPOLYGON` | birden çok alan | adaları olan ilçeler |

> `MULTIPOLYGON` neden gerekli? Bir ilçe tek parça olmayabilir — Adalar ilçesi birden çok
> adadan oluşur. Tek `POLYGON` bunu ifade edemez.

### `geometry` ve `geography` farkı — projede kritik

| | `geometry` | `geography` |
|---|---|---|
| Dünyayı nasıl görür | **düz** | **küre** |
| Mesafe birimi | derece | **metre** |
| Hız | hızlı | biraz yavaş |

`geometry` küçük alanlarda ve hız gerektiğinde iyidir. Ama **mesafe ölçmek** için
`geography` gerekir — çünkü metre isteriz, derece değil.

---

## 4. Projedeki gerçek hata: yanlış uzayda ölçmek

"Şu noktaya en yakın 3 tesis" sorgusu ilk yazıldığında şöyleydi
(örnek nokta: Eminönü civarı, `41.01 K, 28.97 D`):

```sql
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(28.97, 41.01), 4326)
```

`<->` operatörü "en yakına göre sırala" demek. Sonuç:

```
1. Kasımpaşa   2232.9 m
2. Cihangir    2308.9 m     ← 
3. Haliç       2302.5 m     ← daha yakın ama SONRA listelendi!
```

**Sıralama yanlıştı.** Sebep: `<->` burada `geometry` üzerinde çalışıyor, yani **derece**
ölçüyor. 41°K'de boylam dereceleri kısaldığı için derece sıralaması metre sıralamasıyla
uyuşmuyor.

Çözüm — `::geography` ekleyip bu uzay için ayrı bir indeks oluşturmak:

```sql
ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint(28.97, 41.01), 4326)::geography
```

```
1. Kasımpaşa   2232.9 m
2. Haliç       2302.5 m    ✓
3. Cihangir    2308.9 m    ✓
```

> **Ders:** Doğru cevabı almak için indeksin **hangi uzayda ölçtüğünü** bilmek gerekiyor.
> Bu, "kütüphane çalışıyor" ile "kütüphanenin ne yaptığını biliyorum" arasındaki fark.

---

## 5. Mekansal fonksiyonlar

### `ST_Contains` — "içinde mi?"

```sql
SELECT d.name, COUNT(f.id) AS tesis
FROM districts d
LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
GROUP BY d.id, d.name;
```

Hiçbir tesiste "ilçe" diye bir kolon **yok**. İlçe **geometriden bulunuyor**: tesisin
noktası hangi ilçe poligonunun içindeyse o ilçeye ait.

Bu, projenin karar destek özelliğinin temeli. Veri girişinde ilçe yazmak zorunda değilsiniz
— ve yanlış yazma ihtimali de ortadan kalkıyor.

### `ST_Distance` — "ne kadar uzak?"

```sql
SELECT ST_Distance(a.geom::geography, b.geom::geography) AS metre
FROM facilities a, facilities b WHERE a.kod='ALTY-01' AND b.kod='ALTY-08';
```

`::geography` sayesinde sonuç **metre** ve **jeodezik** (dünyanın eğriliğini hesaba katar).

### `ST_DWithin` — "şu kadar yakın mı?"

```sql
WHERE ST_DWithin(a.geom::geography, b.geom::geography, 2000)   -- 2 km içinde
```

`ST_Distance(...) < 2000` yazmaktan **daha hızlıdır**, çünkü `ST_DWithin` indeksi
kullanabilir. `ST_Distance` her satır için hesap yapmak zorunda kalır.

### `<->` — en yakın komşu (KNN)

```sql
ORDER BY geom::geography <-> nokta::geography LIMIT 3
```

Tüm tabloyu hesaplayıp sıralamak yerine indeksten doğrudan en yakınları çeker.

---

## 6. GiST indeksi — mekansal veri neden özel indeks ister?

Normal (B-tree) indeks **sıralanabilir** veriler içindir: sayılar, metinler. Ama iki nokta
arasında "büyüktür/küçüktür" ilişkisi yoktur — hangi nokta "daha büyük"?

**GiST** (Generalized Search Tree) farklı çalışır: her geometrinin etrafına bir **kutu**
çizer, kutuları da daha büyük kutularda gruplar. "Şu alandaki noktalar" sorusunda önce
kutulara bakar, çoğunu tek seferde eler.

Projede iki tane var:

```sql
CREATE INDEX idx_facilities_geom ON facilities USING GIST (geom);
CREATE INDEX idx_facilities_geog ON facilities USING GIST ((geom::geography));
```

İkincisi yukarıda anlatılan sıralama hatası yüzünden eklendi.

---

## 7. Generated kolon — geometri nasıl hep doğru kalıyor?

```sql
geom geometry(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED
```

`geom` kolonu **elle yazılamaz**; `lat`/`lng`'den otomatik türer. Bu şu anlama gelir:
koordinat ile harita noktası **asla ayrışamaz**. Birini güncelleyip diğerini unutmak
imkânsız.

Yazmayı denerseniz:

```
ERROR: column "geom" can only be updated to DEFAULT
```

> Bu, "geçersiz durumu imkânsız kıl" ilkesinin en temiz örneklerinden biri. Kod yazarak
> senkron tutmaya çalışmak yerine, ayrışmayı **mümkün olmaktan çıkardık**.

---

## 8. Kendin dene

```bash
npm run db:load-geo     # ilçe sınırlarını yükle (bir kez yeterli)
```

Çıktının son satırı önemli:
```
[geo] Mekansal join kontrolü: 30/30 tesis bir ilçe poligonuna düştü.
```
Bu 0 olsaydı koordinat sırası karışmış demekti.

**Geometriyi görün:**

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
SELECT kod, lat, lng, ST_AsText(geom) FROM facilities LIMIT 3;"
```

`POINT(28.9456101 41.0578458)` — dikkat: **önce boylam**.

**Mekansal join — projenin karar destek çekirdeği:**

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
SELECT d.name AS ilce, d.population AS nufus, COUNT(f.id) AS tesis,
       ROUND(COUNT(f.id) * 100000.0 / d.population, 2) AS tesis_100k_kisi
FROM districts d LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
WHERE d.geom IS NOT NULL
GROUP BY d.id, d.name, d.population
ORDER BY tesis_100k_kisi ASC LIMIT 8;"
```

En üstte tesis açığı en yüksek ilçeler. Haritadaki kırmızı renk bu sayıdan geliyor.

**Hatayı kendiniz yeniden üretin.** Önce YANLIŞ yol (geometry, derece):

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
SELECT ad, ROUND(ST_Distance(geom::geography,
       ST_SetSRID(ST_MakePoint(28.97,41.01),4326)::geography)::numeric,1) AS metre
FROM facilities
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(28.97,41.01),4326) LIMIT 3;"
```

```
 Kasımpaşa   2232.9
 Cihangir    2308.9     <- sıra BOZUK
 Haliç       2302.5     <- daha yakın olmasına rağmen sonda
```

Şimdi DOĞRU yol — tek fark iki `::geography`:

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
SELECT ad, ROUND(ST_Distance(geom::geography,
       ST_SetSRID(ST_MakePoint(28.97,41.01),4326)::geography)::numeric,1) AS metre
FROM facilities
ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint(28.97,41.01),4326)::geography LIMIT 3;"
```

```
 Kasımpaşa   2232.9
 Haliç       2302.5     ✓
 Cihangir    2308.9     ✓
```

> Not: bu hata her koordinatta görünmez — yalnız iki tesisin mesafesi birbirine yakın
> olduğunda ortaya çıkar. Tam da bu yüzden tehlikeli: çoğu zaman doğru cevap verir,
> bazen sessizce yanlış.

---

## 9. Mentör sorarsa

**"PostGIS tam olarak ne katıyor?"**
> *"PostgreSQL'e geometri veri tipi, mekansal fonksiyonlar ve mekansal indeks katıyor.
> Onsuz 'bu nokta bu poligonun içinde mi' sorusunu JavaScript'te elle yazmam gerekiyordu —
> yazmıştım da, ray-casting algoritmasıyla. Şimdi tek satır SQL ve indeksli."*

**"SRID 4326 ne demek?"**
> *"WGS84 koordinat sistemi — GPS'in kullandığı. Bir koordinatın anlamlı olması için hangi
> sisteme göre olduğunu bilmek gerekiyor; SRID bunu söylüyor."*

**"geometry ile geography farkı?"**
> *"geometry dünyayı düz kabul eder, mesafeyi derece cinsinden ölçer. geography küre kabul
> eder, metre verir. Projede sıralama için geography şart — geometry ile ölçtüğümde
> 2302 metrelik tesis 2308 metrelikten sonra listeleniyordu, çünkü 41. enlemde boylam
> dereceleri kısalıyor."*

**"Neden GiST, normal indeks olmaz mı?"**
> *"B-tree sıralanabilir veriler için. İki nokta arasında 'büyüktür' ilişkisi yok. GiST
> geometrilerin etrafına sınırlayıcı kutular çizip hiyerarşik gruplar; 'şu alandakiler'
> sorusunda çoğunu tek seferde eliyor."*

---

## Sırada ne var

Şimdi geçişin en tehlikeli kısmına geliyoruz: iki kişi aynı anda son yeri almaya çalışırsa.
**[06 — Aynı anda iki kişi](06-ayni-anda-iki-kisi.md)**
