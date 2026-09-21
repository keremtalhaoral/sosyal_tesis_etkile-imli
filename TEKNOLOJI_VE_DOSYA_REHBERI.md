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
sipariş, İSPARK doluluk, analitik dashboard. Üç çalıştırılabilir parça aynı veriyi paylaşır:
**Node/Express backend** (asıl API), **Python `advanced-gis` ikiz servisi** (aynı veritabanına ikinci
bir kapı; kripto/şema parity göstergesi) ve **`docs/` statik frontend** (GitHub Pages, sunucusuz).
Tek gerçek kaynak repo kökündeki `data/app.db` (SQLite, WAL); kanonik başlangıç verisi `data/seed.json`.
Rehber ilke **DDIA (Kleppmann)** — her karar bir ADR'de.

```
                    data/seed.json  (kanonik, git'te)
                            │  seed
                            ▼
   backend/ (Node) ───┐               ┌─── advanced-gis/ (Python ikiz)
                      ├──► data/app.db ◄──┤     (aynı şema, alt-küme API)
   scripts/ ─────────┘  (SQLite, WAL)     
                            │  türetilir (export-analytics.js)
                            ▼
   docs/ (GitHub Pages, statik) ──► tarayıcıda localStorage + JSON snapshot (çevrimdışı replika)
```

---

## 2. Teknoloji kataloğu

Her teknoloji için: **ne**, **neden seçildi**, **nerede**, **alternatifi**.

### Backend & veri
- **Node.js + `node:sqlite` (yerleşik modül)** — *Ne:* JS runtime + Node 22'nin gömülü SQLite sürücüsü.
  *Neden:* veritabanı için **sıfır dış bağımlılık**; tek dosya, ACID. *Nerede:* `backend/database.js`,
  `backend/db.js`. *Alternatif:* `better-sqlite3` (dış paket) — gerek kalmadı.
- **Express + `cors`** — *Ne:* HTTP router + CORS middleware. *Neden:* uç tanımlarını yalın tutmak;
  tarayıcı frontend'inin farklı porttan (Pages) erişebilmesi. *Nerede:* `backend/server.js`,
  `backend/package.json`. *Alternatif:* yerleşik `http` (bağımlılıksız) — okunabilirlik için Express seçildi.
- **SQLite — WAL modu** — *Ne:* gömülü ilişkisel veritabanı. *Neden:* tek düğüm, düşük yazma hacmi,
  ilişkisel veri profiline en uygun; WAL ile dayanıklılık + okur/yazar bloklamaz (DDIA Böl. 3/7).
  *Nerede:* `data/app.db`. *Alternatif:* PostgreSQL + PostGIS (geçiş yolu `DATABASE.md`'de tanımlı).
- **Python 3 standart kütüphanesi** — *Ne:* `http.server`, `sqlite3`, `hashlib`, `hmac`,
  `html.parser`, `urllib`. *Neden:* `advanced-gis` ikiz servisini **dış bağımlılık olmadan** çalıştırmak;
  kripto ve şemanın diller-arası taşınabilir olduğunu kanıtlamak. *Nerede:* `advanced-gis/`.
  *Alternatif:* Flask/FastAPI — kurulum bağımlılığı getireceği için kaçınıldı.

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
  taşıma rota çizgileri; Leaflet ve Turf doğrudan tüketir. *Nerede:* `*/istanbul-districts.geojson`,
  `docs/data/transit-routes.geojson`.
- **GTFS** — *Ne:* toplu taşıma tarife/güzergah standardı (İBB/İETT). *Neden:* **gerçek** otobüs/vapur
  güzergahları; ham GTFS'ten türetilmiş slim GeoJSON üretilir (ADR-006). *Nerede:* `scripts/build-routes.js`,
  `test/fixtures/gtfs-sample/`.

### Güvenlik / kriptografi
- **PBKDF2-HMAC-SHA256 (+ per-user salt, PHC formatı)** — parola saklama (tek yönlü, key-stretching).
- **HMAC-SHA256** — rezervasyon/sipariş bütünlük imzası.
- **JWT (HS256, `iat`/`exp`)** — oturum token'ı; sabit-zamanlı imza karşılaştırması.
  *Nerede:* `backend/security.js` ↔ `advanced-gis/security/crypto_signer.py` (**bit-uyumlu**; ADR-002).

### Dağıtım / altyapı
- **GitHub Pages** — statik frontend'i sunucusuz yayınlar (`docs/`). **GitHub Actions**
  (`.github/workflows/deploy-pages.yml`) yayını otomatikleştirir. *Neden:* backend olmadan da demo
  çalışsın (çift mod: canlı API → yoksa localStorage + JSON snapshot).

---

## 3. Dizin haritası

| Klasör | Rolü |
|---|---|
| `backend/` | Node/Express API (asıl backend) + veritabanı katmanı + testler. |
| `advanced-gis/` | Python ikiz servisi — aynı `app.db`, alt-küme API; kripto/şema parity göstergesi. |
| `docs/` | GitHub Pages statik frontend + ADR'ler + öğrenme notları + veri snapshot'ları + vendored kütüphaneler. |
| `scripts/` | Yardımcı Node scriptleri (dummy veri, analytics snapshot, GTFS→GeoJSON). |
| `data/` | Kanonik `seed.json` (git'te) + çalışma zamanı `app.db` (gitignored, türetilmiş). |
| `test/fixtures/` | Testler için sentetik veri (GTFS örneği). |
| `.github/` | CI/CD (Pages deploy). |

---

## 4. Dosya-dosya katalog (Soru #4'ün tam cevabı)

### 4.1 `backend/` (Node/Express)
| Dosya | ~satır | Amaç |
|---|---|---|
| `database.js` | 411 | **Merkezi veri katmanı.** `data/app.db`'yi WAL modunda açar; versiyonlu migration zinciri (v1–v6: users/facilities/reservations/districts → menu/orders → ispark_status → daily_stats → payment_type → audit_log); `seed.json`'dan idempotent tohumlama. PBKDF2 hash (PHC). Exportlar: `getDb`, `transaction` (atomik `BEGIN IMMEDIATE`), `hashPassword`, `verifyPassword`, `SLOTS`, `DB_PATH`. |
| `db.js` | 449 | **Repository + mekansal analiz.** Tüm okuma/yazma DB'ye gider. Ray-casting nokta-poligon, Haversine, KNN (PostGIS karşılıkları kavramsal). İş operasyonları: `getFacilities`, `getProcessedDistricts` (mekansal join + alarm skoru), `getClosestFacilities`, tesis CRUD, `createReservation` (per-slot kapasite + atomik tx, write-skew'e kapalı), İSPARK atomik take/release, sipariş + fiyat snapshot, durum makinesi, admin gözetim, append-only `logAudit`. |
| `analytics.js` | 214 | **Analitik motoru + rollup + OLTP/OLAP benchmark.** Canlı agregasyonlar (`kpiSummary`, `revenueTimeSeries`, `occupancyHeatmap`, `topFacilities`, `paymentBreakdown`, …), `dateBucket` granülerlik. `rebuildDailyStats` türetilmiş rollup'ı kurar; `benchmark` rollup==canlı ve ~178× hız kanıtı. İptaller gelirden düşülür. |
| `security.js` | 76 | **JWT + HMAC imza.** `signJwt`/`verifyJwt` (`iat`/`exp`, `timingSafeEqual`), `signReservation`, `signOrder`. Sır env'den (üretimde yoksa hata). Python `crypto_signer.py` ile bit-uyumlu. |
| `validate.js` | 82 | **Uygulama seviyesi girdi doğrulama** (DB CHECK'lerinden önceki dost katman). `validateReservationInput`, `validateOrderInput` → `{ok, value}` / `{ok, error}`. |
| `server.js` | 373 | **API router (port 8085) + hava durumu servisi.** CORS/JSON/log, `requireAuth`/`requireAdmin`. Uçlar: auth, facilities (admin CRUD), reservations, menu, orders + durum geçişleri, admin gözetim (`/api/admin/*`), İSPARK, analytics, districts, proximity. Hava durumu: anahtar yok/hata → deterministik gerçekçi mock (Ousterhout "hataları tasarımla yok et"). |
| `test-db.js` | 237 | En geniş smoke-test (geçici DB): seed, PHC parola, KNN, atomik rezervasyon + kapasite, UNIQUE/CHECK/FK-cascade, İSPARK, validate, migration v2 şeması, kripto. |
| `test-concurrency.js` | 120 | **Eşzamanlılık kanıtı** (`worker_threads`, ayrı bağlantılar, WAL). İSPARK compare-and-set, atomik rezervasyon (overbook yok), ve kasıtlı naif read-then-write yolu **write-skew'i gösterir** — fark tek `BEGIN IMMEDIATE`. |
| `test-orders.js` | 86 | Sipariş akışı: snapshot toplam, fiyat değişince snapshot değişmez, sahiplik (403), yanlış tesis kalemi (409), durum makinesi (`submitted→served→paid`, sıçrama 409), audit yazımı, FK cascade. |
| `test-analytics.js` | 73 | Analitik: KPI (iptaller hariç), aylık/yıllık bucket, ödeme kırılımı, **ROLLUP == LIVE** invaryantı, ısı haritası, benchmark tutarlılığı. |
| `test-admin.js` | 75 | Admin (Faz v2-07): CRUD audit satırları, admin gözetim (sahiplik filtresiz), durum whitelist, audit sorgu (yeni→eski, limit, actor join), `requireAdmin`. |
| `test-routes.js` | 62 | GTFS ingest (Faz v2-06): `build-routes.js`'i fixture'a karşı çalıştırır; slim GeoJSON yapısı, gerçek geometri, mod sınıflama, palet renkleri, yürüyüş bacağı, `[lng,lat]` sırası. |
| `package.json` | 13 | `mufettis-backend`; `start: node server.js`; bağımlılıklar `express`, `cors` (SQLite yerleşik). |

### 4.2 `advanced-gis/` (Python ikiz servis)
| Dosya | ~satır | Amaç |
|---|---|---|
| `app/config.py` | 21 | Merkezi config: `PORT=8085`, `JWT_SECRET` (env; üretimde zorunlu, dev'de DEV-ONLY sabit), paylaşılan `DB_PATH`/`SEED_PATH` (repo kökü). |
| `app/main.py` | 373 | **Sunucu.** `ThreadingHTTPServer` + `BaseHTTPRequestHandler`, CORS. Uçlar: GET facilities/menu/weather/reservations; POST register/login/reserve/facilities(admin); DELETE facilities(admin). Node'un **alt-kümesi** (orders/analytics/audit yok). |
| `app/models.py` | 284 | **SQLite veri katmanı.** `init_db()` Node migration v1–v6 şemasını `CREATE TABLE IF NOT EXISTS` ile birebir kurar (WAL, FK). CRUD + `create_reservation` sunucu-taraflı kapasite. |
| `security/crypto_signer.py` | 85 | **Diller-arası kripto.** PBKDF2 PHC (`pbkdf2_sha256$…`) `security.js` ile bit-uyumlu; HS256 JWT (iat/exp); HMAC rezervasyon imzası; `hmac.compare_digest`. |
| `scripts/seed.py` | 119 | Idempotent tohumlayıcı: `seed.json`'dan users/districts/facilities/menu/ispark → `app.db` (`INSERT OR IGNORE`); dev parolaları gitignored `dev-credentials.json`'a. |
| `services/weather.py` | 71 | Hava durumu sağlayıcı: `OPENWEATHER_API_KEY` varsa OpenWeather (TR çeviri), yoksa lat/lng-seed'li deterministik mock. |
| `services/scraper.py` | 74 | Menü scraper: İBB menü sayfasını `HTMLParser` ile ayrıştırır; hata → `facility_id % 2` anahtarlı çevrimdışı fallback menü. |
| `observability/tracer.py` | 28 | `log_request()`: erişim logu + bellek-içi API sayaçları (`main.py` kullanır). |
| `tests/test_crypto.py` | 56 | `unittest`: per-user salt farklı hash, verify round-trip, JWT tamper, rezervasyon imza kararlılığı/tamper. |
| `tests/test_math.py` | 40 | `unittest`: deterministik mock hava durumu + Haversine (İstanbul→Ankara) sağlaması. |

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
| `data/analytics.json` | 7872 | Analitik fallback snapshot (`dashboard.js`). |
| `data/seed.json` | 692 | Kanonik seed'in frontend mock kopyası. |
| `data/istanbul-districts.geojson` | ~132k | İlçe poligonları (Pages statik okur). |
| `data/transit-routes.geojson` | 1 | Türetilmiş toplu taşıma çizgileri (minified). |
| `vendor/{leaflet,turf,chartjs}/` | — | Vendored kütüphaneler (CDN'siz, offline). |

### 4.4 `scripts/` (Node yardımcıları)
| Dosya | ~satır | Amaç |
|---|---|---|
| `build-routes.js` | 358 | **GTFS → gerçek rota geometrisi** (ADR-006). İki feed formatı, delimiter/mojibake/dev `stop_times` streaming; **kalite kapısı** (düşük güven eşleşme uydurma çizgiye düşmez); per-tesis rota indeksi + en yakın durak yürüyüş bacağı. |
| `export-analytics.js` | 44 | Pages için analitik snapshot: rollup'ı tazeler, tüm granülerlikte motoru çalıştırır → `docs/data/analytics.json`. |
| `generate-data.js` | 133 | Ölçeklenebilir dummy veri (Faz v2-03): `--scale=N`, `--reset`; chunked batch insert, sipariş toplamı insert öncesi; sonda benchmark + `EXPLAIN QUERY PLAN`. |

### 4.5 Kök dosyalar
| Dosya | Amaç |
|---|---|
| `CLAUDE.md` | Proje giriş kapısı: mimari, gömülü kararlar, branch stratejisi, çalıştır/test, sözleşmeler. |
| `DATABASE.md` | Merkezi veri mimarisi (DDIA), üç-kopya→tek-kaynak geçişi, API tablosu, PostGIS yolu. |
| `TEKNOLOJI_VE_DOSYA_REHBERI.md` | **Bu dosya** — teknoloji + dosya amaç kataloğu (yaşayan). |
| `README.md` | Proje özeti, teknoloji özeti, çalıştırma adımları, belge bağlantıları. |
| `VERITABANI_ANLATIM_REHBERI.md` | Veri mimarisini mentöre SQL ile anlatma rehberi (öğrenme). |
| `staj_sunum_rehberi.md` | Staj sunum rehberi (erken sürüm mimarisi + hâlâ geçerli tasarım prensipleri; başında sürüm notu). |
| `data/seed.json` | Kanonik başlangıç verisi (30 tesis, 39 ilçe, kullanıcılar). |
| `.env.example` | Ortam değişkeni şablonu (JWT_SECRET, OPENWEATHER_API_KEY, …). |
| `.agents/AGENTS.md` | Çalışma alanı kuralları (kod okurken fark edilen risk/koku bildirilir). |
| `.github/workflows/deploy-pages.yml` | GitHub Pages otomatik yayın. |
| `.gitignore` | Türetilmiş/gizli dosyaları hariç tutar (app.db, dev-credentials.json, ham GTFS, node_modules, …). |

---

## 5. `advanced-gis`'in rolü (Soru #3)

**Fonksiyonel olarak silinirse hiçbir uç kaybolmaz** — Node backend onun **süper kümesidir**
(Python yalnızca facilities/register/login/reserve/menu/weather sunar; Node bunlara ek olarak orders,
analytics, İSPARK canlı, districts, proximity, admin gözetim, audit sunar). İkisi de aynı `app.db` +
`seed.json` kullanır. Kaybedilecek tek şey **gösteri/anlatı değeridir**: kripto ve şemanın diller-arası
**bit-uyumlu** olduğunun bağımsız ikinci kanıtı, Python `unittest` takımı ve stdlib-only scraper/weather.
Bu yüzden **tutuluyor** (portfolyo/DDIA anlatısı), ama ölü parçaları temizlendi (bkz. Bölüm 7).

---

## 6. Bilinen tekrarlar & tutarsızlıklar (durum)

| Konu | Durum |
|---|---|
| `istanbul-districts.geojson` — `backend/data/` ve `docs/data/` **iki kopya** | **Bilinçli.** İkisi ayrı runtime bağlamı: Node sunucu tarafı okur, Pages statik olarak servis eder. Teke indirmek Pages'i riske atar. Okunmayan üçüncü kopya (`advanced-gis/data/raw/`) **silindi.** |
| `data/seed.json` ↔ `docs/data/seed.json` ikizi | Frontend mock için gerekli; elle senkron riski var. İleride bir kopya script'i düşünülebilir (şimdilik not). |
| CLAUDE.md "sıfır dış bağımlılık" | **Düzeltildi:** DB için sıfır (`node:sqlite`), HTTP için express+cors. |
| "Python şeması senkron" | **Netleştirildi:** şema senkron, **API alt-küme**. |
| `staj_sunum_rehberi.md` eski mimari | **Sürüm notu bandı** eklendi (yeniden yazılmadı). |
| `README.md` kesik + OpenLayers placeholder | **Tamamlandı + Leaflet gerçeğiyle güncellendi.** |

---

## 7. Değişiklik günlüğü

- **2026-07-10 — İlk sürüm.** Belge oluşturuldu (teknoloji + dosya kataloğu). Yanında hedefli
  sadeleştirme: ham parolalı `advanced-gis/evaluation/golden_dataset.json`, yetim `advanced-gis/server.py`
  ve `advanced-gis/services/ispark.py`, okunmayan `advanced-gis/data/raw/istanbul-districts.geojson`,
  ölü `tracer.get_cost_estimate()` ve `main.py` `.padStart` dalı çıkarıldı; `config.py`'den kullanılmayan
  `DISTRICTS_GEOJSON_PATH` kaldırıldı; CLAUDE.md/README belge-kod tutarlılığı düzeltildi.
- **2026-07-10 — Demo giriş UX + geliştirici kuralları.** Pages mock'una `admin`/`admin1234` ve
  `user`/`user1234` demo hesapları eklendi (yalnız frontend `demo_users`; gerçek backend'i etkilemez),
  login formuna görünür ipucu kondu. `.agents/AGENTS.md` genişletildi: DDIA + **APoSD (Ousterhout)**
  ikincil rehber olarak tanımlandı, projeye özel 7 maddelik kural seti eklendi.
- *(Sonraki fazlar buraya birer satır ekler.)*
