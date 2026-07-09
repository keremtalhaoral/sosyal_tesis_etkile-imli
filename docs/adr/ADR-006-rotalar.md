# ADR-006: Gerçek Toplu Taşıma Güzergahları (GTFS → çevrimdışı geometri)

- **Durum:** Kabul edildi (kısmi veri; tam kapsam EKSİKSİZ `stop_times`'a bağlı — Karar 6)
- **Faz / Dal:** `v2-06-transit-routing`
- **Tarih:** 2026-07
- **Referans:** DDIA Böl. 3 (türetilmiş/materialize veri), Böl. 4 (şema evrimi), Böl. 12 (batch türetme)
- **İlgili:** `scripts/build-routes.js`, `backend/test-routes.js`, `docs/data/transit-routes.geojson`,
  `docs/app.js` (`TransitRoutes`), `ADR-004` (canlı vs türetilmiş)

## Bağlam

Mentör 2. maddesi: haritada otobüs/metrobüs/vapur/ray/yürüme **düz çizgi** çiziliyordu
("kestirmeden dümdüz gidilmez"). Eski `Routing.drawTransitRoute` canlı bir OSRM sürüş
endpoint'ine gidiyor, başarısız olunca iki nokta arasını **interpolasyonla düzleştiriyordu** —
yani gerçek güzergah değil. Bu faz düz çizgileri **gerçek hat geometrileriyle** değiştirir.

**Ağ gerçeği (doğrulandı):** Bu ortamın egress politikası İstanbul açık-veri/toplu-taşıma
kaynaklarını (`data.ibb.gov.tr`, Overpass, İETT, Şehir Hatları, public OSRM) **403 ile
reddediyor**; yalnız GitHub + paket kayıtları açık. Bu yüzden veriyi çalışma-zamanında
**çekemeyiz**. Karar: resmi **GTFS feed'ini kullanıcı sağlar**, biz batch işleyip **türetilmiş
slim GeoJSON'u repoya işleriz** (districts.geojson deseni; çevrimdışı/Pages için canlı API'siz).

## Karar 1 — Kapsam: gerçek hat GEOMETRİSİ, sefer planlama DEĞİL (ölçek-uygun)

**Karar:** Her hattın **temsili gerçek güzergahını** (GTFS `shapes`) çiziyoruz; tam A→B çok-modlu
**sefer planlama** (aktarma, süre, kalkış) KAPSAM DIŞI.

**Neden:** Sefer planlama OpenTripPlanner + tam GTFS + servis takvimi ister; tarayıcıda
çevrimdışı infeasible. Ödevin ihtiyacı "gerçek çizgiler" — onu materialize etmek DDIA "türetilmiş
veri" desenine (Böl. 3) tam oturur ve ölçek-uygundur ("kralı gelse zorlamaz" = doğru problemi
doğru boyutta çöz).

## Karar 2 — Türetilmiş slim GeoJSON commit edilir; ham GTFS gitignore

**Karar:** `build-routes.js` GTFS → `docs/data/transit-routes.geojson` (yalnız tesislere hizmet
veren hatlar + yürüme bacakları + tesis→hat indeksi). Ham GTFS (`data/gtfs/`, ~40 MB) **gitignored**;
türetilmiş çıktı (~KB'ler) commit edilir.

**Neden (Böl. 3, 12):** Ham feed büyük, üçüncü-taraf ve sık değişmez; türetilmiş görünüm küçük ve
tam da UI'ın ihtiyacı. Kanonik kaynaktan (GTFS) batch ile yeniden üretilebilir → repo şişmez,
Pages çevrimdışı çalışır. (Aynı "canonical seed → derived app.db" ilkesi.)

## Karar 3 — Gerçek İETT feed'i tuhaflıkları ve ele alınışı

Resmi İBB/İETT feed'i "temiz GTFS" değil; `build-routes.js` şunları **savunmacı** ele alır:

| Sorun | Örnek | Çözüm |
|---|---|---|
| Dosya-başına **değişken sınırlayıcı** | routes/trips/stops/stop_times `;`, shapes/agency `,` | başlık satırından otomatik sniff (`;` vs `,`) |
| **Bozuk durak koordinatı** (binlik ayraç) | `410.191.700.005.564` | `→ 41.0191700005564` (rakamları al, 2-hane tam kısım) |
| `route_long_name` **mojibake** (UTF-8'in Latin1 çözülmesi) | `KADIKÃ–Y` | `fixText` ile geri decode (yalnız görüntü) |
| `.txt` yerine `.csv` uzantısı | — | her iki uzantı denenir |

15.390 durağın 15.382'si düzgün un-mangle olur; 8'i Excel'in bilimsel-gösterime çevirdiği
(`4,12E+14`) bozuk hücre → İstanbul bbox filtresiyle atılır.

## Karar 4 — route→shape bağı YOK → GEOMETRİK eşleme (kritik)

**Sorun:** Bu feed'de `trips.csv`'de **`shape_id` yok** (953 gerçek shape var ama hangi hatta ait
olduğu yazmıyor). Doğrudan route→shape anahtarı yok.

**Karar:** İki-mod otomatik: `trips`'te `shape_id` doluysa **direct** (sentetik fixture yolu);
değilse **geometric**: hat → temsili sefer → **durak dizisi** (`stop_times` + un-mangle'lı
`stops`) → durakları **en iyi saran shape polyline**'ı. Eşleme iki aşamalı: (a) ~200 m grid
hücre **örtüşme** (hızlı ön-eleme, topK), (b) topK içinde durak-başına **ortalama en-yakın shape
noktası** mesafesi (kesin skor).

**Neden:** Geometri yalnız `shapes`'te; hatla tek bağ, hattın duraklarının o polyline üstünde
olması. "En iyi saran" = doğru shape. (Bir tür mekansal eşleme; Böl. 3 mekansal index ruhunda.)

## Karar 5 — Kalite kapısı: "emin ol" (uydurma çizgi yok)

**Karar:** Geometric modda bir hat, ancak **örtüşme ≥ 0.6 VE ortalama sapma ≤ 350 m** ise çizilir
(`--cov`, `--dist`). Geçemeyen ref `meta.unmatched`'e **sebebiyle** yazılır
(`no-stop-times-coverage`, `low-confidence(...)`, `operator-feed-missing`); asla düz çizgiye
düşülmez.

**Neden:** Mentör "gerçek güzergahları doğru çekelim, **emin ol**" dedi. Az ama **doğru** hat,
çok ama yanlış hattan iyidir. Yürüme bacağı ise tüm tesislere çizilir (en yakın **gerçek** durak;
`stops` tam) — dürüstçe "yaklaşık son-yürüyüş" olarak etiketlenir (çevrimdışı yaya ağı yok).

## Karar 6 — VERİ SINIRI: `stop_times` KESİK (Excel 1.048.576 limiti)

**Bulgu:** Sağlanan `stop_times.csv` tam **1.048.576 satırda** kesik (Excel/CSV satır limiti);
135.625 seferin yalnız **18.934'ü** (dar bir `trip_id` bandı) içeride. Sonuç: geometrik eşleme
için durak dizisi olan hat sayısı çok düşük.

**Etki (bu commit'te):** 79 otobüs ref'inden yalnız birkaçı yüksek güvenle çözülüyor
(`11A`, `134YK` — tesis 7 Çamlıca ve tesis 9 Dragos), **metrobüs (34\*) hiç** çözülmüyor
(o seferler kesikte kalmış). 30 tesisin **hepsi** gerçek yürüme bacağı alır. `meta.warning`
bu durumu çıktının içine yazar.

**Unblock:** EKSİKSİZ `stop_times.txt` (GTFS zip'inden, ~5M+ satır) `data/gtfs/` altına konup
`node scripts/build-routes.js` yeniden çalıştırılınca ~62 hat + metrobüs **kalite kapısını
geçerek** dolar. Makine hazır; tek eksik tam veri. (Ray/vapur ayrı operatör feed'leri —
Metro İstanbul, Şehir Hatları — eklenince aynı boru hattı çizer; şimdilik `operator-feed-missing`.)

**Neden dürüstçe kaydediyoruz (DDIA ethos):** Karar-belgeleme birincil. Veri kalitesi sınırı bir
mimari gerçektir; onu gizleyip yanlış çizgi üretmek yerine kapıyla eleyip ADR'de kayda geçiriyoruz.

## Alternatifler (reddedilenler)

- **Canlı OSRM/OTP çağrısı:** egress 403; çevrimdışı Pages hedefiyle çelişir.
- **route_long_name uç-noktalarından shape tahmini** (stop_times'sız): yer-adı eşleştirme çok
  gürültülü; "emin ol" ilkesini ihlal eder (yanlış hat riski).
- **Eski interpolasyon (düz çizgi):** tam da kaldırdığımız sorun.

## Sonuç

`build-routes.js` (sıfır bağımlılık, iki-mod, kalite kapılı) + fixture testi (`test-routes.js`,
17/17) + türetilmiş `transit-routes.geojson` + frontend `TransitRoutes` (gerçek polyline + mod
legend, düz-çizgi çizimi kaldırıldı). Tam otobüs/metrobüs kapsamı EKSİKSİZ `stop_times` gelince
tek komutla dolar (Karar 6).
