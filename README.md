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

### 🔑 Hangi hesapla giriş yapılır?

Parolalar **çalıştığınız moda göre değişir** — en sık takılınan yer burası.
`npm start` açılışta hangi hesapların geçerli olduğunu **konsola yazar**; oraya bakmak
en hızlı yol.

| Mod | Nasıl anlarım | Kullanıcı / parola |
|---|---|---|
| **Canlı — `public` şeması** (`npm start`) | sayfada "● Canlı veritabanı" rozeti | `admin` ve `user`; parolalar **rastgele üretilir** → `data/dev-credentials.json` (gitignored). Açılış logunda da yazar. |
| **Canlı — `demo` şeması** (`npm run demo:start`) | sunum modu, 5 tesis / 0 rezervasyon | `demo_admin / DemoAdmin2026`, `ayse / AyseParola26`, `mehmet / MehmetParola26` → `data/demo-users.json` |
| **Çevrimdışı replika** (backend kapalı ya da GitHub Pages) | sayfada "○ Çevrimdışı replika" rozeti | `admin / admin1234`, `user / user1234`, `demo / demo1234`, `demo-admin / demo1234` |

> **Neden üç ayrı set?** `public` şemasının parolaları ADR-002 gereği rastgele üretilir ve
> **git'e hiç girmez** — bu yüzden onları ancak yerel dosyadan (ya da açılış logundan)
> öğrenebilirsiniz. `demo` şemasınınkiler sunumda giriş yapılabilsin diye **kasıtlı olarak
> sabit ve git'te**. Çevrimdışı replikanınkiler ise gerçek değil, tarayıcı içinde yaşayan
> taklit hesaplar.

> **`429` alıyorsanız** parola yanlış demek değil: 15 dakikada 5 başarısız denemeden sonra
> hız sınırı devreye giriyor. Bekleyin ya da sunucuyu yeniden başlatın (sayaç bellekte).

4. **Testleri çalıştırın** (her test kendi izole şemasında koşar, gerçek veriye dokunmaz):
   ```bash
   npm test
   ```
   Tek tek: `node backend/test-db.js` (şema/kısıt/PostGIS), `test-orders.js` (sipariş +
   durum makinesi), `test-analytics.js` (rollup == canlı), `test-concurrency.js`
   (write-skew: READ COMMITTED overbook eder, SERIALIZABLE etmez), `test-routes.js`
   (GTFS ingest), `test-admin.js` (audit log), `test-auth.js` (parola/zamanlama).

## 📚 Belgeler

### 🎓 "Hiçbir şey bilmiyorum, nereden başlamalıyım?"

→ **[`docs/ogrenme/`](docs/ogrenme/)** — projeyi sıfırdan anlatan öğrenme kitabı.
Feynman tekniğiyle yazıldı: her konu tek cümleyle başlar, benzetmeyle devam eder,
**benzetmenin nerede bozulduğunu** söyler, sonra derinleşir. Her bölümde çalıştırılabilir
komutlar ve "mentör sorarsa" cevapları var.

- **Katmanlı kitap (00→12):** [proje ne yapıyor](docs/ogrenme/00-bu-proje-ne-yapiyor.md) →
  [web](docs/ogrenme/01-web-nasil-calisir.md) →
  [veritabanı](docs/ogrenme/02-veritabani-nedir.md) →
  [SQL](docs/ogrenme/03-sql-ile-konusmak.md) →
  [neden PostgreSQL](docs/ogrenme/04-neden-postgresql.md) →
  [PostGIS](docs/ogrenme/05-harita-verisi-postgis.md) →
  [eşzamanlılık](docs/ogrenme/06-ayni-anda-iki-kisi.md) →
  [kimlik/kripto](docs/ogrenme/07-kimlik-ve-sifreleme.md) →
  [backend](docs/ogrenme/08-backend-node-express.md) →
  [frontend](docs/ogrenme/09-frontend-harita.md) →
  [veri kaynakları](docs/ogrenme/10-veri-nereden-geliyor.md) →
  [canlı güncelleme](docs/ogrenme/12-canli-guncelleme.md) →
  [sözlük](docs/ogrenme/11-sozluk.md)
- **Teknoloji başına derin dosyalar:** [`docs/ogrenme/teknoloji/`](docs/ogrenme/teknoloji/)
  — 17 dosya. Her biri: *ne olduğu, hangi problemi çözmek için doğduğu, alternatifleri ve
  neden seçilmedikleri, bu projede tam olarak nerede, bilinmesi gereken tuzaklar.*

### Diğer belgeler
- [`CLAUDE.md`](CLAUDE.md) — proje rehberi / giriş kapısı, mimari ve gömülü kararlar.
- [`docs/anlatim-rehberi.md`](docs/anlatim-rehberi.md) — projeyi anlatma rehberi: ne gerçek / ne demo, savunma soruları.
- [`docs/dbeaver-rehberi.md`](docs/dbeaver-rehberi.md) — **DBeaver sıfırdan + 9 adımlık sunum senaryosu** (ne diyeceğiniz dahil).
- [`docs/teknoloji-ve-dosya-rehberi.md`](docs/teknoloji-ve-dosya-rehberi.md) — her teknoloji ve dosyanın amacı (yaşayan katalog).
- [`docs/sorgu-defteri.md`](docs/sorgu-defteri.md) + [`queries.sql`](queries.sql) — her özelliği SQL ile gösterme.
- [`DATABASE.md`](DATABASE.md) — merkezi veri mimarisi (DDIA tabanlı) ve API tablosu.
- [`docs/adr/`](docs/adr/) — mimari karar kayıtları (ADR-001 … ADR-010).
