# Sosyal Tesis Etkileşimli Harita Projesi (Web GIS)

Bu proje, sosyal tesislerin coğrafi verilerini harita üzerinde etkileşimli olarak görselleştirmek, sorgulamak ve analiz etmek amacıyla geliştirilmiş modern bir **Web GIS (Coğrafi Bilgi Sistemi)** uygulamasıdır. 

## 🚀 Özellikler
- **Etkileşimli Harita Katmanları:** Altlık haritalar arasında geçiş ve özel sosyal tesis katmanlarının yönetimi.
- **Mekansal Sorgulama:** Harita üzerindeki tesislere tıklandığında dinamik bilgi pencereleri (Popup) ve detay gösterimi.
- **Veri Filtreleme:** Türlerine, konumlarına veya kapasitelerine göre tesis analizleri.
- **Rezervasyon, Sipariş, İSPARK ve Analitik Dashboard:** Karar destek odaklı uçlar (bkz. `DATABASE.md` API tablosu).

## 🛠️ Teknolojiler ve Bağımlılıklar
Projenin geliştirilmesinde aşağıdaki teknoloji yığını kullanılmıştır. Her seçimin **neden** yapıldığı
ve her dosyanın **ne işe yaradığı** için → [`TEKNOLOJI_VE_DOSYA_REHBERI.md`](TEKNOLOJI_VE_DOSYA_REHBERI.md).
- **Frontend:** HTML5, CSS3, JavaScript (ES6+) — `docs/` altında, sunucusuz (GitHub Pages).
- **Harita / GIS:** **Leaflet** (harita render) + **Turf.js** (mekansal analiz) + **Chart.js** (analitik grafik) — hepsi `docs/vendor/`'da vendored (CDN'siz, offline çalışır).
- **Backend:** Node.js + Express + `cors`; veritabanı yerleşik `node:sqlite` (DB için sıfır dış bağımlılık).
- **İkiz Servis:** `advanced-gis/` (Python stdlib) — aynı `app.db`'yi paylaşan, diller-arası kripto/şema parity göstergesi.
- **Veritabanı:** Merkezi SQLite (WAL modu) — tüm servislerin paylaştığı tek gerçek kaynak; tasarım ve PostgreSQL + PostGIS geçiş yolu için bkz. [DATABASE.md](DATABASE.md).

## 💻 Yerel Geliştirme ve Çalıştırma

Projenin yerel bilgisayarınızda çalıştırılması için aşağıdaki adımları takip edebilirsiniz:

1. **Depoyu klonlayın:**
   ```bash
   git clone https://github.com/keremtalhaoral/sosyal_tesis_etkile-imli.git
   cd sosyal_tesis_etkile-imli
   ```

2. **Backend'i başlatın** (ilk açılışta migration + seed otomatik):
   ```bash
   cd backend && npm install && npm start        # http://localhost:8085
   ```

3. **Frontend'i (GitHub Pages içeriğini) yerelde görün:**
   ```bash
   cd docs && python3 -m http.server 8092         # http://localhost:8092
   ```

4. **Testleri çalıştırın** (geçici DB kullanır, gerçek veriye dokunmaz):
   ```bash
   node backend/test-db.js          # şema, kısıt, transaction
   node backend/test-orders.js      # sipariş + durum makinesi
   node backend/test-analytics.js   # analytics (rollup == canlı)
   node backend/test-concurrency.js # write-skew / atomiklik
   node backend/test-routes.js      # GTFS ingest
   node backend/test-admin.js       # audit log, admin gözetim
   ```

## 📚 Belgeler
- [`CLAUDE.md`](CLAUDE.md) — proje rehberi / giriş kapısı, mimari ve gömülü kararlar.
- [`TEKNOLOJI_VE_DOSYA_REHBERI.md`](TEKNOLOJI_VE_DOSYA_REHBERI.md) — her teknoloji ve dosyanın amacı (yaşayan katalog).
- [`DATABASE.md`](DATABASE.md) — merkezi veri mimarisi (DDIA tabanlı) ve API tablosu.
- [`docs/adr/`](docs/adr/) — mimari karar kayıtları (ADR-001 … ADR-007).
