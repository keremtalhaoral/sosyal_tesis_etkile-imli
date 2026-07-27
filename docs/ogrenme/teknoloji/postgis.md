# PostGIS

## 1. Tek cümlede

PostGIS, PostgreSQL'e coğrafi veri tipleri (`geometry`, `geography`), mekansal indeksler
(GiST) ve yüzlerce mekansal fonksiyon (`ST_*`) ekleyen bir **eklentidir**.

**Bu projede:** v3.4.2 (GEOS 3.12.1, PROJ 9.4.0). Projenin PostgreSQL'e geçmesinin
**birinci sebebi**.

---

## 2. Hangi problemi çözmek için doğdu

2001'de Refractions Research'ün derdi şuydu: coğrafi veri veritabanına **sığıyordu** ama
veritabanı onunla **hiçbir şey yapamıyordu.**

Bir tesisin enlem-boylamını iki `float` kolonda saklayabilirsiniz. Ama şu soruları
soramazsınız:

- *"Bu nokta bu poligonun içinde mi?"*
- *"Bu iki nokta arası kaç metre?"*
- *"Bana en yakın 3 tesis hangileri?"*
- *"500 metre yarıçapta ne var?"*

Bu sorular veritabanı için görünmezdir; sonuç olarak **tüm veriyi uygulamaya çekip
JavaScript'te hesaplamak** zorunda kalırsınız. Bu projede tam olarak öyleydi:

| İş | PostGIS öncesi |
|---|---|
| "Bu tesis hangi ilçede?" | JS'te elle yazılmış ray-casting |
| "İki nokta arası mesafe" | JS'te elle yazılmış Haversine |
| "En yakın 3 tesis" | tüm tesisleri belleğe al, JS'te sırala |
| İlçe sınırları (3,7 MB) | her açılışta dosyadan belleğe |

PostGIS'in cevabı: **coğrafyayı birinci sınıf veri tipi yap.** Nokta, çizgi, poligon
gerçek tipler olsun; "içeriyor", "kesişiyor", "uzaklığı" gerçek operatörler olsun; ve
en önemlisi — **indekslenebilsinler.**

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **Uygulama katmanında JS** (Turf) | veritabanı gerekmez | tüm veriyi belleğe çekmek gerekir; indeks yok, ölçeklenmiyor. *Ama tarayıcıda hâlâ kullanılıyor — aşağıda* |
| **MySQL spatial** | zaten MySQL'deyseniz | fonksiyon seti çok daha dar, `geography` tipi yok |
| **MongoDB geospatial** | 2dsphere indeksi iyi | poligon işlemleri sınırlı; ilişkisel veri zaten PostgreSQL'de |
| **Ayrı GIS sunucusu** (GeoServer) | görselleştirme güçlü | ayrı bir sistem daha; veri iki yerde = tutarsızlık riski |

**Belirleyici sebep:** Veri zaten PostgreSQL'de. Mekansal işlemi **verinin yanında** yapmak,
veriyi işlemin yanına taşımaktan her zaman ucuzdur.

### Peki Turf.js neden hâlâ var?

Çünkü ikisi **farklı yerde** çalışıyor:

| | PostGIS | Turf.js |
|---|---|---|
| Nerede | sunucu, veritabanı içinde | tarayıcı |
| Ne kadar veriye | tüm tabloya, indeksli | ekrandaki birkaç şekle |
| Ne zaman | kalıcı sorgu | kullanıcı çizerken, anlık |

Kural: **kalıcı ve büyük veri sorgusu → PostGIS; anlık görsel geri bildirim → Turf.**
Sonuç kaydedilecekse son sözü her zaman sunucu söyler.

---

## 4. Bu projede tam olarak nerede

### `geom` bir **generated column**

```sql
geom geometry(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED
```

Elle yazılamaz — lat/lng değişince otomatik güncellenir. Bu, bir **hata sınıfını yok
ediyor**: koordinat ile geometrinin ayrışması artık imkânsız.

### Üç sorgu deseni

**İlçe × tesis eşlemesi** (`db.js:96`) — `LEFT JOIN` şart, çünkü aradığımız şey tam olarak
tesisi **olmayan** ilçeler:

```sql
SELECT d.name, COUNT(f.id)
FROM districts d
LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
GROUP BY d.id;
```

**En yakın komşu (KNN)** (`db.js:151`) — `<->` operatörü GiST indeksini kullanır:

```sql
ORDER BY f.geom::geography <-> ST_SetSRID(ST_MakePoint($3,$2),4326)::geography
LIMIT 3
```

**Mesafe** (`db.js:157`) — metre cinsinden, jeodezik:

```sql
ROUND(ST_Distance(f.geom::geography, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography)::numeric, 1)
```

### İlçe geometrisi

`docs/data/istanbul-districts.geojson` (3,7 MB) → `npm run db:load-geo` ile PostGIS'e
yüklenir. **Tek kanonik kopya**: aynı dosyayı GitHub Pages de okuyor, yani harita ile
veritabanı asla farklı sınırlar göstermiyor.

---

## 5. Bilinmesi gereken üç tuzak

### (a) `geometry` ile `geography` farkı — bu projede sessiz bir hataya yol açtı

- `geometry` düzlem varsayar → mesafeyi **derece** cinsinden verir.
- `geography` küre üstünde hesaplar → **metre** verir.

İstanbul 41° kuzeyde ve orada **bir boylam derecesi bir enlem derecesinden ~%25 kısadır.**
Yani düzlemsel hesap doğu-batı mesafelerini olduğundan uzun sanır.

Gerçek bir noktada (41.01, 28.97) ölçüldü:

```
geometry sıralaması (YANLIŞ):  Kasımpaşa 2232.9 → Cihangir 2308.9 → Haliç 2302.5
geography sıralaması (DOĞRU):  gerçek metre sırası
```

> **En tehlikeli kısmı:** bu hata **çoğu zaman doğru cevap verir.** Yalnız mesafeler
> birbirine yakın olduğunda sessizce yanlışa döner. Bu yüzden `::geography` cast'i
> `db.js`'te bir yorumla korunuyor — biri "gereksiz" diye silmesin diye.

### (b) İndekssiz mekansal sorgu tüm tabloyu tarar

`ST_Contains` her satır için poligon-nokta testi yapar. GiST indeksi olmadan 39 ilçe ×
30 tesis şimdilik ucuz, ama 425 bin satırda felakettir. `EXPLAIN` ile kontrol edin:
`Index Scan` mı `Seq Scan` mı?

### (c) Koordinat sırası: `lng, lat` — `lat, lng` değil

```sql
ST_MakePoint(lng, lat)   -- X (boylam) önce, Y (enlem) sonra
```

Ama GPS ve günlük konuşma `lat, lng` der. GeoJSON da `[lng, lat]` kullanır. İstanbul için
şanslıyız: ters çevirirseniz nokta **Somali açıklarına** düşer ve hata anında görünür.
Ekvatora yakın bölgelerde bu kadar bariz olmaz.

---

## 6. Kendin dene

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis

-- sürüm
SELECT postgis_full_version();

-- YANLIŞ sıralama: derece (geometry) ile sırala
SELECT f.ad,
       ROUND((f.geom <-> ST_SetSRID(ST_MakePoint(28.97,41.01),4326))::numeric, 6) AS derece,
       ROUND(ST_Distance(f.geom::geography,
             ST_SetSRID(ST_MakePoint(28.97,41.01),4326)::geography)::numeric, 1) AS metre
FROM facilities f ORDER BY derece LIMIT 5;

-- DOĞRU sıralama: metre (geography) ile sırala
SELECT f.ad,
       ROUND(ST_Distance(f.geom::geography,
             ST_SetSRID(ST_MakePoint(28.97,41.01),4326)::geography)::numeric, 1) AS metre
FROM facilities f ORDER BY metre LIMIT 5;
```

Gerçek çıktı — **metre kolonuna bakın, ikinci ve üçüncü sıra yer değiştiriyor:**

```
--- derece sırası (YANLIŞ) ---          --- metre sırası (DOĞRU) ---
Kasımpaşa    0.020217   2232.9          Kasımpaşa    2232.9
Cihangir     0.022345   2308.9   ←      Haliç        2302.5   ←
Haliç        0.022380   2302.5   ←      Cihangir     2308.9   ←
Altınboynuz  0.053704   5695.6   ←      Paşalimanı   5095.4   ←
Paşalimanı   0.057468   5095.4   ←      Fethipaşa    5371.3
```

Derece sıralaması Cihangir'i Haliç'ten yakın sanıyor (2308.9 > 2302.5), ve 4-5. sıralarda
fark daha da büyüyor: Altınboynuz 5695,6 m ile Paşalimanı 5095,4 m'nin **önüne** geçiyor —
600 metrelik bir hata. Listenin başındaki tek doğru sıra Kasımpaşa; gerisi karışmış.

```sql
-- planı görün: Index Scan mı Seq Scan mı?
EXPLAIN ANALYZE
SELECT d.name FROM districts d JOIN facilities f ON ST_Contains(d.geom, f.geom) LIMIT 5;
```

---

## 7. Daha fazlası için

- Resmî doküman: <https://postgis.net/docs/>
- Fonksiyon referansı: <https://postgis.net/docs/reference.html>
- Bu kitapta: [05 — Harita verisi ve PostGIS](../05-harita-verisi-postgis.md)
- Projede: `queries.sql` mekansal bölümleri, `docs/sorgu-defteri.md`
