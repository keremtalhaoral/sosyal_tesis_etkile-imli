# Leaflet

## 1. Tek cümlede

Leaflet, tarayıcıda kaydırılıp yakınlaştırılabilir harita gösteren, katman tabanlı, hafif
(~148 KB) açık kaynak JavaScript kütüphanesidir.

**Bu projede:** v1.9.4, `docs/vendor/leaflet/` altında **vendored** (CDN yok).

---

## 2. Hangi problemi çözmek için doğdu

2011'de web haritacılığı ikiye bölünmüştü:

- **Google Maps API** — güçlü ama kapalı, kullanım koşullarına bağlı, kendi karo
  sunucunuzu kullanamıyorsunuz.
- **OpenLayers** — açık ve çok yetenekli, ama o dönem **~500 KB** ve öğrenmesi ağır;
  basit bir "harita göster, üstüne nokta koy" işi için fazlasıyla karmaşık.

Vladimir Agafonkin'in sorusu şuydu: *"İnsanların gerçekten yaptığı işlerin %90'ı için ne
kadar kod gerekir?"* Cevabı Leaflet oldu: **38 KB sıkıştırılmış**, öğrenmesi bir saat,
ve mobilde dokunma hareketleri baştan düşünülmüş.

Temel fikir bir soyutlama: **her şey bir katmandır (layer).** Altlık harita bir katman,
noktalarınız bir katman, poligonlarınız bir katman. Hepsi `addTo(map)` / `remove()` ile
yönetilir. Tek bir kavramla harita üstündeki her şey ifade edilir.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **Google Maps JS API** | zengin, tanıdık, yol tarifi hazır | API anahtarı + faturalandırma; **anahtar tarayıcıda** olmak zorunda; kendi karo sağlayıcınızı seçemezsiniz |
| **OpenLayers** | projeksiyon desteği, WMS/WFS, gerçek GIS | bu proje SRID 4326 dışına çıkmıyor; ağırlık ve öğrenme maliyeti karşılıksız |
| **Mapbox GL JS** | vektör karo, 3B, akıcı | ücretli katman; v2'den beri lisansı kısıtlı; WebGL gerektiriyor |
| **MapLibre GL** | Mapbox GL'in açık çatallanması | vektör karo altyapısı gerekiyor; raster karo bu proje için yeterli |

**Belirleyici sebep:** Bu projenin harita ihtiyacı gerçekten basit — nokta göster,
poligon göster, çizgi çiz, tıklanınca bilgi ver. Leaflet bunların hepsini yapıyor ve
**vendored hâli 148 KB** — depoya koyup offline çalıştırılabilecek boyutta. Mapbox GL
(~800 KB + vektör karo sunucusu) bunu imkânsız kılardı.

---

## 4. Bu projede tam olarak nerede

`docs/app.js` — kullanılan API'ler ve kaç kez:

```
L.polyline      7×   toplu taşıma güzergahları
L.circleMarker  5×   tesis noktaları
L.layerGroup    3×   katmanları açıp kapatmak için gruplar
L.control       3×   özel kontroller (mod rozeti, çevrimdışı notu)
L.latLng        2×   koordinat nesnesi
L.geoJSON       2×   ilçe poligonları
L.DomUtil       2×   özel kontrol DOM'u
L.tileLayer     1×   altlık harita
L.marker        1×   seçili tesis
L.featureGroup  1×   toplu sınır hesabı
```

**Harita başlangıcı:** `.setView([41.015, 28.979], 10)` — İstanbul merkezi, 10. zum.

**İki altlık tema** (`TILE_LAYERS`): CARTO Voyager (açık) ve CARTO Dark (koyu). Projenin
açık/koyu tema desteğiyle birlikte değişiyor.

**Karo nedir?** Harita bir resim mozaiğidir: dünya 256×256 piksellik karelere bölünmüş ve
her zum seviyesinde ayrı bir set var.

```
https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png
                                                      └┬┘ └┬┘ └┬┘
                                                     zum sütun satır
```

Leaflet ekranda ne görünüyorsa o karoları indirir, kaydırdıkça yenilerini ister.

---

## 5. Bilinmesi gereken üç tuzak

### (a) Koordinat sırası Leaflet'te `[lat, lng]`, GeoJSON'da `[lng, lat]`

```js
L.marker([41.0369, 28.9850])                    // Leaflet: enlem, boylam
{"type":"Point","coordinates":[28.9850,41.0369]} // GeoJSON: boylam, enlem
```

**Aynı proje içinde iki farklı sıra.** `L.geoJSON()` dönüşümü kendi yapar, ama elle
koordinat taşırken karıştırmak çok kolay. İstanbul için şanslıyız: ters çevirirseniz nokta
Somali açıklarına düşer ve hata anında görünür.

### (b) Karolar CDN'den gelir — "CDN yok" kuralının tek istisnası

Kütüphaneler vendored, ama **karolar** dışarıdan geliyor. Tüm İstanbul'u her zum
seviyesinde paketlemek gigabaytlar demek; pratik değil.

Sonuç: ağ yoksa harita boş gri kalır. Leaflet varsayılan olarak **kırık resim ikonu**
gösterir ve kullanıcı bunu hata sanar. Projedeki çözüm:

```js
L.tileLayer(config.url, { ...config.options, errorTileUrl: OFFLINE_TILE });
```

`OFFLINE_TILE` gömülü bir gri SVG (data URI — hiç ağ isteği yapmaz), üstüne bir kez
açıklayıcı not düşülür. Hata mesajı yerine **anlamlı bir durum**.

### (c) `invalidateSize()` — gizli haritanın klasik hatası

Harita gizli bir sekmede ya da `display: none` bir kapsayıcıda oluşturulursa, Leaflet
boyutunu **0×0** ölçer. Görünür yapıldığında karolar yanlış yere düşer, harita yarım
görünür.

Çözüm: kapsayıcı görünür olduktan sonra `map.invalidateSize()`. Sebebi anlaşılana kadar
"Leaflet bozuk" hissi veren, aslında tamamen mantıklı bir davranış.

---

## 6. Kendin dene

```bash
# vendored mi, CDN mi?
grep -n "leaflet" docs/index.html
ls -la docs/vendor/leaflet/

# hiçbir CDN referansı yok
grep -rn "unpkg\|jsdelivr\|cdnjs" docs/*.html docs/*.js; echo "çıkış: $? (1 = bulunamadı)"

# arayüzü açın
cd docs && python3 -m http.server 8092    # http://localhost:8092
```

Tarayıcı konsolunda katmanları elle deneyin:

```js
// ilçe poligonlarının kaç tane olduğunu görün
state.districtsGeoJSON.features.length      // 39

// haritayı bir tesise götürün
state.map.setView([41.0369, 28.9850], 15);
```

---

## 7. Daha fazlası için

- Resmî doküman: <https://leafletjs.com/reference.html>
- Başlangıç öğreticisi: <https://leafletjs.com/examples/quick-start/>
- Bu kitapta: [09 — Frontend ve harita](../09-frontend-harita.md)
- İlgili: [geojson.md](geojson.md), [turf.md](turf.md)
