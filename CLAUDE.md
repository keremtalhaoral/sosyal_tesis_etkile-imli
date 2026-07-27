# CLAUDE.md — Proje Rehberi

Bu dosya, projeyi devralan her Claude oturumunun **giriş kapısıdır**. Derin gerekçeler için
`docs/adr/` (ADR'ler) ve `DATABASE.md`'ye bak. **Her teknoloji ve dosyanın tek tek amacı** için
→ `docs/teknoloji-ve-dosya-rehberi.md` (yaşayan katalog). **Projeyi mentöre/juriye anlatmak** için
→ `docs/anlatim-rehberi.md` (ne gerçek/ne demo + savunma soruları).

## Proje
İstanbul sosyal tesisleri için etkileşimli Web GIS + karar destek. Harita, rezervasyon,
sipariş, İSPARK, analitik dashboard. Rehber ilke: **Designing Data-Intensive Applications
(DDIA, Kleppmann)** — her mimari karar bir ADR'de gerekçelendirilir. Kullanıcı karar alıcıdır;
kod ikincil, **öğrenme ve belgelenmiş karar** birincildir.

## Mimari
- **PostgreSQL 16 + PostGIS 3.4** = tek gerçek kaynak (ADR-009; SQLite kaldırıldı).
  `docker-compose.yml` ile ayağa kalkar; bağlantı `DATABASE_URL` ya da `PG*` env'lerinden.
- **`data/seed.json`** = kanonik veri (git'te). Veritabanı türetilmiştir, seed'den kurulur.
- **`backend/`** (Node/Express + `pg`): `database.js` (havuz + migration + seed +
  `transaction()`), `db.js` (repository + PostGIS sorguları), `analytics.js`, `geo.js`
  (ilçe geometrisi yükleyici), `security.js`, `validate.js`, `server.js` (API, port 8085),
  `test-helper.js` (şema-başına test izolasyonu). Tüm veri erişimi **async**.
- **Mekansal katman veritabanında**: `ST_Contains` (ilçe×tesis), `ST_Distance(geography)`
  (metre), KNN `<->` (GiST indeksli). `facilities.geom` lat/lng'den **generated** kolondur.
  İlçe geometrisi `docs/data/istanbul-districts.geojson`'dan `npm run db:load-geo` ile yüklenir
  (tek kanonik kopya; Pages de aynı dosyayı okur).
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
- Kapasite **per-slot** `SUM(guests)`; koruma **SERIALIZABLE + 40001 retry** ile sağlanır.
  PostgreSQL'de READ COMMITTED bunu KORUMAZ (ölçüldü: 40 worker/kapasite 10 → 18-22 rezervasyon
  geçiyor; SERIALIZABLE tam 10'da tutuyor). İSPARK atomik compare-and-set — tek satır çakışması
  olduğu için satır kilidi yeterli. (ADR-003, ADR-009)
- Analitik: canlı sorgu + `daily_stats` rollup (türetilmiş). Para toplamları **`::bigint`**
  olmak ZORUNDA: kuruş cinsinden int4 sınırı ~21,5M TL, bir yıllık veri bile aşıyor. (ADR-004)
- Tutarlar **sunucuda** hesaplanır (istemciye güvenilmez); sahiplik zorlanır (403). (ADR-005)
- Gerçek toplu taşıma güzergahları: GTFS `shapes` → türetilmiş slim GeoJSON (ham veri gitignored,
  kalite kapılı — düşük güven eşleşme uydurma çizgiye düşmez). (ADR-006)
- `audit_log` **append-only** (yalnız INSERT, mutasyonla aynı transaction); sipariş durumu
  whitelist state machine (`submitted→served→paid`, sıçrama yasak); admin gözetim uçları
  sahiplik filtresiz (`requireAdmin` ile korunur). (ADR-007)

## Çalıştırma & test
```bash
npm install
npm run db:up            # PostgreSQL + PostGIS (docker compose)
npm start                # migration+seed otomatik -> http://localhost:8085
npm run db:load-geo      # ilçe sınırlarını PostGIS'e yükle (bir kez)
# Dummy veri / türetilmiş çıktılar
npm run db:generate      # -- --scale=N --reset   (per-slot kapasite invariant'ını doğrular)
npm run export:analytics # -> docs/data/analytics.json (Pages snapshot)
npm run export:schema    # -> schema.sql (türetilmiş DDL; elle düzenlenmez)
npm run build:routes     # GTFS -> docs/data/transit-routes.geojson (ADR-006)
# Testler (her test kendi izole PostgreSQL şemasında; gerçek veriye dokunmaz)
npm test                 # 168 test: şema/kısıt/PostGIS, sipariş, analytics,
                         # eşzamanlılık (write-skew), GTFS, audit log, parola/zamanlama
# Pages'i yerelde görmek: cd docs && python3 -m http.server 8092
# Her özelliği SQL ile gösterme: queries.sql (psql/DBeaver) + anlatımı docs/sorgu-defteri.md
```

## Sözleşmeler
- Şema değişince `backend/database.js` MIGRATIONS güncellenir (şema tek yerde tanımlıdır);
  yeni faz = yeni migration versiyonu. Ardından `npm run export:schema`
  ile **`schema.sql` yeniden üretilir** (türetilmiş DDL dokümanı; elle düzenlenmez).
- **Yeni dosya/teknoloji eklenince** `docs/teknoloji-ve-dosya-rehberi.md` güncellenir (dosya-dosya
  katalog + değişiklik günlüğü güncel kalır).
- Her fazın çıktısı: kod + **ADR** (`docs/adr/`) + testler + (UI ise) açık/koyu tema doğrulaması.
- Chart/görsel iş: **dataviz** becerisini yükle, doğrulanmış paleti kullan.
- CDN yok — dış kütüphaneler `docs/vendor/`'a alınır (offline çalışmalı).
- Commit/PR/kod İngilizce+Türkçe karışabilir; ADR ve kullanıcı-facing metin Türkçe.
