# Sosyal Tesis Etkileşimli Harita Projesi (Web GIS)

Bu proje, sosyal tesislerin coğrafi verilerini harita üzerinde etkileşimli olarak görselleştirmek, sorgulamak ve analiz etmek amacıyla geliştirilmiş modern bir **Web GIS (Coğrafi Bilgi Sistemi)** uygulamasıdır. 

## 🚀 Özellikler
- **Etkileşimli Harita Katmanları:** Altlık haritalar arasında geçiş ve özel sosyal tesis katmanlarının yönetimi.
- **Mekansal Sorgulama:** Harita üzerindeki tesislere tıklandığında dinamik bilgi pencereleri (Popup) ve detay gösterimi.
- **Veri Filtreleme:** Türlerine, konumlarına veya kapasitelerine göre tesis analizleri.
- **Rezervasyon, Sipariş, İSPARK ve Analitik Dashboard:** Karar destek odaklı uçlar (bkz. `DATABASE.md` API tablosu).

## 🛠️ Teknolojiler ve Bağımlılıklar
Projenin geliştirilmesinde aşağıdaki teknoloji yığını kullanılmıştır. Her seçimin **neden** yapıldığı
ve her dosyanın **ne işe yaradığı** için → [`docs/teknoloji-ve-dosya-rehberi.md`](docs/teknoloji-ve-dosya-rehberi.md).
- **Frontend:** HTML5, CSS3, JavaScript (ES6+) — `docs/` altında, sunucusuz (GitHub Pages).
- **Harita / GIS:** **Leaflet** (harita render) + **Turf.js** (mekansal analiz) + **Chart.js** (analitik grafik) — hepsi `docs/vendor/`'da vendored (CDN'siz, offline çalışır).
- **Backend:** Node.js + Express + `cors` + `pg`.
- **Veritabanı:** **PostgreSQL 16 + PostGIS 3.4** — tek gerçek kaynak. Mekansal sorgular
  (`ST_Contains`, `ST_Distance`, KNN `<->`) veritabanında koşar; eşzamanlılık SERIALIZABLE
  ile korunur. Gerekçe ve SQLite'tan geçişin bedeli: [ADR-009](docs/adr/ADR-009-postgresql-postgis.md).

## 💻 Yerel Geliştirme ve Çalıştırma

Projenin yerel bilgisayarınızda çalıştırılması için aşağıdaki adımları takip edebilirsiniz:

1. **Depoyu klonlayın:**
   ```bash
   git clone https://github.com/keremtalhaoral/sosyal_tesis_etkile-imli.git
   cd sosyal_tesis_etkile-imli
   ```

2. **Veritabanını ve backend'i başlatın** (ilk açılışta migration + seed otomatik):
   ```bash
   npm install
   npm run db:up          # PostgreSQL + PostGIS (docker compose)
   npm start              # http://localhost:8085
   npm run db:load-geo    # ilçe sınırlarını PostGIS'e yükle (bir kez)
   ```
   Docker kullanmıyorsanız yerel bir PostgreSQL 16 + PostGIS 3 yeterli; bağlantı
   ayarları için `.env.example` dosyasına bakın.

3. **Frontend'i (GitHub Pages içeriğini) yerelde görün:**
   ```bash
   cd docs && python3 -m http.server 8092         # http://localhost:8092
   ```

4. **Testleri çalıştırın** (her test kendi izole şemasında koşar, gerçek veriye dokunmaz):
   ```bash
   npm test
   ```
   Tek tek: `node backend/test-db.js` (şema/kısıt/PostGIS), `test-orders.js` (sipariş +
   durum makinesi), `test-analytics.js` (rollup == canlı), `test-concurrency.js`
   (write-skew: READ COMMITTED overbook eder, SERIALIZABLE etmez), `test-routes.js`
   (GTFS ingest), `test-admin.js` (audit log), `test-auth.js` (parola/zamanlama).

## 📚 Belgeler
- [`CLAUDE.md`](CLAUDE.md) — proje rehberi / giriş kapısı, mimari ve gömülü kararlar.
- [`docs/anlatim-rehberi.md`](docs/anlatim-rehberi.md) — projeyi anlatma rehberi: ne gerçek / ne demo, savunma soruları.
- [`docs/teknoloji-ve-dosya-rehberi.md`](docs/teknoloji-ve-dosya-rehberi.md) — her teknoloji ve dosyanın amacı (yaşayan katalog).
- [`docs/sorgu-defteri.md`](docs/sorgu-defteri.md) + [`queries.sql`](queries.sql) — her özelliği SQL ile gösterme.
- [`DATABASE.md`](DATABASE.md) — merkezi veri mimarisi (DDIA tabanlı) ve API tablosu.
- [`docs/adr/`](docs/adr/) — mimari karar kayıtları (ADR-001 … ADR-009).
