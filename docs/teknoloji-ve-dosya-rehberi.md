# Teknoloji ve Dosya Rehberi (Yaşayan Katalog)

Bu belge, projedeki **her teknolojinin neden seçildiğini** ve **her dosyanın ne işe yaradığını**
tek tek açıklar. Amaç: projeyi devralan birinin (veya gelecekteki senin) "bu dosya niye var, bu
kütüphane neden burada?" sorusuna tek yerden cevap bulması.

> **Yaşayan belge kuralı (sözleşme).** Projeye yeni bir dosya, klasör veya teknoloji eklendiğinde
> ilgili tablo satırı ve gerekiyorsa "Teknoloji kataloğu" güncellenir; en sona **Değişiklik günlüğü**
> satırı eklenir. Bu kural `CLAUDE.md > Sözleşmeler` içinde de kayıtlıdır. Böylece belge kod ile
> birlikte büyür, geride kalmaz.

İlgili belgeler: mimari kararların **gerekçeleri** `docs/adr/` (ADR-001…007) ve `DATABASE.md`'de;
proje giriş kapısı `CLAUDE.md`. Bu belge onların yerine geçmez — "ne / nerede" haritasıdır,
"neden" derinliği ADR'lerdedir.

---

## 1. Büyük resim (bir paragraf)

İstanbul sosyal tesisleri için **etkileşimli Web GIS + karar destek** sistemi: harita, rezervasyon,
sipariş, İSPARK doluluk, analitik dashboard. İki çalıştırılabilir parça aynı veriyi paylaşır:
**Node/Express backend** (tek backend, asıl API) ve **`docs/` statik frontend** (GitHub Pages,
sunucusuz). Proje **tek dillidir** (Node). Tek gerçek kaynak **PostgreSQL 16 + PostGIS 3.4**
(ADR-009); kanonik başlangıç verisi `data/seed.json`. Rehber ilke **DDIA (Kleppmann)** —
her karar bir ADR'de.

```
                    data/seed.json  (kanonik, git'te)
                            │  seed
                            ▼
   backend/ (Node) ───┐
                      ├──► PostgreSQL 16
   scripts/ ─────────┘      + PostGIS 3.4
                            │  türetilir (export-analytics.js)
                            ▼
   docs/ (GitHub Pages, statik) ──► tarayıcıda localStorage + JSON snapshot (çevrimdışı replika)
```

---

## 2. Teknoloji kataloğu

Her teknoloji için: **ne**, **neden seçildi**, **nerede**, **alternatifi**.

### Backend & veri
- **Node.js + `pg`** — *Ne:* JS runtime + PostgreSQL sürücüsü (bağlantı havuzlu).
  *Neden:* PostGIS'e ve gerçek çok-yazıcılı eşzamanlılığa erişim. Eskiden `node:sqlite` kullanılıyordu
  ("DB için sıfır dış bağımlılık"); bu iddia ADR-009 ile bilinçli olarak terk edildi.
  *Nerede:* `backend/database.js`,
  `backend/db.js`. *Alternatif:* `better-sqlite3` (dış paket) — gerek kalmadı.
- **Express + `cors`** — *Ne:* HTTP router + CORS middleware. *Neden:* uç tanımlarını yalın tutmak;
  tarayıcı frontend'inin farklı porttan (Pages) erişebilmesi. *Nerede:* `backend/server.js`,
  `backend/package.json`. *Alternatif:* yerleşik `http` (bağımlılıksız) — okunabilirlik için Express seçildi.
- **PostgreSQL 16 + PostGIS 3.4** — *Ne:* ilişkisel veritabanı + mekansal eklenti. *Neden:* Web GIS
  için mekansal sorgu (`ST_Contains`, `ST_Distance`, KNN `<->`) birinci sınıf ihtiyaç; ayrıca gerçek
  eşzamanlılık (SERIALIZABLE ile write-skew koruması, ADR-009). *Nerede:* `docker-compose.yml`,
  `backend/database.js`. *Önceki:* SQLite — WAL modu, gömülü. *Neden bırakıldı:* tek düğüm, düşük yazma hacmi,
  ilişkisel veri profiline en uygun; WAL ile dayanıklılık + okur/yazar bloklamaz (DDIA Böl. 3/7).
  profiline uyuyordu ama mekansal sorgu yapamıyor ve tüm yazıcıları serileştirerek eşzamanlılık
  garantisini gizliyordu (ADR-009 Karar 3).

### Frontend & harita (hepsi `docs/vendor/`'da vendored — CDN yok, offline çalışır)
- **Leaflet** — *Ne:* hafif harita kütüphanesi. *Neden:* katman yönetimi, marker/popup, tile tabanlı
  render. *Nerede:* `docs/vendor/leaflet/`, `docs/app.js`. *Alternatif:* OpenLayers (daha ağır),
  Mapbox GL (token/CDN gerektirir).
- **Turf.js** — *Ne:* istemci-taraflı mekansal analiz (nokta-poligon, mesafe, buffer). *Neden:*
  frontend'de sunucuya gitmeden mekansal hesap. *Nerede:* `docs/vendor/turf/`, `docs/app.js`.
- **Chart.js** — *Ne:* canvas grafik kütüphanesi. *Neden:* analitik dashboard grafikleri (gelir,
  doluluk ısı haritası, top tesisler). *Nerede:* `docs/vendor/chartjs/`, `docs/dashboard.js`.
- **Vanilla JS/HTML/CSS (ES6+)** — *Neden:* GitHub Pages sunucusuz; build adımı/framework olmadan
  doğrudan çalışsın. *Nerede:* tüm `docs/*.html`, `docs/*.js`, `docs/style.css`.

### Coğrafi veri formatları
- **GeoJSON** — *Ne:* coğrafi geometri için JSON standardı. *Neden:* ilçe poligonları ve toplu
  taşıma rota çizgileri; Leaflet ve Turf doğrudan tüketir. *Nerede:* `docs/data/istanbul-districts.geojson`
  (tek kanonik kopya), `docs/data/transit-routes.geojson`.
- **GTFS** — *Ne:* toplu taşıma tarife/güzergah standardı (İBB/İETT). *Neden:* **gerçek** otobüs/vapur
  güzergahları; ham GTFS'ten türetilmiş slim GeoJSON üretilir (ADR-006). *Nerede:* `scripts/build-routes.js`,
  `test/fixtures/gtfs-sample/`.

### Güvenlik / kriptografi
- **PBKDF2-HMAC-SHA256 (+ per-user salt, PHC formatı)** — parola saklama (tek yönlü, key-stretching).
- **HMAC-SHA256** — rezervasyon/sipariş bütünlük imzası.
- **JWT (HS256, `iat`/`exp`)** — oturum token'ı; sabit-zamanlı imza karşılaştırması.
  *Nerede:* `backend/security.js` (ADR-002).

### Dağıtım / altyapı
- **GitHub Pages** — statik frontend'i sunucusuz yayınlar (`docs/`). **GitHub Actions**
  (`.github/workflows/deploy-pages.yml`) yayını otomatikleştirir. *Neden:* backend olmadan da demo
  çalışsın (çift mod: canlı API → yoksa localStorage + JSON snapshot).

---

## 3. Dizin haritası

| Klasör | Rolü |
|---|---|
| `backend/` | Node/Express API (tek backend) + veritabanı katmanı + testler. |
| `docs/` | GitHub Pages statik frontend + ADR'ler + öğrenme notları + veri snapshot'ları + vendored kütüphaneler. |
| `scripts/` | Yardımcı Node scriptleri (dummy veri, analytics snapshot, GTFS→GeoJSON). |
| `data/` | Kanonik `seed.json` (git'te) + `ibb-cache/` ham İBB yanıtları (gitignored, ADR-008). Çalışma zamanı verisi artık PostgreSQL'de. |
| `test/fixtures/` | Testler için sentetik veri (GTFS örneği). |
| `.github/` | CI/CD (Pages deploy). |

---

## 4. Dosya-dosya katalog (Soru #4'ün tam cevabı)

### 4.1 `backend/` (Node/Express)
| Dosya | ~satır | Amaç |
|---|---|---|
| `database.js` | ~480 | **Merkezi veri katmanı.** PostgreSQL havuzu + tip ayrıştırıcıları (int8→Number, date→'YYYY-MM-DD'); versiyonlu migration zinciri (v1–v8: users/facilities/reservations/districts → menu/orders → ispark_status → daily_stats → payment_type → audit_log → manual_occupancy adlandırması → **PostGIS geometri**); `seed.json`'dan idempotent tohumlama. PBKDF2 hash (senkron + async), `DUMMY_PHC`. Exportlar: `db`, `init`, `transaction` (**SERIALIZABLE + 40001 retry**), `hashPassword(Async)`, `verifyPassword(Async)`, `SLOTS`. |
| `db.js` | 449 | **Repository + mekansal analiz.** Tüm okuma/yazma DB'ye gider. Ray-casting nokta-poligon, Haversine, KNN (PostGIS karşılıkları kavramsal). İş operasyonları: `getFacilities`, `getProcessedDistricts` (mekansal join + alarm skoru), `getClosestFacilities`, tesis CRUD, `createReservation` (per-slot kapasite + atomik tx, write-skew'e kapalı), İSPARK atomik take/release, sipariş + fiyat snapshot, durum makinesi, admin gözetim, append-only `logAudit`. |
| `analytics.js` | 198 | **Analitik motoru + rollup.** Canlı agregasyonlar (`kpiSummary`, `revenueTimeSeries`, `occupancyHeatmap`, `topFacilities`, `paymentBreakdown`, …), `dateBucket` granülerlik. `rebuildDailyStats` türetilmiş rollup'ı kurar; `revenueFromRollup` ile canlı==rollup parity (test'te doğrulanır). İptaller gelirden düşülür. |
| `security.js` | 76 | **JWT + HMAC imza.** `signJwt`/`verifyJwt` (`iat`/`exp`, `timingSafeEqual`), `signReservation`, `signOrder`. Sır env'den (üretimde yoksa hata). |
| `validate.js` | 82 | **Uygulama seviyesi girdi doğrulama** (DB CHECK'lerinden önceki dost katman). `validateReservationInput`, `validateOrderInput` → `{ok, value}` / `{ok, error}`. |
| `server.js` | 373 | **API router (port 8085) + hava durumu servisi.** CORS/JSON/log, `requireAuth`/`requireAdmin`. Uçlar: auth, facilities (admin CRUD), reservations, menu, orders + durum geçişleri, admin gözetim (`/api/admin/*`), İSPARK, analytics, districts, proximity. Hava durumu: anahtar yok/hata → deterministik gerçekçi mock (Ousterhout "hataları tasarımla yok et"). |
| `test-db.js` | 237 | En geniş smoke-test (geçici DB): seed, PHC parola, KNN, atomik rezervasyon + kapasite, UNIQUE/CHECK/FK-cascade, İSPARK, validate, migration v2 şeması, kripto. |
| `test-concurrency.js` | ~155 | **Eşzamanlılık kanıtı** (`worker_threads`, ortak başlangıç bariyeri). Dört senaryo: İSPARK compare-and-set; READ COMMITTED → **overbook**; SERIALIZABLE + retry → **tam kapasite**; transaction dışı naif yol → overbook. Fark tek bir izolasyon seçiminde (ADR-009). |
| `test-orders.js` | 86 | Sipariş akışı: snapshot toplam, fiyat değişince snapshot değişmez, sahiplik (403), yanlış tesis kalemi (409), durum makinesi (`submitted→served→paid`, sıçrama 409), audit yazımı, FK cascade. |
| `test-analytics.js` | 69 | Analitik: KPI (iptaller hariç), aylık/yıllık bucket, ödeme kırılımı, **ROLLUP == LIVE** invaryantı, ısı haritası. |
| `test-admin.js` | 75 | Admin (Faz v2-07): CRUD audit satırları, admin gözetim (sahiplik filtresiz), durum whitelist, audit sorgu (yeni→eski, limit, actor join), `requireAdmin`. |
| `test-routes.js` | 62 | GTFS ingest (Faz v2-06): `build-routes.js`'i fixture'a karşı çalıştırır; slim GeoJSON yapısı, gerçek geometri, mod sınıflama, palet renkleri, yürüyüş bacağı, `[lng,lat]` sırası. |
| `env.js` | 59 | **Bağımlılıksız `.env` okuyucu.** Satır satır `KEY=VALUE`; `process.env`'de zaten tanımlı olanı **ezmez** (gerçek ortam değişkeni her zaman kazanır). `server.js`'in EN BAŞINDA yüklenir — `security.js`/`database.js` sırları modül yüklenme anında okuduğu için sıra bozulursa `.env` hiç görülmez. `dotenv` paketi yerine yazıldı. |
| `weather.js` | 177 | **OpenWeather entegrasyonu + önbellek.** `https` (şifresiz `http` değil — anahtar sorgu dizesinde gidiyor). Koordinat ~1 km'lik tam sayı hücre indeksine yuvarlanır (`toFixed(2)` kayan nokta sınırında tutarsız). TTL `WEATHER_CACHE_TTL_MS` (varsayılan 10 dk, `0` = kapalı). Yanıtta `observed_at` + `cached` → tazelik kanıtı. **Asla fırlatmaz**: ağ engeli / `401` / `429` / timeout / anahtarsız → `isMock: true` + `reason`. Ağ engelini anahtar hatasından **ayırt eder**. |
| `ratelimit.js` | 74 | **Kayan pencere hız sınırlayıcı** (bağımlılıksız, `express-rate-limit` yerine). Login: 15 dk'da 5, anahtar `${req.ip}\|${username}` — tek IP arkasındaki kurumsal ağın tamamı bir kişi yüzünden kilitlenmesin. Register: saatte 10. Aşılınca `429` + `Retry-After`. Zincirin başında olduğu için PBKDF2 **hiç çalışmıyor** → CPU tüketme vektörü kapalı. |
| `events.js` | 114 | **Canlı olay yayını (SSE, ADR-010).** Açık SSE bağlantılarını tutar; `publish(type, detail)` tüm abonelere `event: change` karesi yazar. Olay VERİ TAŞIMAZ, yalnız işaret - yetkilendirme tek yerde kalsın diye (istemci taze veriyi normal uçtan çeker). 25 sn'de bir yorum satırı (`: ping`) ara katmanların bağlantıyı kapatmasını önler. `publish` **asla fırlatmaz**: bildirim yan etkidir, asıl işlem çoktan commit edilmiştir. Bağımlılıksız. |
| `test-events.js` | 165 | SSE regresyonu (15 test), gerçek HTTP sunucusu + gerçek akışla: başlıklar (`text/event-stream`, `no-cache`, `X-Accel-Buffering`), `hello`/`retry` karesi, yayın tüm istemcilere gidiyor mu, kopan bağlantı listeden düşüyor mu, **olayda iş verisi olmadığı** (sözleşme testi). |
| `demo-users.js` | 27 | **`demo` şemasının sunum hesapları — tek kaynak.** Veri `data/demo-users.json`'da (git'te; sunumda giriş yapılabilmesi için BİLİNİR olmak zorunda). İki yer okuyor: `scripts/demo-reset.js` hesapları kurar, `database.js` `describeDevLogins()` açılışta hatırlatır. Önce `demo-reset.js` içinde inline'dı; iki kopya olsaydı biri güncellenmeden kalır ve sunum ortasında "parola yanlış" denirdi. |
| `test-auth.js` | 86 | Parola/JWT: PHC ayrıştırma, salt benzersizliği, `timingSafeEqual`, `DUMMY_PHC` ile zamanlama eşitliği, `exp` süre dolumu, kurcalanmış imza reddi. |
| `test-weather.js` | 160 | **Yerel sahte OpenWeather sunucusuna** karşı (`WEATHER_API_BASE`): yanıt ayrıştırma, önbellek isabeti (ikinci çağrı upstream'e gitmiyor), TTL dolunca yeniden çağırma, `401`/`429`/timeout/bağlantı reddi/bozuk JSON → mock'a düşme, anahtarsız → mock. Gerçek ağ gerektirmez. |
| `test-api-hardening.js` | 173 | Denetim bulgularının regresyon testleri: D3 (sayfalama), D5 (hız sınırı `429` + `Retry-After`), D6 (parola ≥ 8), D7 (İSPARK sahipliği), D9 (rezervasyon iptali + para geri alma), D10 (kısmi UNIQUE), D14 (`audit_log` indeksi — planda `Sort` yok). |
| `test-ibb-parse.js` | 166 | İBB ayrıştırıcıları **gerçek bayt dizileriyle**: mojibake onarımı, koordinat sırası/virgüllü ondalık düzeltme, alan adı esnekliği, İstanbul dışı koordinat reddi. Ağ gerektirmez. |
| `test-helper.js` | 71 | **Şema-başına test izolasyonu.** `PG_SCHEMA` → `search_path`; her test kendi şemasında koşar, gerçek veriye dokunmaz, paralel koşabilir. |
| *(kaldırıldı)* | — | `backend/package.json` kaldırıldı; npm projesi kökte tekilleşti (`backend/` ve `scripts/` aynı bağımlılıkları paylaşıyor). |

### 4.3 `docs/` (GitHub Pages statik frontend)
| Dosya | ~satır | Amaç |
|---|---|---|
| `index.html` | 502 | Ana harita kabuğu: cam kenar çubuğu (stat/arama/filtre), Leaflet konteyneri, tema toggle (FOUC önleme). Yükleme sırası: turf → leaflet → `matrix.js` → `app.js`. |
| `app.js` | 2330 | **Orkestratör** (en büyük dosya). UI state, Leaflet init, districts/transit/İSPARK katmanları, oturum, admin tesis yerleştirme. **Mock fetch interceptor** (gömülü tesisler, demo kullanıcılar, localStorage anahtarları) — backend olmadan çalışır (kasıtlı; ADR-002/007). |
| `matrix.js` | 192 | `MatrixEngine` — lineer cebir/mekansal: lat/lng→3B kartezyen, matris-vektör çarpımı, KNN, TOPSIS çok-kriterli karar skoru (karar destek). |
| `dashboard.html` / `dashboard.js` | ~180 / ~235 | Analitik sayfası (Faz v2-04). Çift mod: canlı `/api/analytics/*` → yoksa `data/analytics.json`. Chart.js grafikleri, renkler CSS değişkenlerinden (dataviz paleti), tema değişince yeniden çizim. **Canlı güncelleme (ADR-010):** `EventSource` ile `/api/events` dinlenir; 'değişti' işareti gelince taze veri çekilip chart'lar `destroy()` YERİNE `chart.update()` ile **yerinde** güncellenir (animasyon korunur - sunumda çubuğun büyüdüğü görünür). 400 ms biriktirme; canlı akış çubuğu + son güncelleme saati; elle **↻ Yenile** butonu. |
| `order.html` / `order.js` | 115 / 209 | Müşteri sipariş sayfası (Faz v2-05). Çift mod. "Yeni Sipariş" ve "Siparişlerim"; durum etiketleri v2-07 yaşam döngüsünden. |
| `style.css` | 1927 | Tasarım sistemi: açık/koyu tema token'ları, dataviz palet CSS değişkenleri, layout, cam kenar çubuğu, harita/marker, bileşenler. |
| `adr/ADR-001…010-*.md` | ~1000 (toplam) | Mimari karar kayıtları: veri modeli, auth/kripto, eşzamanlılık, analytics, sipariş, rotalar, admin, İBB açık veri, PostgreSQL+PostGIS, canlı güncelleme (SSE). |
| `diagrams/er-v2.md` | 134 | v2 varlık-ilişki diyagramı. |
| `learning/kripto-defteri.md` | 173 | Kripto öğrenme defteri (matematik + kod karşılığı). |
| `sorgu-defteri.md` | ~300 | **Sorgu defteri**: projenin her özelliğini gösteren anlatımlı SQL (amaç/ne gösterir/PostGIS karşılığı + örnek çıktılar). Çıplak hâli kök `queries.sql`. |
| `data/analytics.json` | 7872 | Analitik fallback snapshot (`dashboard.js`). |
| `data/seed.json` | 692 | Kanonik seed'in frontend mock kopyası. |
| `data/istanbul-districts.geojson` | ~132k | İlçe poligonları — **tek kanonik kopya** (hem Node backend `db.js` hem Pages statik olarak okur). |
| `data/transit-routes.geojson` | 1 | Türetilmiş toplu taşıma çizgileri (minified). |
| `vendor/{leaflet,turf,chartjs}/` | ~1 MB | Vendored kütüphaneler (CDN'siz, offline). Leaflet 1.9.4 (148 KB + 15 KB CSS + ikonlar), Turf (590 KB), Chart.js 4.5.1 (209 KB). |
| `gadesim/index.html` | 830 | **Gadeşim** — tek dosyalık Canvas 2D oyunu (Flappy Bird mekaniği). Dış bağımlılık yok: yüz fotoğrafı `data:` URI olarak gömülü, tüm grafik prosedürel çizim. Sabit 60 Hz simülasyon adımı (120 Hz ProMotion'da da aynı zorluk), sanal 288 px genişlik + ekran oranına göre uyarlanan yükseklik. Seslendirme Web Speech API (`tr-TR`), efektler Web Audio. 10 engel = 1 level; level geçişinde 2 sn boyunca zıplama repliği susar. |
| `gadesim/{icon.png,kapak.png}` | — | Ana ekran ikonu + WhatsApp/Twitter link önizlemesi (`og:image`). |
| `dbeaver-rehberi.md` | ~500 | **DBeaver sıfırdan + 9 adımlık sunum senaryosu.** Kurulum/bağlantı, arayüz turu, ER diyagramı, PostGIS harita sekmesi, `EXPLAIN` görselleştirme, prova edilmiş senaryo (ne diyeceğiniz dahil), sorun giderme tablosu, sunum öncesi kontrol listesi. |
| `ogrenme/00…12-*.md` | 13 dosya | **Katmanlı öğrenme kitabı** (Feynman disiplini). Her bölüm sabit 7 adım: bir cümlede → benzetme **ve nerede bozulduğu** → daha derin → projede tam olarak nerede → kendin dene (çalıştırılabilir komut + beklenen çıktı) → mentör sorarsa → sırada ne var. Sıfır ön bilgiyle başlar. |
| `ogrenme/teknoloji/*.md` | 17 + README | **Teknoloji başına derin dosyalar.** Her biri: ne olduğu → hangi problemi çözmek için doğdu → alternatifleri ve neden seçilmedikleri → bu projede tam olarak nerede → bilinmesi gereken 3 tuzak (mümkünse projede fiilen yaşanmış) → daha fazlası için. `nodejs`, `express`, `postgresql`, `postgis`, `pg-driver`, `docker`, `dbeaver`, `jwt`, `pbkdf2`, `leaflet`, `turf`, `chartjs`, `geojson`, `gtfs`, `soap-vs-rest`, `git-github-pages`, `sse`. |

### 4.4 `scripts/` (Node yardımcıları)
| Dosya | ~satır | Amaç |
|---|---|---|
| `build-routes.js` | 358 | **GTFS → gerçek rota geometrisi** (ADR-006). İki feed formatı, delimiter/mojibake/dev `stop_times` streaming; **kalite kapısı** (düşük güven eşleşme uydurma çizgiye düşmez); per-tesis rota indeksi + en yakın durak yürüyüş bacağı. |
| `export-analytics.js` | 44 | Pages için analitik snapshot: rollup'ı tazeler, tüm granülerlikte motoru çalıştırır → `docs/data/analytics.json`. |
| `export-schema.js` | ~110 | Canlı PostgreSQL şemasını okunur **`schema.sql`** DDL dokümanına döker (`information_schema` + `pg_catalog`; pg_dump'ın gürültüsü olmadan). Kanonik değil — migration'lardan türetilir. |
| `generate-data.js` | 133 | Ölçeklenebilir dummy veri (Faz v2-03): `--scale=N`, `--reset`; chunked batch insert, sipariş toplamı insert öncesi; sonda benchmark + `EXPLAIN QUERY PLAN`. |

### 4.5 Kök dosyalar
| Dosya | Amaç |
|---|---|
| `CLAUDE.md` | Proje giriş kapısı: mimari, gömülü kararlar, branch stratejisi, çalıştır/test, sözleşmeler. |
| `DATABASE.md` | Merkezi veri mimarisi (DDIA), üç-kopya→tek-kaynak geçişi, API tablosu, PostGIS yolu. |
| `docs/teknoloji-ve-dosya-rehberi.md` | **Bu dosya** — teknoloji + dosya amaç kataloğu (yaşayan). |
| `README.md` | Proje özeti, teknoloji özeti, çalıştırma adımları, belge bağlantıları. |
| `docs/anlatim-rehberi.md` | Projeyi anlatma rehberi: mimari, ne gerçek/ne demo, canlı SQL demosu, soru-cevap. |
| `scripts/check-consistency.js` | Belge ↔ kod tutarlılığını makineyle doğrular (`npm run check`). |
| `data/seed.json` | Kanonik başlangıç verisi (30 tesis, 39 ilçe, kullanıcılar). |
| `schema.sql` | **Türetilmiş** okunur DDL dokümanı (migration'lardan üretilir; `scripts/export-schema.js`). Elle düzenlenmez; mentöre/DBeaver'a şemayı tek dosyada gösterir. Kanonik değil — kaynak `database.js` MIGRATIONS. |
| `queries.sql` | Projenin her özelliğini gösteren, DBeaver'da çalıştırılabilir SQL koleksiyonu (30 sorgu). Anlatımlı hâli `docs/sorgu-defteri.md`. |
| `.env.example` | Ortam değişkeni şablonu (JWT_SECRET, OPENWEATHER_API_KEY, …). |
| `.agents/AGENTS.md` | Çalışma alanı kuralları (kod okurken fark edilen risk/koku bildirilir). |
| `.github/workflows/deploy-pages.yml` | GitHub Pages otomatik yayın. |
| `.gitignore` | Türetilmiş/gizli dosyaları hariç tutar (dev-credentials.json, ham GTFS, `data/ibb-cache/`, node_modules, …). |

---

## 5. Bilinen tekrarlar & tutarsızlıklar (durum)

| Konu | Durum |
|---|---|
| `istanbul-districts.geojson` kopyaları | **Tekilleştirildi.** Artık **tek kanonik kopya** `docs/data/istanbul-districts.geojson`'da; Node backend (`db.js`, `../docs/data/istanbul-districts.geojson`) ve Pages statik aynı dosyayı okur. Eski `backend/data/` kopyası kaldırıldı. |
| `data/seed.json` ↔ `docs/data/seed.json` ikizi | Frontend mock için gerekli; elle senkron riski var. İleride bir kopya script'i düşünülebilir (şimdilik not). |
| "DB için sıfır dış bağımlılık" iddiası | **Geçersiz (ADR-009):** `pg` eklendi. Bilinçli takas — PostGIS + gerçek eşzamanlılık karşılığında. |
| Üç ayrı anlatım rehberinin çakışması | **Çözüldü:** tek `docs/anlatim-rehberi.md`'de birleştirildi. |
| `README.md` kesik + OpenLayers placeholder | **Tamamlandı + Leaflet gerçeğiyle güncellendi.** |

---

## 6. Değişiklik günlüğü

- **2026-09-01 — `docs/gadesim/` oyunu.** Projeye bağımsız, tek dosyalık bir Canvas oyunu eklendi
  (Flappy Bird mekaniği + Türkçe seslendirme). Backend'e, veritabanına ve `docs/` içindeki diğer
  sayfalara **hiç dokunmuyor**; Pages iş akışı `docs/`'u zaten yayınladığı için ayrı bir dağıtım
  adımı yok. Proje kuralına uygun olarak CDN kullanılmadı: fotoğraf `data:` URI, kütüphane yok.
  Konuşma için Web Speech API kullanıldı (tarayıcıda yerleşik, ses dosyası taşımaya gerek yok);
  Türkçe ses yoksa oyun sessiz ama oynanır kalır — replikler ayrıca ekranda yazıyla da görünür.

- **2026-07-10 — İlk sürüm.** Belge oluşturuldu (teknoloji + dosya kataloğu). Yanında hedefli
  sadeleştirme: ham parolalı `advanced-gis/evaluation/golden_dataset.json`, yetim `advanced-gis/server.py`
  ve `advanced-gis/services/ispark.py`, okunmayan `advanced-gis/data/raw/istanbul-districts.geojson`,
  ölü `tracer.get_cost_estimate()` ve `main.py` `.padStart` dalı çıkarıldı; `config.py`'den kullanılmayan
  `DISTRICTS_GEOJSON_PATH` kaldırıldı; CLAUDE.md/README belge-kod tutarlılığı düzeltildi.
- **2026-07-10 — Demo giriş UX + geliştirici kuralları.** Pages mock'una `admin`/`admin1234` ve
  `user`/`user1234` demo hesapları eklendi (yalnız frontend `demo_users`; gerçek backend'i etkilemez),
  login formuna görünür ipucu kondu. `.agents/AGENTS.md` genişletildi: DDIA + **APoSD (Ousterhout)**
  ikincil rehber olarak tanımlandı, projeye özel 7 maddelik kural seti eklendi.
- **2026-07-10 — `schema.sql` + üretici script.** `scripts/export-schema.js` eklendi; veritabanından
  okunur DDL dokümanı `schema.sql` üretiyor (kanonik değil, migration'lardan türetilmiş; şema değişince
  yeniden üretilir — CLAUDE.md sözleşmesi). Amaç: SQL şemasını tek dosyada gösterebilmek (DBeaver/mentör).
  Tam veri dökümü `data/full.sql` gitignored. `schema.sql` (yalnız yapı) dokümantasyon olarak commit'lenir.
- **2026-07-10 — Sorgu defteri + test verisi havuzu.** `docs/sorgu-defteri.md` (10 bölüm, ~35 sorgu:
  KNN/Haversine, kapasite, sipariş snapshot, analitik, rollup, İSPARK, güvenlik, EXPLAIN) ve çalıştırılabilir
  kök `queries.sql` (30 ifade, hepsi gerçek şemada doğrulandı) eklendi. Test verisi havuzu `scripts/generate-data.js
  --reset --scale=N` ile üretiliyor (scale=1 → ~213K rezervasyon, 15,6 s; kapasite/benchmark için).
- **2026-07-10 — Giriş (login) düzeltmesi.** Pages mock login'i çevrimdışıyken çöküyordu
  (`MOCK_USERS_KEY` boşsa `null.find`). Login/register handler artık `defaultUsers`'tan kendini
  iyileştiriyor + başlangıçta kullanıcı listesi kuruluyor; seed `version` 4→5 (önce açan tarayıcılarda
  admin/user re-seed); `app.js` cache-bust `?v=3.1`. Artık demo/admin/user her koşulda giriş yapar.
- **2026-07-24 — Tek dilli mimariye geçiş + belge senkronu.** Python `advanced-gis/` ikiz servisi
  **tamamen kaldırıldı**; proje artık tek dilli (Node/Express backend + statik `docs/` frontend).
  Diller-arası kripto/şema parity anlatısı ve tüm `advanced-gis` referansları belgelerden temizlendi
  (şema tek yerde: `backend/database.js`). Mükerrer `istanbul-districts.geojson` **tekilleştirildi**:
  tek kanonik kopya `docs/data/istanbul-districts.geojson`, Node backend (`db.js`) ile Pages aynı
  dosyayı okur. Ayrıca bir doğruluk/bug-fix turu: menü gerçek veri, harita rezervasyonu, kayıt (mock
  token/user), yol tarifi çizim + mesafe/süre, İSPARK doluluğu, hava yedeği ve grafik
  snapshot tazelik/etiket düzeltmeleri. (İSPARK: haritadaki İSPARK işaretleri ayrı bir
  **hardcoded `ISPARK_LOCATIONS`** listesidir (15 kamu otoparkı, id 1–15) — bunlar *tesis*
  değildir, dolayısıyla tesis-anahtarlı `/api/ispark/:facilityId` ucuna eşlenmez. Uydurma
  `Math.random()` doluluk konuma göre **deterministik demo** değere çevrildi ve sahte
  "İBB Feed" etiketi dürüstleştirildi. Backend'de her *tesisin kendi* `ispark_status` kaydı
  gerçek/tohumlu ve atomik take/release ile canlıdır (ADR-003) — farklı bir kavram, ayrı veri.)
- *(Sonraki fazlar buraya birer satır ekler.)*

- **2026-07-27 — Doğruluk turu: beş hata.** (Faz 1, tek commit)
  (1) **Sipariş iptali parayı geri almıyordu** — tutar `reservations.amount_minor`'a ekleniyor ama
  iptalde düşülmüyordu; tüm ciro raporlaması bu kolonu okuduğu için iptal edilen sipariş sonsuza dek
  ciro sayılıyordu. `categorySales` ve `daily_stats.order_count` de iptalleri sayıyordu.
  (2) **Login'in timing savunması tersine çalışıyordu** — kullanıcı yokken 1 iterasyonlu sahte hash
  doğrulanıyordu (gerçekler 600.000); ölçüldü: "kullanıcı yok" yanıtı **402× hızlı** dönüyor, yani kod
  engellemeye çalıştığı kullanıcı-adı sızıntısını üretiyordu. `DUMMY_PHC` artık iterasyonu gerçek
  ayardan alıyor (oran 1.02×). Ayrıca PBKDF2 async'e alındı: 6 eşzamanlı login altında GET gecikmesi
  ~600 ms → **14 ms**.
  (3) **Sipariş imzası tutarı kapsamıyordu** — `signOrder` toplam hesaplanmadan sabit `0` ile
  çağrılıyordu; imza tutar değişse bile aynı kalıyordu. İmza artık `createOrder` içinde üretiliyor.
  (4) **Toplu taşıma kapsamı ölçülmüyordu** — 30 tesisin 17'sinde hiç hat yok, 88 ref eşleşmiyor ama
  bu hiçbir çıktıda toplanmıyordu; `meta.coverage` eklendi.
  (5) **Harita doluluğu türetilmiyordu** — kolon yalnız seed ve admin PATCH'inden değişiyordu; migration
  v7 ile `manual_occupancy` olarak yeniden adlandırıldı, gerçek doluluk rezervasyonlardan hesaplanıyor.
  Ek: `getAuditLog`'da `?limit=abc` → NaN → sınırsız döküm; global Express hata middleware'i.

- **2026-07-27 — PostgreSQL + PostGIS geçişi.** (Faz 2, ADR-009) SQLite kaldırıldı. Mekansal katman
  veritabanına indi (ray-casting → `ST_Contains`, Haversine → `ST_Distance(geography)`, JS sort KNN →
  `<->`); `facilities.geom` generated kolon. Eşzamanlılık artık **açık bir karar**: `transaction()`
  SERIALIZABLE + 40001 retry — READ COMMITTED'ın overbook ettiği testle gösteriliyor. Gerçek tipler
  (`date`/`time`/`boolean`/`jsonb`). Tüm veri erişimi async; testler şema başına izole. Geçişte iki
  gerçek hata yakalandı: commit öncesi havuzdan okuma (`createFacility` null dönüyordu) ve para
  toplamlarında int4 taşması (kuruş cinsinden ~21,5M TL sınırı; dashboard 22003 ile çöküyordu).
  npm projesi kökte tekilleşti.

- **2026-07-27 — İBB açık veri entegrasyonu.** (Faz 3, ADR-008) `scripts/fetch-ibb.js` (ağa dokunan
  tek dosya, ham yanıtlar `data/ibb-cache/`'e — gitignored), `scripts/ibb-parse.js` (saf ayrıştırıcılar,
  fixture ile test edilir), `scripts/build-transit.js` (kaynak önceliği: iett-soap > ibb-gtfs >
  metro-istanbul). Metro İstanbul istasyon NOKTASI verdiği için metro hatları `station-chain` /
  `approximate` etiketli ve haritada **kesikli** çiziliyor — uydurmayı gerçek gibi sunmama ilkesi.
  `SeferGerceklesme` ve `ibb.asmx` gerekçesiyle reddedildi.

- **2026-07-27 — Belge sadeleştirme + tutarlılık kontrolü.** (Faz 4) Kökteki 7 Türkçe rehber (~81 KB,
  büyük ölçüde çakışan) **3'e indirildi**: `README.md` + `CLAUDE.md` + `DATABASE.md`. Üç anlatım rehberi
  (`PROJE_ANLATIM_REHBERI`, `VERITABANI_ANLATIM_REHBERI`, `staj_sunum_rehberi`) tek doğru belgede
  birleşti → `docs/anlatim-rehberi.md`; bu katalog `docs/teknoloji-ve-dosya-rehberi.md`'ye taşındı.
  `scripts/check-consistency.js` eklendi: API tablosu ↔ rotalar, migration ↔ schema.sql, seed replikası,
  ADR numaralandırması, test kapsamı ve platform kalıntıları **makineyle** doğrulanıyor (`npm run check`)
  — belge kayması artık yorumla değil testle korunuyor.

- **2026-07-27 — Denetim bulguları + gerçek hava durumu.** (Faz 5) 18 bulgulu acımasız denetimin
  düzeltmeleri. En önemlisi **D1**: `index.html` veritabanına hiçbir şey yazmıyordu (`app.js`'teki
  `fetch` override'ı bilinen uçları tarayıcı içinde simüle ediyordu), yani "uygulamada işlem yap,
  DBeaver'da gör" demosu **imkânsızdı**. Artık çift mod: açılışta backend yoklanır, erişilebiliyorsa
  override tamamen atlanır. **D2**: override'ın belgelerdeki güvenlik gerekçesi olgusal olarak
  yanlıştı (`/api/auth/login` zaten hash döndürmüyor) — gerçek sebep Pages'in kod çalıştıramaması;
  düzeltildi. **D3**: `/api/admin/*` sayfalamasız 425.139 satır / 142 MB / 8,7 sn döndürüyordu →
  `LIMIT`/`OFFSET` + `X-Total-Count`. **D4**: kalıcı XSS (`escapeHtml`, gerçek Chromium'la doğrulandı).
  **D5/D6**: hız sınırı + parola ≥ 8. **D7**: `ispark_holds` ile bırakma sahipliği. **D8/D11/D12**:
  `backend/env.js` (`.env` hiç okunmuyordu — 7. madde bunsuz çalışmazdı), `http`→`https`,
  koordinat hücreli önbellek. **D9/D10**: `DELETE /api/reservations/:id` + kısmi UNIQUE indeks
  (iptal edilen rezervasyon slotu artık bloke etmiyor). **D14**: `idx_audit_log_created`.
  Yeni: `weather.js`, `ratelimit.js`, `test-weather.js`, `test-api-hardening.js`. Migration v9.

- **2026-07-27 — Demo şeması + sorgu defteri genişletmesi.** (Faz 7) `npm run demo:reset` /
  `demo:start`: `demo` şemasında 5 tesis, 3 kullanıcı, **0 rezervasyon** — sunumda her işlem gözle
  görünür. `SEED_FILE` env desteği eklendi; onsuz seed her açılışta silinen tesisleri geri
  yazıyordu (sunum ortasında yeniden başlatma 5 yerine 30 tesis gösterirdi). `queries.sql` 10 → 16
  bölüm (586 satır): yazma işlemleri, canlı izleme (önce/sonra sorgu çiftleri), **kısıtları kırmaya
  çalışma** (hata kodunu görmek kısıtın gerçek olduğunun kanıtı), transaction'ı elle görme
  (`pg_locks`), türetilmiş veri, şema keşfi. `docs/sorgu-defteri.md` 633 satıra genişledi.

- **2026-07-27 — DBeaver rehberi.** (Faz 8) `docs/dbeaver-rehberi.md`: kurulum, arayüz turu, ER
  diyagramı, PostGIS harita sekmesi, `EXPLAIN` görselleştirme, **9 adımlık sunum senaryosu** ve
  sorun giderme. Senaryonun tamamı canlı veritabanına karşı **prova edildi**; belgedeki her çıktı
  gerçek çıktı.

- **2026-07-27 — Öğrenme kitabı (Feynman).** (Faz 6) `docs/ogrenme/`: 12 bölümlük katmanlı kitap +
  `teknoloji/` altında 16 derin dosya. Yöntem: her bölüm tek cümleyle başlar, benzetme kurar ve
  **benzetmenin nerede bozulduğunu** söyler (atlanırsa yanlış zihinsel model kalıcı olur), sonra
  derinleşir; her bölümde çalıştırılabilir komut + beklenen çıktı ve "mentör sorarsa" cevapları var.
  Kitaptaki **her olgusal iddia canlı sisteme karşı doğrulandı** — bu sırada iki gerçek düzeltme
  çıktı: (a) `geometry` vs `geography` sıralama hatası ilk yazılan koordinatta (Taksim) tekrar
  etmiyordu, gerçek bir çakışma noktası bulunup (41.01, 28.97) belgelendi — hatanın **çoğu zaman
  doğru cevap vermesi** asıl tehlike; (b) `public` şemasındaki 200 sentetik kullanıcı hâlâ tek bir
  hash paylaşıyordu (veri, `generate-data.js` düzeltmesinden önce üretilmişti) → 20 farklı hash'e
  yeniden atandı, böylece DBeaver'da "her kullanıcıya ayrı salt" anlatısı veriyle çelişmiyor.

- **2026-07-27 — Giriş bilgilerini görünür yapma.** Parolalar çalışılan moda göre değişiyordu ve
  hiçbir yer bunu söylemiyordu: `public` şemasında rastgele üretilip gitignored dosyaya yazılıyor,
  `demo` şemasında sabit, çevrimdışı replikada tarayıcı-içi taklit hesaplar. Deneme yanılmaya düşen
  kullanıcı 5 denemede `429`'a takılıp bunu "parola yanlış" sanıyordu. `describeDevLogins()` açılışta
  geçerli hesapları yazıyor (üretimde susar); demo hesapları `backend/demo-users.js` +
  `data/demo-users.json` ile tek kaynağa taşındı; README'ye mod × hesap tablosu eklendi.

- **2026-07-27 — Canlı güncelleme (SSE).** (Faz 9, ADR-010) Analiz paneli veriyi yalnız
  sayfa açılışında / granülerlik değişince / tema değişince çekiyordu: kullanıcı sipariş
  verdiğinde grafikler olduğu gibi kalıyor, görmek için sayfayı ELLE yenilemek
  gerekiyordu — üstelik banner "gerçek zamanlı sorgu" yazıyordu ve bu yanıltıcıydı.
  Yeni `backend/events.js` (bağımlılıksız SSE yayıncısı) + `GET /api/events`; 10 mutasyon
  noktası `events.publish(...)` çağırıyor. `docs/dashboard.js` `EventSource` ile dinliyor,
  400 ms biriktirip TEK yenileme yapıyor ve chart'ları `destroy()` yerine `chart.update()`
  ile **yerinde** güncelliyor — böylece çubuğun büyümesi animasyonla görünüyor (sunumun
  asıl anı). Panelde canlı akış çubuğu + son güncelleme saati, ayrıca elle **↻ Yenile**.
  Yoklama reddedildi (dashboard sorgusu 6 agregasyon koşturuyor; kısa aralık sorgu yağmuru,
  uzun aralık sunumda ölü bekleme), WebSocket reddedildi (akış tek yönlü + `ws` bağımlılığı).
  Sözleşme: **olay veri taşımaz**, yalnız işaret — yetkilendirme tek yerde kalsın diye
  (admin gözetim uçları sahiplik filtresiz, ADR-007). Gerçek tarayıcıyla ölçüldü: 360 ₺'lik
  sipariş → Toplam Ciro ₺0 → ₺360, rozet "Sipariş değişti", chart instance aynı (yerinde
  güncelleme). Yeni: `backend/test-events.js` (15 test, gerçek HTTP akışı),
  `docs/ogrenme/12-canli-guncelleme.md`, `docs/ogrenme/teknoloji/sse.md`,
  `docs/adr/ADR-010-canli-guncelleme.md`, DBeaver senaryosuna Adım 4b.
