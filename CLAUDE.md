# CLAUDE.md — Proje Rehberi

Bu dosya, projeyi devralan her Claude oturumunun **giriş kapısıdır**. Derin gerekçeler için
`docs/adr/` (ADR'ler) ve `DATABASE.md`'ye bak. **Her teknoloji ve dosyanın tek tek amacı** için
→ `TEKNOLOJI_VE_DOSYA_REHBERI.md` (yaşayan katalog).

## Proje
İstanbul sosyal tesisleri için etkileşimli Web GIS + karar destek. Harita, rezervasyon,
sipariş, İSPARK, analitik dashboard. Rehber ilke: **Designing Data-Intensive Applications
(DDIA, Kleppmann)** — her mimari karar bir ADR'de gerekçelendirilir. Kullanıcı karar alıcıdır;
kod ikincil, **öğrenme ve belgelenmiş karar** birincildir.

## Mimari
- **Merkezi SQLite** (`data/app.db`, WAL) = tek gerçek kaynak. Node ve Python servisleri paylaşır.
- **`data/seed.json`** = kanonik veri (git'te). `app.db` türetilmiş (gitignored), seed'den kurulur.
- **`backend/`** (Node/Express, `node:sqlite`): DB için **sıfır dış bağımlılık** (SQLite yerleşik
  `node:sqlite`'tan gelir); HTTP katmanı `express` + `cors` kullanır (bkz. `backend/package.json`).
  `database.js` (migration+seed+`transaction()`), `db.js` (repository+mekansal), `analytics.js`,
  `security.js`, `validate.js`, `server.js` (API, port 8085).
- **`advanced-gis/`** (Python stdlib): aynı `app.db`'yi kullanır; şema `app/models.py`'de Node ile
  **senkron** ama **API bir alt-kümedir** (orders/analytics/audit uçları yalnız Node'da). Diller-arası
  kripto/şema parity göstergesi (portfolyo değeri). Rol detayı → `TEKNOLOJI_VE_DOSYA_REHBERI.md`.
- **`docs/`** = GitHub Pages (sunucusuz). `dashboard.html`/`order.html`: gerçek çift mod (önce canlı
  API dener, `localStorage`+`seed.json`'a düşer). `index.html` (ana harita+admin panel): **kasıtlı
  olarak her zaman mock** — `docs/app.js`'teki `window.fetch` override'ı bilinen uçları tarayıcı-içi
  simüle eder (statik siteye gerçek backend parola hash'i asla gönderilmez, ADR-002/ADR-007);
  bilinmeyen uçlar gerçek ağa düşer (`originalFetch` passthrough).
- **`scripts/`**: `generate-data.js` (dummy veri, `--scale`), `export-analytics.js` (Pages snapshot),
  `build-routes.js` (GTFS → `docs/data/transit-routes.geojson`; ham GTFS `data/gtfs/` gitignored,
  türetilmiş slim çıktı commit — ADR-006. `stop_times` EKSİKSİZ olmalı; kesikse kapsam kısıtlı).

## Branch stratejisi (ÖNEMLİ)
- `main` = kullanıcı elle merge edene dek sabit.
- `v_2` = main'den dallanan entegrasyon dalı. Her faz `v2-0X-...` olarak **v_2'den** dallanır,
  PR ile v_2'ye döner. İleride `v_3` yine main'den başlar.
- **Granülerlik = faz** (bir dal = anlatılabilir bir karar). Fazlar: v2-01 veri modeli → v2-02
  auth/kripto → v2-03 eşzamanlılık → v2-04 analytics → v2-05 sipariş → v2-06 rota → v2-07 admin
  (son faz — v_2'ye merge sonrası ileriki fazlar için kullanıcı karar verir).
- **Merge kuralı (Option B):** merge etmeden ÖNCE kullanıcıya "merge edeyim mi?" diye sor.

## Gömülü kararlar (tekrar tartışma; ADR'lerde tam gerekçe)
- Para her yerde **tam sayı kuruş** (`*_minor`), asla float. (ADR-001)
- Sipariş **rezervasyona bağlı**; sipariş kalemi fiyatı **snapshot** (captured vs derived). (ADR-001/005)
- Parola **PBKDF2 + per-user salt**, PHC formatı; JWT HS256 + `exp`; sırlar env'de; ham parola
  git'te YOK (`data/dev-credentials.json`, gitignored). (ADR-002)
- Kapasite **per-slot** `SUM(guests)` + atomik transaction (write-skew'e kapalı); İSPARK atomik
  compare-and-set. (ADR-003)
- Analitik: canlı sorgu + `daily_stats` rollup (türetilmiş); ~178× hızlanma. (ADR-004)
- Tutarlar **sunucuda** hesaplanır (istemciye güvenilmez); sahiplik zorlanır (403). (ADR-005)
- Gerçek toplu taşıma güzergahları: GTFS `shapes` → türetilmiş slim GeoJSON (ham veri gitignored,
  kalite kapılı — düşük güven eşleşme uydurma çizgiye düşmez). (ADR-006)
- `audit_log` **append-only** (yalnız INSERT, mutasyonla aynı transaction); sipariş durumu
  whitelist state machine (`submitted→served→paid`, sıçrama yasak); admin gözetim uçları
  sahiplik filtresiz (`requireAdmin` ile korunur). (ADR-007)

## Çalıştırma & test
```bash
# Backend (ilk açılışta migration+seed otomatik)
cd backend && npm install && npm start        # http://localhost:8085
# Dummy veri / analitik snapshot
node scripts/generate-data.js [--scale=N] [--reset]
node scripts/export-analytics.js              # -> docs/data/analytics.json
node scripts/export-schema.js                 # -> schema.sql (türetilmiş DDL; migration'lardan)
# Testler (geçici DB, gerçek veriye dokunmaz)
node backend/test-db.js          # şema, kısıt, tx
node backend/test-orders.js      # sipariş + durum makinesi (submitted→served→paid)
node backend/test-analytics.js   # analytics (rollup==canlı)
node backend/test-concurrency.js # write-skew / atomik (worker_threads)
node backend/test-routes.js      # GTFS ingest (fixture; ADR-006)
node backend/test-admin.js       # audit log, admin gözetim, requireAdmin (ADR-007)
# Python
cd advanced-gis && python3 scripts/seed.py && python3 tests/test_crypto.py
# Pages'i yerelde görmek: cd docs && python3 -m http.server 8092
# Her özelliği SQL ile gösterme: queries.sql (DBeaver) + anlatımı docs/sorgu-defteri.md
```

## Sözleşmeler
- Şema değişince **hem** `backend/database.js` MIGRATIONS **hem** `advanced-gis/app/models.py`
  güncellenir (senkron); yeni faz = yeni migration versiyonu. Ardından `node scripts/export-schema.js`
  ile **`schema.sql` yeniden üretilir** (türetilmiş DDL dokümanı; elle düzenlenmez).
- **Yeni dosya/teknoloji eklenince** `TEKNOLOJI_VE_DOSYA_REHBERI.md` güncellenir (dosya-dosya
  katalog + değişiklik günlüğü güncel kalır).
- Her fazın çıktısı: kod + **ADR** (`docs/adr/`) + testler + (UI ise) açık/koyu tema doğrulaması.
- Chart/görsel iş: **dataviz** becerisini yükle, doğrulanmış paleti kullan.
- CDN yok — dış kütüphaneler `docs/vendor/`'a alınır (offline çalışmalı).
- Commit/PR/kod İngilizce+Türkçe karışabilir; ADR ve kullanıcı-facing metin Türkçe.
