# GTFS

## 1. Tek cümlede

GTFS (General Transit Feed Specification), toplu taşıma operatörlerinin hat, durak, sefer
ve güzergah verisini yayınladığı **dünya standardı** formattır: bir ZIP içinde bir avuç
CSV dosyası.

**Bu projede:** İBB'nin GTFS verisi → `docs/data/transit-routes.geojson` (türetilmiş,
93 KB). Ham GTFS `.gitignore`'da.

---

## 2. Hangi problemi çözmek için doğdu

2005'te Portland'da (TriMet) Bibiana McHugh'ın istediği şey basitti: *"Google Maps'te
otobüsle yol tarifi çıksın."*

Sorun şuydu: her toplu taşıma idaresinin verisi **kendi formatındaydı.** Google'ın 500
ayrı şehirle 500 ayrı entegrasyon yazması gerekirdi. Chris Harrelson ile birlikte ortak
bir format tanımladılar. Bugün **dünyada binlerce operatör** — İBB dahil — bu formatta
yayın yapıyor.

**Tasarım kararı öğretici:** XML ya da özel bir ikili format değil, **CSV.** Çünkü hedef
kitle yazılım şirketleri değil, belediye ulaşım daireleriydi. CSV'yi Excel'de açabilirsiniz.
Standardın yayılmasını sağlayan şey teknik üstünlüğü değil, **düşük giriş engeliydi.**

### Dosyalar

```
agency.txt      operatör bilgisi
routes.txt      hatlar               (34, M2, T1 …)
trips.txt       seferler             (bir hattın belirli yöndeki tek gidişi)
stops.txt       duraklar             (koordinatlarıyla)
stop_times.txt  hangi sefer hangi durağa saat kaçta uğruyor   ← en büyük dosya
shapes.txt      hattın gerçek çizgisi (koordinat dizisi)      ← bu proje için kritik
calendar.txt    hangi sefer hangi günlerde çalışıyor
```

### Neden `shapes.txt` kritik?

Durakları düz çizgiyle birleştirirseniz **metro hattı binaların içinden, otobüs denizden
geçer.** `shapes.txt` aracın gerçekten izlediği yolu verir — Boğaz'ı dolanan, viyadükten
geçen, sokak sokak ilerleyen gerçek geometri.

Bu projedeki güzergah çizgileri oradan geliyor. `geometry_kind: "shape"` etiketi bunu
söylüyor; durak zincirinden türetilmiş yaklaşık geometriler ayrı etiketleniyor.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Ne | Bu projede neden değil |
|---|---|---|
| **GTFS-Realtime** | anlık araç konumu, gecikme (Protobuf) | proje **statik** güzergah gösteriyor, canlı takip değil; ayrı abonelik ve sürekli bağlantı ister |
| **İETT SOAP servisleri** | hat-durak-güzergah sorgusu | denendi ve kodu duruyor (`fetch-ibb.js`); ama bu ortamda ağ engelli, ayrıca `shapes` kalitesinde geometri vermiyor |
| **OpenStreetMap ilişkileri** | topluluk verisi, ücretsiz | güncellik ve kapsam operatöre göre değişken; resmî kaynak varken tercih edilmez |
| **Elle çizmek** | tam kontrol | **uydurma veri** demek — projenin kabul etmediği şey |

**Belirleyici sebep:** GTFS **operatörün kendi resmî verisi.** Kalite tartışması olduğunda
kaynağı gösterebiliyorsunuz.

---

## 4. Bu projede tam olarak nerede

`scripts/build-routes.js`: GTFS → GeoJSON dönüşümü.

### Kalite kapısı — projenin en dürüst kararı

Sorun: `seed.json` bir tesis için *"34 Metrobüs ile ulaşılır"* diyor, ama GTFS'te hat
kodları farklı yazılmış olabilir (`34`, `34G`, `34 METROBÜS`…). Yanlış eşleştirirsek
**haritada uydurma bir çizgi** belirir ve kimse fark etmez.

İki eşik:

```js
const COV_MIN  = 0.6;   // hattın duraklarının en az %60'ı shape'e oturmalı
const DIST_MAX = 350;   // durakların shape'e ortalama uzaklığı en fazla 350 m
```

Geçemeyen eşleşme **çizilmez** — ve sessizce atılmaz, sebebiyle kaydedilir:

```
low-confidence(cov=0.42,dist=890m)
```

### Sonuç — sayılarla

```
10 hat çizgisi + 30 yürüme bağlantısı = 40 feature
kapsam: 30 tesisin 13'ü (%43)
eşleşemeyen: 88 hat
  ├─ 81 "not-in-any-source"      → hat hiçbir kaynakta yok
  └─  7 "operator-feed-missing"  → vapur (İDO / Şehir Hatları GTFS yayınlamıyor)
```

Geçen eşleşmeler kendi kanıtını taşıyor:

```
34 (Metrobüs)   örtüşme: 0.77 | sapma: 180m | geometric-match
15              örtüşme: 0.88 | sapma:  35m | geometric-match
15T             örtüşme: 0.77 | sapma: 113m | geometric-match
11A             örtüşme: 0.71 | sapma: 127m | geometric-match
134YK           örtüşme: 0.67 | sapma: 281m | geometric-match
```

> **%43 düşük bir sayı ve bu bilinçli.** Eşikleri gevşetseydim haritada 30/30 çizgi
> olurdu — ama bir kısmı yanlış olurdu ve **bunu ben de bilemezdim.** Dürüst %43,
> güzel görünen %100'e tercih edildi.

### Ham GTFS neden git'te değil?

`data/gtfs/` `.gitignore`'da. İki sebep: yüzlerce MB, ve **türetilebilir**. Git'te duran
şey türetilmiş 93 KB'lık çıktı ve **üretim tarifi** (script).

Bu, DDIA'nın **kaynak veri / türetilmiş veri** ayrımının doğrudan uygulaması: türetilmiş
veri yeniden üretilebilir, o yüzden versiyon kontrolüne gerek yok — ama tarif kaybolmamalı.

---

## 5. Bilinmesi gereken üç tuzak

### (a) `stop_times.txt` EKSİKSİZ olmalı

GTFS'in en büyük dosyası budur — büyük bir şehirde milyonlarca satır. Kısmi indirilirse
(ZIP kesilirse, disk dolarsa) script **hata vermez**: sadece daha az hat eşleşir ve
kapsam sessizce düşer.

Projede `CLAUDE.md` bunu açıkça not ediyor: *"`stop_times` EKSİKSİZ olmalı; kesikse kapsam
kısıtlı."* Yani düşük kapsam gördüğünüzde ilk bakılacak yer burasıdır.

### (b) `route_short_name` benzersiz değildir

İki farklı operatörün hattı aynı kısa adı taşıyabilir (`15`). Ayrıca aynı hat gidiş ve
dönüş için ayrı `trip` kayıtlarına sahiptir ve bunların `shape_id`'leri farklıdır.

Naif bir "kısa ada göre eşleştir" yaklaşımı yanlış geometriyi seçebilir. Projedeki çözüm
**geometrik doğrulama**: eşleşme, durakların shape'e oturup oturmadığıyla sınanıyor —
isim benzerliğine güvenilmiyor.

### (c) Vapur hatları GTFS'te yok

İDO ve Şehir Hatları GTFS yayınlamıyor. Bu bir hata değil, **veri boşluğu** — ve proje
bunu uydurmak yerine `operator-feed-missing` olarak işaretliyor (7 hat).

> **Ders:** Eksik veriyi doldurmak cazip gelir; kaydetmek daha değerlidir. Uydurulan
> veri, üstüne kurulan her kararı sessizce bozar.

---

## 6. Kendin dene

```bash
# çıktının kendi kalite raporu
node -e "
const g=JSON.parse(require('fs').readFileSync('docs/data/transit-routes.geojson','utf8'));
console.log('hat:', g.meta.line_count, '| yürüme:', g.meta.walk_count);
console.log('kapsam: %' + g.meta.coverage.pct,
            '(' + g.meta.coverage.facilities_with_lines + '/' + g.meta.facility_count + ')');
const r={}; Object.values(g.meta.unmatched).forEach(x=>r[x]=(r[x]||0)+1);
console.log('eşleşemeyen', g.meta.unmatched_count, '→', r);
"

# her hattın kanıtı
node -e "
const g=JSON.parse(require('fs').readFileSync('docs/data/transit-routes.geojson','utf8'));
g.features.filter(f=>f.properties.kind==='line')
 .forEach(f=>console.log(f.properties.ref.padEnd(22),
   'örtüşme:', f.properties.match_cov, '| sapma:', f.properties.match_dist_m+'m'));
"

# ham GTFS'in git'te olmadığını doğrulayın
git check-ignore -v data/gtfs/

# eşikleri değiştirip etkisini görün (ham GTFS varsa)
node scripts/build-routes.js --cov=0.4 --dist=600   # gevşek → daha çok çizgi, daha az güven
```

---

## 7. Daha fazlası için

- Spesifikasyon: <https://gtfs.org/documentation/schedule/reference/>
- Açık veri kaynakları: <https://mobilitydatabase.org/>
- Bu kitapta: [10 — Veri nereden geliyor](../10-veri-nereden-geliyor.md)
- Projede: `docs/adr/ADR-006-*.md`, `scripts/build-routes.js`, `backend/test-routes.js`
