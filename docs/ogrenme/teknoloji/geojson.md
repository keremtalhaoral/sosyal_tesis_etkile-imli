# GeoJSON

## 1. Tek cümlede

GeoJSON, coğrafi şekilleri (nokta, çizgi, poligon) **JSON olarak** ifade eden, RFC 7946
ile standartlaşmış formattır.

**Bu projede:** ilçe sınırları (39 feature, 3,7 MB) ve toplu taşıma güzergahları
(40 feature, 93 KB).

---

## 2. Hangi problemi çözmek için doğdu

Coğrafi veri onlarca formatta yaşıyordu ve hiçbiri web için tasarlanmamıştı:

- **Shapefile** (Esri, 1998) — GIS'in fiilî standardı, ama **birden çok dosya**
  (`.shp` + `.shx` + `.dbf` + `.prj` …), ikili format, alan adları **10 karakterle**
  sınırlı, tarayıcıda okunamaz.
- **GML** — XML tabanlı, standart ama ağır ve okuması zor.
- **KML** — Google Earth için, sunum odaklı, veri değişimi için uygun değil.

2008'de bir grup geliştirici basit bir soru sordu: *"Zaten JSON konuşan bir tarayıcıya
coğrafyayı nasıl anlatırız?"* Cevap doğrudandı — **JSON'un kendisiyle.**

```json
{
  "type": "Feature",
  "properties": { "name": "Adalar" },
  "geometry": { "type": "Polygon", "coordinates": [[[28.9,40.8],[29.0,40.8], …]] }
}
```

`JSON.parse` ile açılır, `fetch` ile indirilir, ek kütüphane gerekmez. Bugün web
haritacılığının ortak dili.

### Yedi geometri tipi

```
Point            tek nokta            [lng, lat]
LineString       çizgi                [[lng,lat], [lng,lat], …]
Polygon          kapalı alan          dış halka + (varsa) delikler
MultiPoint       birden çok nokta
MultiLineString  birden çok çizgi
MultiPolygon     birden çok alan      ← Adalar gibi ada ilçeleri için ŞART
GeometryCollection  karışık
```

Üstlerinde iki sarmalayıcı: **`Feature`** (geometri + özellikler) ve
**`FeatureCollection`** (feature listesi).

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **Shapefile** | GIS araçlarının fiilî standardı | tarayıcıda okunamaz; çok dosyalı, ikili |
| **TopoJSON** | ortak sınırları **paylaşır** → %80'e varan küçülme | ilçe sınırları için cazip, ama açmak için ek kütüphane gerekir; 3,7 MB kabul edilebilir bulundu |
| **Vektör karo** (MVT) | çok büyük veri için en verimli | karo sunucusu gerekir; "sunucusuz Pages" kuralını bozar |
| **WKT** | PostGIS'in metin formatı, kompakt | JSON değil; tarayıcıda ayrıştırıcı gerekir |

**Belirleyici sebep:** GeoJSON hem PostGIS'in (`ST_AsGeoJSON`) hem Leaflet'in
(`L.geoJSON`) hem Turf'ün **doğal dili**. Üçü arasında dönüşüm yapmadan veri
taşıyabiliyoruz — format uyumsuzluğu diye bir sorun hiç doğmuyor.

---

## 4. Bu projede tam olarak nerede

### İki dosya

**`docs/data/istanbul-districts.geojson`** — 39 ilçe, 3,7 MB.
Geometri tipleri: `Polygon` ve `MultiPolygon` (Adalar gibi ada ilçeleri MultiPolygon).
Özellikler sade: `{"name": "Adalar"}`.

**Tek kanonik kopya** ve bu bilinçli: aynı dosyayı hem `npm run db:load-geo` PostGIS'e
yüklüyor hem GitHub Pages tarayıcıya veriyor. İki ayrı kopya olsaydı biri güncellenmeden
kalır ve harita ile veritabanı **farklı sınırlar** gösterirdi.

**`docs/data/transit-routes.geojson`** — 40 feature (10 hat çizgisi + 30 yürüme
bağlantısı), 93 KB. GTFS'ten **türetilmiş**; ham GTFS `.gitignore`'da
(→ [gtfs.md](gtfs.md)).

Bu dosyanın ilginç yanı: **kendi kalite raporunu taşıyor.**

```json
"meta": {
  "line_count": 10, "walk_count": 30, "facility_count": 30,
  "coverage": { "facilities_with_lines": 13, "pct": 43 },
  "unmatched_count": 88
}
```

Ve her çizgi kendi kanıtını:

```json
"properties": { "ref":"34 (Metrobüs)", "match_cov":0.77, "match_dist_m":180,
                "source":"ibb-gtfs", "confidence":"geometric-match" }
```

> **GeoJSON'un `properties` alanı serbesttir** — istediğiniz her şeyi koyabilirsiniz.
> Bu proje oraya **veri kalitesi kanıtı** koyuyor. Çizgiye tıklayan biri neden orada
> olduğunu görebiliyor.

### Üç yerde birden

```
PostGIS   →  ST_AsGeoJSON(d.geom)::json    (db.js:92)
Leaflet   →  L.geoJSON(data)                (app.js)
Turf      →  turf.area(feature)             (app.js:1114)
```

---

## 5. Bilinmesi gereken üç tuzak

### (a) Koordinat sırası `[boylam, enlem]` — sezginin tersi

RFC 7946 nettir: **X (lng) önce, Y (lat) sonra.** Ama GPS, Google Maps ve günlük konuşma
`lat, lng` der. Leaflet de `[lat, lng]` kullanır.

```js
{"coordinates": [28.9850, 41.0369]}   // GeoJSON: boylam, enlem
L.marker(        [41.0369, 28.9850])  // Leaflet: enlem, boylam
```

**Aynı proje içinde iki farklı sıra.** İstanbul için şanslıyız: ters çevirirseniz nokta
Somali açıklarına düşer ve hata anında görünür.

### (b) `Polygon` ile `MultiPolygon` karıştırmak

```
Polygon       coordinates[0]    = dış halka
MultiPolygon  coordinates[0][0] = ilk parçanın dış halkası
```

Bir seviye fark. Kodunuz `Polygon` varsayıyorsa MultiPolygon'da sessizce yanlış sonuç
verir — hata fırlatmaz, sadece **yanlış geometri** işler.

Bu projede 39 ilçenin **tam ikisi** MultiPolygon: **Adalar** ve **Şile**. Yani sadece
`Polygon` varsayan bir kod 37 ilçede doğru çalışır, ikisinde sessizce bozulur — en kötü
hata türü. (Aşağıdaki komutla kendiniz doğrulayabilirsiniz.)

### (c) 3,7 MB tek istekte iner

İlçe dosyası her sayfa açılışında indiriliyor. Mobilde ve yavaş bağlantıda hissedilir.

Çözümler var — basitleştirme (`ST_Simplify`), TopoJSON, vektör karo — ama hiçbiri bedava
değil: basitleştirme sınır doğruluğunu bozar, TopoJSON ek kütüphane ister, vektör karo
sunucu ister. Proje **doğruluğu ve basitliği** tercih etti. Bu bir takas ve bilinçli.

---

## 6. Kendin dene

```bash
# ilçe dosyasının yapısı
node -e "
const g=JSON.parse(require('fs').readFileSync('docs/data/istanbul-districts.geojson','utf8'));
console.log('tip:', g.type, '| feature:', g.features.length);
console.log('geometri tipleri:', [...new Set(g.features.map(f=>f.geometry.type))]);
console.log('ilk özellik:', JSON.stringify(g.features[0].properties));
const mp=g.features.filter(f=>f.geometry.type==='MultiPolygon').map(f=>f.properties.name);
console.log('MultiPolygon olan ilçeler:', mp.join(', '));
"
```

PostGIS'ten GeoJSON üretin — veritabanı formatı **kendisi** biliyor:

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -tAc \
  "SELECT ST_AsGeoJSON(geom) FROM facilities LIMIT 1;"
```

Beklenen: `{"type":"Point","coordinates":[28.98…,41.03…]}` — **boylam önce** (tuzak a).

---

## 7. Daha fazlası için

- Spesifikasyon: RFC 7946 — <https://datatracker.ietf.org/doc/html/rfc7946>
- Görsel doğrulayıcı: <https://geojson.io/>
- Bu kitapta: [05 — Harita verisi ve PostGIS](../05-harita-verisi-postgis.md),
  [10 — Veri nereden geliyor](../10-veri-nereden-geliyor.md)
- İlgili: [postgis.md](postgis.md), [leaflet.md](leaflet.md), [turf.md](turf.md)
