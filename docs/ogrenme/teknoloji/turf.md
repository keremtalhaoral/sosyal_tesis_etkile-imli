# Turf.js

## 1. Tek cümlede

Turf.js, GeoJSON üstünde geometri hesabı yapan (alan, tampon, birleşim, fark, mesafe)
saf JavaScript kütüphanesidir — yani **tarayıcıda çalışan PostGIS'in küçük kardeşi**.

**Bu projede:** `docs/vendor/turf/turf.min.js` (590 KB), vendored.

---

## 2. Hangi problemi çözmek için doğdu

Leaflet haritayı **gösterir**, ama hesaplamaz. *"Bu poligonun alanı kaç km²?"*,
*"Bu noktanın 2 km çevresi neresi?"*, *"Bu iki alanın kesişmeyen kısmı?"* — Leaflet'in
cevabı yok.

Bu hesapları yapmanın iki yolu vardı:

1. **Sunucuya sor** — PostGIS ya da bir GIS servisi. Doğru sonuç, ama her soru bir ağ turu.
2. **Elle yaz** — küresel geometri matematiği. Haversine kolay; ama poligon birleşimi
   (union) ve fark (difference) ciddi hesaplama geometrisi işidir ve yanlış yapması kolaydır.

Turf (2013) üçüncü yolu açtı: **her şey GeoJSON alır, GeoJSON döndürür.** Ne sınıf
hiyerarşisi ne özel format — Leaflet'ten çıkanı doğrudan verirsiniz, çıkanı doğrudan
Leaflet'e verirsiniz.

```js
turf.area(polygon)                              // m²
turf.buffer(point, 2, { units: 'kilometers' })  // 2 km'lik tampon poligonu
turf.union(a, b)                                // birleşim
turf.difference(a, b)                           // fark
```

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **PostGIS'e sormak** | doğru, indeksli, ölçeklenir | her fare hareketinde ağ turu olmaz — kullanıcı alan çizerken **anlık** cevap gerekiyor |
| **JSTS** (JTS'in JS portu) | topolojik olarak çok sağlam | daha büyük, API'si daha ağır, GeoJSON'a dönüşüm gerekiyor |
| **Elle yazmak** | sıfır bağımlılık | `union`/`difference` doğru yazması zor; projenin önceki hâlinde elle yazılmış Haversine zaten sorun çıkarmıştı |

### En önemli soru: PostGIS varken Turf neden var?

Bu, mentörün soracağı sorulardan biri ve cevabı **"ikisi rakip değil"**:

| | PostGIS | Turf.js |
|---|---|---|
| **Nerede** | sunucuda, veritabanı içinde | tarayıcıda |
| **Ne kadar veriye** | tüm tabloya, GiST indeksiyle | ekrandaki birkaç şekle |
| **Ne zaman** | kalıcı sorgu, kaydedilecek sonuç | kullanıcı çizerken, anlık geri bildirim |
| **Güvenilirlik** | **son söz burada** | görsel yardımcı |

**Kural:** kalıcı ve büyük veri sorgusu → PostGIS; anlık görsel geri bildirim → Turf.
Sonuç kaydedilecekse **her zaman** sunucu doğrular — tarayıcı hesabına güvenilmez
(→ [09. bölüm](../09-frontend-harita.md), "sahneye seyirci çıkabilir").

---

## 4. Bu projede tam olarak nerede

Altı fonksiyon, iki senaryo (`docs/app.js`):

### Senaryo 1 — ilçe alanı (satır 1113-1114)

```js
const turfPolygon = turf.polygon(feature.geometry.coordinates[0]);
const areaSqKm = (turf.area(turfPolygon) / 1000000).toFixed(1);
```

Kullanıcı bir ilçeye tıkladığında alanı anında görünüyor. Sunucuya sormak için sebep yok —
geometri zaten tarayıcıda.

### Senaryo 2 — "kapsama gölgesi" (satır 1557-1573)

Projenin en görsel özelliği: **hangi bölgeler hiçbir tesisin 2 km çevresinde değil?**

```js
const point   = turf.point([f.koordinatlar[1], f.koordinatlar[0]]);
return turf.buffer(point, 2.0, { units: 'kilometers' });   // her tesise 2 km tampon
…
unionBuffer    = turf.union(unionBuffer, bufferPolygons[i]);        // tamponları birleştir
istanbulPolygon = turf.union(istanbulPolygon, districts[i]);       // ilçeleri birleştir
const shadowPolygon = turf.difference(istanbulPolygon, unionBuffer); // fark = KAPSANMAYAN
```

Sonuç haritada gölgeli alan olarak çiziliyor: *"buralarda sosyal tesis erişimi yok."*
Bu, projenin **karar destek** iddiasının görsel karşılığı — ve tamamen tarayıcıda,
sunucuya hiç gitmeden hesaplanıyor.

---

## 5. Bilinmesi gereken üç tuzak

### (a) Turf düzlemde çalışır, PostGIS küre üstünde — sonuçlar **ayrışabilir**

`turf.buffer(point, 2, {units:'kilometers'})` küresel bir yaklaşım kullanır, ama
`turf.area` ve `turf.union` düzlemsel geometri üstünde çalışır. `ST_Distance(geography)`
ise gerçek jeodezik hesap yapar.

41° enlemde bu fark ölçülebilir düzeydedir (→ [postgis.md](postgis.md), tuzak a). Görsel
bir gölge için sorun değil; **kaydedilecek bir mesafe için sorun.** Bu yüzden projede
"en yakın tesis" sorgusu Turf'e değil, PostGIS'e soruluyor.

### (b) 590 KB — projenin en büyük tek dosyası

Karşılaştırın: Leaflet 148 KB, Chart.js 209 KB, Turf **590 KB**. Turf'ün tamamı yükleniyor
ama **6 fonksiyonu** kullanılıyor.

Modüler kurulum mümkün (`@turf/area`, `@turf/buffer` ayrı paketler) ve boyutu ~50 KB'a
düşürürdü. Bu projede yapılmadı çünkü bir derleme adımı (bundler) gerektiriyor ve proje
**derleme adımsız** olmayı bilinçli tercih ediyor — `docs/` klasörü olduğu gibi
yayınlanabiliyor.

> Bu bir takas: 540 KB fazladan indirme karşılığında sıfır derleme karmaşıklığı.
> Mentöre bunu böyle anlatın — "bilmiyordum" değil, "ölçtüm ve kabul ettim".

### (c) `union` girdilerin geçerli poligon olmasını bekler

Kendisiyle kesişen (self-intersecting) ya da yanlış yönde sarılmış bir poligon verirseniz
Turf sessizce garip sonuç döndürebilir ya da `null` verir. GeoJSON'unuz güvenilir bir
kaynaktan gelmiyorsa temizlemek gerekir.

Bu projede ilçe geometrisi tek kanonik dosyadan (`docs/data/istanbul-districts.geojson`,
39 feature) geliyor ve doğrulanmış durumda — o yüzden sorun çıkmıyor.

---

## 6. Kendin dene

Tarayıcı konsolunda (`http://localhost:8092`):

```js
// 2 km yarıçaplı tamponun alanı ~π×2² = 12,6 km² olmalı
const p = turf.point([28.9850, 41.0369]);          // GeoJSON sırası: [lng, lat]
const b = turf.buffer(p, 2, { units: 'kilometers' });
(turf.area(b) / 1e6).toFixed(1);                   // → ~12.5

// bir ilçenin alanı
const adalar = state.districtsGeoJSON.features.find(f => f.properties.name === 'Adalar');
(turf.area(adalar) / 1e6).toFixed(1) + ' km²';
```

Aynı soruyu **PostGIS'e** sorup karşılaştırın:

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
SELECT name, ROUND((ST_Area(geom::geography)/1e6)::numeric, 1) AS km2
FROM districts WHERE name = 'Adalar';"
```

İki sayı yakın ama **birebir aynı olmayabilir** — tuzak (a) tam olarak bu.

---

## 7. Daha fazlası için

- Resmî doküman: <https://turfjs.org/docs/>
- Bu kitapta: [09 — Frontend ve harita](../09-frontend-harita.md)
- İlgili: [postgis.md](postgis.md) (sunucu tarafı karşılığı), [geojson.md](geojson.md)
