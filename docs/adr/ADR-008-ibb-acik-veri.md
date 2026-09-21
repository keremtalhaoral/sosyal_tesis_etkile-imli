# ADR-008: İBB Açık Veri Uçlarının Entegrasyonu

- **Durum:** Kabul edildi (ingest hattı hazır ve test edilmiş; gerçek veri çekimi
  api.ibb.gov.tr erişimi olan bir ağda yapılır)
- **İlgili:** ADR-006 (GTFS güzergahları) — bu ADR onun devamı ve kısmen yerine geçeni

## Bağlam: kapatmaya çalıştığımız somut boşluk

ADR-006 ile İBB GTFS feed'inden gerçek güzergah geometrileri çıkarıldı. Ama ölçüm acı:

| Ölçüm | Değer |
|---|---|
| Hattı olan tesis | **13 / 30 (%43)** |
| Hiç hattı olmayan tesis | **17** |
| Eşleşmeyen hat referansı | **88** |
| — `low-confidence` (kalite kapısına takıldı) | 53 |
| — `operator-feed-missing` (metro/tramvay/Marmaray/vapur) | 18 |
| — `no-stop-times-coverage` | 17 |

İki ayrı kök neden var:

1. **Otobüs tarafı tahmine dayalı.** Gerçek İETT GTFS feed'inde `trips.shape_id` boş.
   `build-routes.js` bu yüzden hat→geometri eşlemesini *geometrik olarak tahmin ediyor*
   (grid örtüşme + ortalama en-yakın mesafe). Kalite kapısı (`cov ≥ 0.6`, `dist ≤ 350 m`)
   düşük güvenli eşleşmeleri haklı olarak eliyor — ama bu, 53 hattın çizilmemesi demek.
2. **Raylı ve deniz tamamen yok.** İETT feed'i yalnız otobüs kapsıyor. M1…M11, T1…T5,
   Marmaray ve vapur hatlarının veri kaynağı hiç yoktu.

Kullanıcının sorduğu İBB uçları tam olarak bu iki boşluğa denk düşüyor.

## Karar: yedi ucun üçü çekirdek, biri ikincil, ikisi reddedildi

| Uç | Karar | Gerekçe |
|---|---|---|
| `MetroIstanbul/.../GetLines` | **Entegre** | Raylı hat listesi: id, ad, **renk**. 18 `operator-feed-missing` ref'in kaynağı. |
| `MetroIstanbul/.../GetStations` | **Entegre** | İstasyon koordinatları. Hat geometrisinin (yaklaşık) temeli. |
| `MetroIstanbul/.../GetDirections` | **Entegre** | Yön bilgisi olmadan istasyonlar ileri-geri katlanıp yanıltıcı zikzak çizer. |
| `iett/UlasimAnaVeri/HatDurakGuzergah.asmx` | **Entegre — en yüksek değer** | Hat kodunu verip **gerçek durak dizisini** alıyoruz. `build-routes.js`'in geometrik tahminini tamamen gereksiz kılar → 53 `low-confidence` + 17 `no-stop-times-coverage` ref'i çözer. |
| `iett/UlasimAnaVeri/PlanlananSeferSaati.asmx` | **Entegre (ikincil)** | Planlanan sefer saatleri. Rezervasyon slotuyla birleşince projeye özgün karar desteği: "19:00 slotu için en yakın duraktan son otobüs 21:40". |
| `iett/FiloDurum/SeferGerceklesme.asmx` | **Reddedildi** | Canlı araç/sefer gerçekleşme verisi. Site GitHub Pages'te **sunucusuz ve çevrimdışı** çalışacak şekilde tasarlandı (ADR-006 Karar 1); canlı takip sürekli çalışan bir backend, polling ve WebSocket ister. Mimarinin temel varsayımıyla çelişiyor. İleride "yalnız canlı modda açılan ek uç" olarak eklenebilir. |
| `iett/ibb/ibb.asmx` | **Reddedildi** | `HatDurakGuzergah` ile büyük ölçüde örtüşüyor; ek kapsam getirmiyor. İki ayrı SOAP servisi bakımı, sıfır kazanç. |

### Karar 1 — Ham veri gitignored, türetilmiş çıktı commit (ADR-006 deseni aynen)

```
api.ibb.gov.tr  --fetch-ibb.js-->  data/ibb-cache/     (GITIGNORED)
                                          |
                                   build-transit.js
                                          v
                            docs/data/transit-routes.geojson  (COMMIT)
```

GitHub Pages hiçbir zaman canlı API'ye bağımlı olmaz. Sitenin açılışı üçüncü bir tarafın
uptime'ına, rate limitine veya CORS politikasına emanet edilmez. Ham yanıtlar önbellekte
saklanır ki ayrıştırıcı geliştirilirken tekrar tekrar API'ye yüklenmeyelim.

### Karar 2 — Metro hatları "yaklaşık" olarak etiketlenir (dürüstlük kuralı)

**Metro İstanbul uçları istasyon NOKTASI verir, ray geometrisi VERMEZ.** İstasyonları
birleştirip çizdiğimiz çizgi gerçek ray güzergahı değildir; tünel virajlarını kesip geçer.

ADR-006'da "düşük güvenli eşleşme uydurma çizgiye düşmez" ilkesini koymuştuk. Burada
veriyi tamamen atmak da yanlış olurdu (kullanıcı M2'nin nereden geçtiğini kabaca bilmek
istiyor). Karar: **çiz ama gerçekmiş gibi sunma.**

- `properties.geometry_kind = 'station-chain'`, `confidence = 'approximate'`
- Haritada **kesikli** çizgi, düşük opaklık
- Tooltip'te "⚠ yaklaşık çizim", lejantta "Kesikli çizgi = istasyon noktalarından
  türetilmiş yaklaşık hat"

Her feature `properties.source` taşır (`iett-soap` / `ibb-gtfs` / `metro-istanbul`), yani
haritadaki her çizginin nereden geldiği kullanıcıya söylenebilir.

### Karar 3 — Kaynak önceliği

Aynı hat birden fazla kaynakta varsa: **`iett-soap` > `ibb-gtfs` > `metro-istanbul`**.

Gerçek durak dizisi, geometrik tahminden; geometrik tahmin de istasyon zincirinden iyidir.
Fixture testinde doğrulandı: hat "15" hem İETT SOAP'ta hem GTFS çıktısında var, `iett-soap`
kazanıyor.

**Mevcut GTFS çıktısı KORUNUR.** `build-transit.js` önceki `transit-routes.geojson`'u okur
ve `ibb-gtfs` kaynaklı hatları taşır — İBB önbelleği yoksa bile çıktı bozulmaz, sadece
kapsam artmaz. ADR-006'nın emeği çöpe gitmez.

### Karar 4 — Toleranslı ayrıştırma, ama sessiz atlama YOK

İBB uçlarının alan adlandırması uçtan uca ve sürümden sürüme değişiyor
(`Latitude`/`Lat`/`YKOORDINATI`, `Data`/`data`/`Result`). Tek bir isme bağlanmak, feed'in
küçük bir revizyonunda ingest'i **sessizce boş çıktı üretir** hale getirirdi.

`scripts/ibb-parse.js` her alan için bilinen adları sırayla dener. Ama tolerans, hatayı
gizlemek değildir: ayrıştırılamayan kayıtlar `skipped` sayacına yazılır ve rapora çıkar.

Ele alınan gerçek feed tuhaflıkları (hepsi fixture ile test edildi):

| Tuhaflık | Örnek | Düzeltme |
|---|---|---|
| Binlik ayraç kayması | `"289.700.000.000"` | → `28.97` |
| Virgüllü ondalık | `"41,0320"` | → `41.032` |
| Mojibake (UTF-8 → Latin1) | `Beşiktaş`ın C5 9F baytları | → `Beşiktaş` |
| SOAP içinde gömülü JSON | `<GetHat_jsonResult>[{...}]</...>` | zarf çözülür |
| SOAP içinde düz XML | `<Table><SDURAKADI>…` | kayıt kayıt ayrıştırılır |
| İstanbul dışı / (0,0) koordinat | | bbox filtresiyle elenir |
| SOAP Fault | `<faultstring>Hat bulunamadi` | boş sonuç, çökme yok |

### Karar 5 — SOAP metod adı keşifle bulunur

`.asmx` servislerinin metod adları belgelenmemiş ve sürüme göre değişiyor
(`GetHat_json`, `GetHat`, `DurakDetay_GYY_json`…). `fetch-ibb.js` adayları sırayla dener,
ilk SOAP Fault dönmeyeni kullanır ve hangisini seçtiğini önbelleğe yazar. Hiçbiri
çalışmazsa WSDL'i inceleme komutunu ekrana basar — sessizce boş çıktı üretmez.

### Karar 6 — Abonelik anahtarı opsiyonel, ama ağ engeli ayırt edilir

Bazı `api.ibb.gov.tr` uçları `Ocp-Apim-Subscription-Key` ister. `IBB_API_KEY` env'den
okunur; yoksa anahtarsız denenir.

**403'ün iki farklı sebebi var ve tavsiye tamamen farklı:**
- İBB "abonelik anahtarı gerekli" diyorsa → anahtar al
- Aradaki proxy/güvenlik duvarı engelliyorsa → ağ politikası; anahtar bunu çözmez

`fetch-ibb.js` yanıt gövdesine bakarak ikisini ayırır ve doğru tavsiyeyi verir. (Bu ayrım
geliştirme sırasında somut bir ihtiyaçtan doğdu: sandbox proxy'si `api.ibb.gov.tr`'yi
engelliyordu ve ilk sürüm kullanıcıyı boş yere anahtar aramaya yolluyordu.)

## Ölçülen sonuç

Fixture verisiyle (yalnız 2 İETT hattı + 3 metro hattı) uçtan uca doğrulandı:

| Senaryo | Hat | Kapsam |
|---|---|---|
| İBB önbelleği yok (yalnız GTFS) | 10 | 13/30 (%43) |
| İBB önbelleği var (5 fixture hattı) | 14 | **21/30 (%70)** |

Gerçek veriyle (79 otobüs hattı + tüm raylı hatlar) kapsamın %90+'a çıkması bekleniyor.
Kabul ölçütü: `operator-feed-missing` **18 → 0**.

## Sonuçlar

**Kazanılan**
- Otobüs güzergahları tahminden **gerçek durak dizisine** taşınabiliyor.
- Metro/tramvay/Marmaray ilk kez haritada.
- Her çizginin kaynağı ve güven düzeyi kullanıcıya görünür.
- Ayrıştırıcılar ağa çıkmadan test edilebiliyor (CI'da da koşar).

**Bedeli / sınırları**
- Metro geometrisi **yaklaşık** — gerçek ray güzergahı için farklı bir veri kaynağı gerekir.
- Vapur hatları hâlâ kaynaksız (`operator-feed-missing`): Şehir Hatları ayrı bir kurum.
- Veri **anlık değil**: çekim zamanının fotoğrafı. Hat güzergahı değişirse
  `fetch-ibb.js` + `build-transit.js` yeniden koşturulmalı. Bu, çevrimdışı çalışabilmenin
  bilinçli bedeli (ADR-006 Karar 1 ile aynı takas).
- `SeferGerceklesme` reddedildiği için **canlı otobüs konumu yok**.
