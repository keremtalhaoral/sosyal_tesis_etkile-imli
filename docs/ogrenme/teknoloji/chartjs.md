# Chart.js

## 1. Tek cümlede

Chart.js, HTML `<canvas>` üstüne çizgi/çubuk/halka gibi grafikleri çizen, bildirimsel
yapılandırmayla kullanılan grafik kütüphanesidir.

**Bu projede:** v4.5.1, `docs/vendor/chartjs/chart.umd.min.js` (209 KB), vendored.
`docs/dashboard.html` + `docs/dashboard.js`, **3 grafik**.

---

## 2. Hangi problemi çözmek için doğdu

Web'de grafik çizmenin iki ucu vardı:

- **D3.js** — inanılmaz güçlü, ama bir grafik kütüphanesi **değil**: veri-belge bağlama
  motoru. Basit bir çubuk grafik için eksenleri, ölçekleri, etiketleri, gridi ve
  animasyonu **siz** kurarsınız. Öğrenme eğrisi dik.
- **Hazır widget'lar** (Highcharts, amCharts) — kolay ama ticari lisans.

Chart.js'in (2013) teklifi: **en sık istenen 8 grafik türünü, yapılandırma nesnesiyle.**
Nasıl çizileceğini değil, ne göstermek istediğinizi yazarsınız:

```js
new Chart(ctx, {
  type: 'line',
  data: { labels: […], datasets: [{ label: 'Ciro', data: […] }] },
  options: { responsive: true }
});
```

Eksenler, ölçek, grid, tooltip, animasyon, duyarlı yeniden boyutlanma — hepsi hazır.

**Canvas kullanmasının sonucu:** SVG'den farklı olarak grafik **tek bir resimdir**;
1.000 veri noktasında bile DOM şişmez ve akıcı kalır. Bedeli: bireysel elemanlara CSS
uygulanamaz ve grafik ekran okuyucular için erişilebilir değildir.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **D3.js** | sınırsız esneklik, özel görselleştirme | 3 standart grafik için aşırı; öğrenme maliyeti projenin konusu değil |
| **Plotly.js** | bilimsel grafik, etkileşim zengin | ~3 MB — vendored edilemeyecek boyut |
| **ECharts** | çok yetenekli, harita desteği | ~1 MB; harita işini zaten Leaflet yapıyor |
| **Elle `<canvas>`** | sıfır bağımlılık | eksen/ölçek/tooltip yazmak günler alır ve hata kaynağı olur |
| **Highcharts** | çok cilalı | ticari kullanımda lisans ücreti |

**Belirleyici sebep:** İhtiyaç tam olarak "üç standart grafik" — çizgi, çubuk, halka.
Chart.js bunları yapılandırmayla veriyor ve **209 KB** ile depoya konabiliyor. Plotly ya da
ECharts, projenin "CDN yok, offline çalışsın" kuralını fiilen imkânsız kılardı.

---

## 4. Bu projede tam olarak nerede

`docs/dashboard.js` — üç `new Chart` çağrısı:

| Tür | Ne gösteriyor |
|---|---|
| `line` | zaman içinde ciro / rezervasyon eğilimi |
| `bar` | ilçe ya da tesis kırılımı |
| `doughnut` | durum dağılımı (ör. iptal oranı) |

**Veri kaynağı çift modlu** — [09. bölümdeki](../09-frontend-harita.md) desenin aynısı:

1. Önce canlı API denenir: `/api/analytics/dashboard`, `/api/analytics/revenue`.
2. Erişilemezse `docs/data/analytics.json` anlık görüntüsüne düşülür
   (`npm run export:analytics` ile üretilen, git'te duran türetilmiş dosya).

Yani yayınlanan GitHub Pages sitesinde grafikler **boş kalmıyor**, ama gerçek zamanlı da
değil — ve sayfa bunu söylüyor.

> **Sunum notu:** Halka grafikteki "iptal oranı" uzun süre **yalnız üretilmiş dummy
> veriden** besleniyordu, çünkü rezervasyon iptal ucu yoktu (denetim bulgusu D9).
> `DELETE /api/reservations/:id` eklendikten sonra gerçek kullanımdan besleniyor. Sunumda
> bir rezervasyon iptal edip grafiğin değiştiğini gösterebilirsiniz.

---

## 5. Bilinmesi gereken üç tuzak

### (a) Aynı `<canvas>`'a ikinci grafik çizmek

```
Error: Canvas is already in use. Chart with ID '0' must be destroyed
       before the canvas with ID 'myChart' can be reused.
```

Veriyi yenilerken yeni bir `new Chart` çağırırsanız bu hatayı alırsınız. Doğrusu ya
`chart.destroy()` ya da `chart.data = …; chart.update()`. İkincisi daha iyi — animasyon
korunur ve daha hızlıdır.

### (b) `responsive: true` + `maintainAspectRatio` kapsayıcıya bağımlıdır

Chart.js kapsayıcının boyutunu okur. Kapsayıcının yüksekliği CSS'te tanımlı değilse
grafik ya çok küçük olur ya sonsuza kadar büyür. Kapsayıcıya **sabit yükseklik** vermek
gerekiyor — `<canvas>`'a `height` özniteliği yazmak yetmez, `responsive` onu ezer.

### (c) Para birimi: kuruş → TL dönüşümü **grafikte** yapılır

Projede para her yerde **kuruş** (`amount_minor`) — float yuvarlama hatası olmasın diye
(ADR-001). Grafikte gösterirken 100'e bölmek gerekiyor.

Bunu unutmak sessiz bir hatadır: grafik "1.064.000.000" gösterir, kimse bunun kuruş
olduğunu anlamaz ve rakam 100 kat yanlış okunur. **Yanlış birim, yanlış sayıdan daha
tehlikelidir** — çünkü sayı makul görünür.

---

## 6. Kendin dene

```bash
# vendored mi?
ls -la docs/vendor/chartjs/
grep -n "chartjs" docs/dashboard.html

# sürüm
grep -o "Chart\.js v[0-9.]*" docs/vendor/chartjs/chart.umd.min.js | head -1

# dashboard'u açın
cd docs && python3 -m http.server 8092    # http://localhost:8092/dashboard.html
```

Canlı API'nin ne döndürdüğünü görün:

```bash
curl -s localhost:8085/api/analytics/dashboard | head -c 400; echo
```

Sonra backend'i kapatıp sayfayı yenileyin — grafikler hâlâ çiziliyor, ama artık
`docs/data/analytics.json` anlık görüntüsünden. Rozet farkı da ekranda.

---

## 7. Daha fazlası için

- Resmî doküman: <https://www.chartjs.org/docs/latest/>
- Bu kitapta: [09 — Frontend ve harita](../09-frontend-harita.md)
- Projede: `docs/dashboard.js`, `scripts/export-analytics.js`, `backend/analytics.js`
