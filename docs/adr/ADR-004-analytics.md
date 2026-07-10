# ADR-004: Analytics & Görselleştirme

- **Durum:** Kabul edildi
- **Faz / Dal:** `v2-04-analytics`
- **Tarih:** 2026-07
- **Referans:** DDIA Böl. 3 (OLTP vs OLAP, sütun/satır depolama), Böl. 11 (türetilmiş veri)
- **İlgili:** `backend/analytics.js`, `docs/dashboard.html`, `scripts/export-analytics.js`

## Bağlam

Mentörün isteği: veriyi okuyup **anlamlı görselleştirmek** ("veriye hükmetmek"). v2-03'ün
ürettiği ~197k geçerli rezervasyon + sipariş üstüne "çoook iyi ve görsel açıdan tatmin edici"
bir dashboard. Karar: tam zengin dashboard, Chart.js (vendored/offline), backend canlı API +
Pages snapshot (tek UI, çift veri kaynağı). Chart tasarımı **dataviz** becerisinin doğrulanmış
paletiyle yapıldı (renk körlüğü-güvenli, açık/koyu tema).

## Karar 1 — OLTP vs OLAP: canlı sorgu → rollup, ikisini benchmark

**Karar:** Analitik önce **canlı** SQL agregasyonuyla çalışır (`analytics.js`); sonra gün×tesis
**`daily_stats` rollup**'ından aynı sonuç üretilir. `benchmark()` ikisini ölçer.

**Neden (DDIA Böl. 3):** İşlemsel yazma (rezervasyon) çok sayıda/küçük = **OLTP**; dashboard
sorgusu az sayıda/tüm geçmişi tarayan = **OLAP**. Büyük sistemler bunları ayrı veri ambarında
tutar; bizim ölçeğimizde aynı SQLite içinde rollup tablosu doğru orta yol. Canlıyla başlamak
erken optimizasyondan kaçınır; rollup "ne zaman gerekir"i **ölçülen sayıyla** gösterir.

**Ölçülen (197k rezervasyon):** aylık ciro sorgusu **canlı 633 ms → rollup 3.6 ms ≈ 178× hızlanma**.
Ders net: aynı cevap, iki büyüklük mertebesi fark. Rollup, tüm ham satırları taramak yerine
gün×tesis özetini tarar.

## Karar 2 — daily_stats türetilmiş veri: rebuild, artımlı değil

**Karar:** `rebuildDailyStats()` daily_stats'ı kaynaktan (reservations/orders) **yeniden inşa
eder** (DELETE + toplu INSERT, tek transaction). Artımlı (her yazmada güncelle) DEĞİL.

**Neden (DDIA Böl. 11):** daily_stats **türetilmiş veri**dir — kaynaktan her an yeniden üretilebilir.
Bu ölçekte rebuild saniyeler sürer ve **kesin doğrudur** (kayma/drift riski yok). Artımlı bakım
daha hızlı ama tutarlılık kodu karmaşıktır; ihtiyaç doğana dek eklemiyoruz (ölçek-uygun tasarım).
Testte kanıtlandı: **rollup sorgusu == canlı sorgu** (birebir).

## Karar 3 — Chart.js vendored + dual-mode dashboard (backend canlı / Pages snapshot)

**Karar:** Tek sayfa (`docs/dashboard.html`) iki veri kaynağı: açılışta canlı API denenir,
erişilemezse `docs/data/analytics.json` snapshot'ına düşer. Chart.js `docs/vendor/`'a alındı.

**Neden:** GitHub Pages sunucusuzdur → canlı DB'ye erişemez. `export-analytics.js` merkezi
verinin **türetilmiş replikasını** (Böl. 11) `analytics.json` olarak yazar (~183 KB, tüm
granülerlikler önceden hesaplı). Aynı UI hem geliştirmede canlı gerçek veriyle, hem publik
demoda offline snapshot'la çalışır. CDN yok (Leaflet/Turf gibi vendored) → her ağda açılır.

## Karar 4 — Chart tipi = verinin işine göre (dataviz yöntemi)

| Metrik | Form | Neden |
|---|---|---|
| KPI'lar (ciro, rezervasyon, ort. grup, iptal %) | Stat tile (hero sayı) | Tek değer — chart değil |
| Ciro / bebe sandalyesi | Zaman serisi (alan/çizgi) | Değişim-zaman içinde |
| İptal oranı | Bar (dönem) | Dönemsel büyüklük kıyası |
| Doluluk (gün×slot) | Isı haritası (sıralı mavi rampa) | 2B yoğunluk; tek hue light→dark |
| Tesis kıyas / kategori satış | Yatay bar | Kimlik başına büyüklük sıralaması |
| Ödeme tipi | Donut (kategorik) | Bütünün parçası, az kategori |

**Renk:** dataviz doğrulanmış paleti — kategorik hue'lar sabit sırada (CVD ΔE 24.2 ≥ 12),
sıralı tek-hue mavi rampa ısı haritasında, tema-farkında (açık/koyu ayrı doğrulanmış adımlar).
Kontrast WARN'ı olan slotlar legend/etiketle "relief" ediliyor (renk-tek-başına değil).
Tek seri chart'larda legend yok (başlık adlandırır); donut'ta legend + etiket var.

## Karar 5 — Granülerlik: gün/hafta/ay/yıl tek fonksiyonla

**Karar:** `dateBucket(granularity)` tarih grup anahtarını üretir: gün=`reserve_date`,
hafta=`strftime('%Y-W%W')`, ay=`substr(...,1,7)`, yıl=`substr(...,1,4)`. Dashboard toggle'ı
canlı modda yeniden sorgular, snapshot modda `byGranularity`'den okur.

## Bilinen borç / sonraki adımlar
- **Artımlı rollup** (yazmada güncelleme) — büyük ölçekte gerekirse.
- **occupancy% görüntüleme metriği** hâlâ canlı booking'i yansıtmıyor (ADR-003 borcu); dashboard
  doluluk ısı haritası zaten gerçek rezervasyonlardan türüyor.
- **Sütun-tabanlı depolama** (gerçek OLAP) — PostgreSQL/DuckDB'ye geçişte (Böl. 3).
- Snapshot elle `export-analytics.js` ile üretiliyor; ileride CI adımı olabilir.
