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
| *(kaldırıldı)* | — | `backend/package.json` kaldırıldı; npm projesi kökte tekilleşti (`backend/` ve `scripts/` aynı bağımlılıkları paylaşıyor). |

### 4.3 `docs/` (GitHub Pages statik frontend)
| Dosya | ~satır | Amaç |
|---|---|---|
| `index.html` | 502 | Ana harita kabuğu: cam kenar çubuğu (stat/arama/filtre), Leaflet konteyneri, tema toggle (FOUC önleme). Yükleme sırası: turf → leaflet → `matrix.js` → `app.js`. |
| `app.js` | 2330 | **Orkestratör** (en büyük dosya). UI state, Leaflet init, districts/transit/İSPARK katmanları, oturum, admin tesis yerleştirme. **Mock fetch interceptor** (gömülü tesisler, demo kullanıcılar, localStorage anahtarları) — backend olmadan çalışır (kasıtlı; ADR-002/007). |
| `matrix.js` | 192 | `MatrixEngine` — lineer cebir/mekansal: lat/lng→3B kartezyen, matris-vektör çarpımı, KNN, TOPSIS çok-kriterli karar skoru (karar destek). |
| `dashboard.html` / `dashboard.js` | 148 / 168 | Analitik sayfası (Faz v2-04). Çift mod: canlı `/api/analytics/*` → yoksa `data/analytics.json`. Chart.js grafikleri, renkler CSS değişkenlerinden (dataviz paleti), tema değişince yeniden çizim. |
| `order.html` / `order.js` | 115 / 209 | Müşteri sipariş sayfası (Faz v2-05). Çift mod. "Yeni Sipariş" ve "Siparişlerim"; durum etiketleri v2-07 yaşam döngüsünden. |
| `style.css` | 1927 | Tasarım sistemi: açık/koyu tema token'ları, dataviz palet CSS değişkenleri, layout, cam kenar çubuğu, harita/marker, bileşenler. |
| `adr/ADR-001…007-*.md` | ~690 (toplam) | Mimari karar kayıtları: veri modeli, auth/kripto, eşzamanlılık, analytics, sipariş, rotalar, admin. |
| `diagrams/er-v2.md` | 134 | v2 varlık-ilişki diyagramı. |
| `learning/kripto-defteri.md` | 173 | Kripto öğrenme defteri (matematik + kod karşılığı). |
| `sorgu-defteri.md` | ~300 | **Sorgu defteri**: projenin her özelliğini gösteren anlatımlı SQL (amaç/ne gösterir/PostGIS karşılığı + örnek çıktılar). Çıplak hâli kök `queries.sql`. |
| `data/analytics.json` | 7872 | Analitik fallback snapshot (`dashboard.js`). |
| `data/seed.json` | 692 | Kanonik seed'in frontend mock kopyası. |
| `data/istanbul-districts.geojson` | ~132k | İlçe poligonları — **tek kanonik kopya** (hem Node backend `db.js` hem Pages statik olarak okur). |
| `data/transit-routes.geojson` | 1 | Türetilmiş toplu taşıma çizgileri (minified). |
| `vendor/{leaflet,turf,chartjs}/` | — | Vendored kütüphaneler (CDN'siz, offline). |

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
