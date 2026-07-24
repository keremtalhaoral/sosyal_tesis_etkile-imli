# Proje Anlatım Rehberi — Mentöre Karşı Savunma Kılavuzu

> Bu belge, projeyi **bugünkü hâliyle** (sadeleştirme + doğruluk turu sonrası) mentöre/juriye
> anlatabilmen için yazıldı. Amaç ezber değil: **her ekranın arkasında ne olduğunu, hangi kararı
> neden verdiğini ve neyin gerçek/neyin demo olduğunu** dürüstçe açıklayabilmek. Derin gerekçeler
> için ADR'ler (`docs/adr/`), veritabanı detayı için `DATABASE.md` ve `VERITABANI_ANLATIM_REHBERI.md`,
> her dosyanın amacı için `TEKNOLOJI_VE_DOSYA_REHBERI.md`.

---

## 0. Bir cümlede proje
İstanbul sosyal tesisleri için **etkileşimli Web GIS + karar destek** uygulaması: haritada tesisler,
rezervasyon + sipariş, İSPARK/otopark, toplu taşıma güzergahları ve analitik dashboard.

**Mimari (tek cümle):** Repo kökündeki **tek bir SQLite dosyası (`data/app.db`, WAL)** tek gerçek
kaynaktır; onu bir **Node/Express backend** (port 8085) yönetir; **`docs/` statik frontend** (GitHub
Pages) hem canlı backend'e bağlanabilir hem de backend yokken çevrimdışı replika ile çalışır.

> ⚠️ Not: Proje eskiden bir de Python `advanced-gis` "ikiz servisi" içeriyordu. **Kaldırıldı.** Artık
> **tek dilli (Node)**. "Neden iki dil?" sorusuyla uğraşman gerekmez — tek beyin, tek şema, tek kripto.

---

## 1. Mimari — büyük resim

```
        data/seed.json  (KANONİK veri, git'te, elle düzenlenir)
                │  seed (idempotent)
                ▼
   backend/ (Node/Express) ──► data/app.db  (SQLite, WAL — TEK GERÇEK KAYNAK)
                │  türetilir (export-analytics.js / export-schema.js)
                ▼
   docs/ (GitHub Pages, statik) ──► tarayıcıda localStorage + JSON snapshot (çevrimdışı replika)
```

**Anlatım:** *"Kanonik veri ile türetilmiş veriyi ayırıyorum. `seed.json` insan-okur kanonik kaynak;
`app.db` ondan kurulan çalışma zamanı veritabanı (git'e girmez, türetilmiştir); Pages'teki snapshot'lar
da app.db'den türetilir. Tek gerçek kaynak (single source of truth) ilkesi — DDIA Bölüm 11."*

**Backend dosyaları (ne işe yarar):**
- `database.js` — app.db'yi açar, **versiyonlu migration** zinciri (v1–v6), `seed.json`'dan tohumlama,
  `transaction()` (atomik), parola hash'leme. *Depolama katmanı.*
- `db.js` — repository + **mekansal** fonksiyonlar (nokta-poligon, Haversine, KNN). *İş katmanı.*
- `analytics.js` — canlı analitik sorgular + `daily_stats` rollup.
- `security.js` — JWT + HMAC imza.
- `validate.js` — girdi doğrulama (DB CHECK'lerinden önce dostça hata).
- `server.js` — API router (port 8085) + hava durumu servisi.

---

## 2. 🏆 En güçlü kartın: Per-slot kapasite + atomik transaction (write-skew'e kapalı)

Bu, projenin **en savunulabilir ve en etkileyici** parçası. Ezberle.

**Sorun:** Aynı (tesis, tarih, saat slotu) için son boş yerleri iki kişi aynı anda kapamaya çalışırsa
naif kod (önce oku, sonra yaz) **overbooking** yapar — buna DDIA'da *write-skew* denir.

**Çözüm (`backend/db.js` → `createReservation`):** Oku + kontrol + yaz **tek atomik transaction**
içinde (`BEGIN IMMEDIATE`):
```js
transaction((conn) => {
  const { booked } = conn.prepare(`
    SELECT COALESCE(SUM(guests),0) AS booked FROM reservations
    WHERE facility_id=? AND reserve_date=? AND reserve_time=? AND status!='cancelled'
  `).get(facilityId, reserveDate, reserveTime);
  if (booked + guests > facility.capacity) throw 409;   // slot dolu
  conn.prepare('INSERT INTO reservations (...) VALUES (...)').run(...);
});
```
Kapasite kararı **kaba global yüzde değil**, tam olarak o slottaki onaylı misafir **toplamı** üzerinden.
`facilities.occupancy` artık yalnız görüntüleme metriğidir; booking'in kaynağı değil.

**Kanıt:** `backend/test-concurrency.js` gerçek `worker_threads` ile eşzamanlı rezervasyon dener ve
overbooking olmadığını gösterir. (ADR-003)

> **Mentör sorarsa "iki kişi aynı anda son yeri alırsa?"**
> *"`BEGIN IMMEDIATE` ile transaction başında yazma kilidi alınır; ikinci işlem birincinin commit'ini
> bekler, sonra güncel `booked` toplamını görür ve kapasiteyi aşıyorsa 409 alır. Okuma+kontrol+yazma
> bölünemez olduğu için son yer paylaşılamaz. Bunu worker_threads ile test ettim."*

---

## 3. Kimlik & Kripto (ADR-002)

- **Parola:** `PBKDF2-HMAC-SHA256`, **600.000 iterasyon** (OWASP 2023), **kullanıcı başına rastgele
  salt** (`crypto.randomBytes(16)`), **PHC formatında** saklanır: `pbkdf2_sha256$600000$<salt>$<hash>`.
  (`backend/database.js` → `hashPassword`/`verifyPassword`)
- **Oturum:** `JWT HS256` (`iat`/`exp`), imza `HMAC-SHA256`; doğrulama **sabit-zamanlı**
  (`crypto.timingSafeEqual`). (`backend/security.js`)
- **Bütünlük:** her rezervasyon/sipariş `HMAC-SHA256` ile imzalanır (`signReservation`/`signOrder`).
- **Sırlar** env'den gelir; ham parolalar git'e girmez (`data/dev-credentials.json`, gitignored).

> **"Parolaları nasıl saklıyorsun?"** → *"Düz metin asla. PBKDF2, 600k iterasyon, kullanıcı başına
> rastgele salt, PHC formatı. Tek yönlü; DB sızsa bile geri çıkmaz; salt'lar farklı olduğu için iki
> aynı parola bile farklı hash üretir, rainbow-table işe yaramaz."*
> **"Neden JWT?"** → *"Sunucu durumsuz doğrulama yapsın diye; `exp` ile süre, timingSafeEqual ile
> timing-attack'a kapalı imza."*

---

## 4. Para = tam sayı kuruş, asla float (ADR-001)

Tüm tutarlar `*_minor` (kuruş, integer). 45,00 TL = `4500`. Float yuvarlama hatası (0.1+0.2≠0.3) para
için kabul edilemez. Tutarlar **sunucuda** hesaplanır, istemciye güvenilmez.

> **"Neden float değil?"** → *"Para float ile tutulmaz; yuvarlama hataları birikir. Kuruş cinsinden
> integer tutuyorum, gösterirken 100'e bölüyorum."*

---

## 5. Sipariş: rezervasyona bağlı + fiyat snapshot + durum makinesi (ADR-005/007)

- Sipariş bir **rezervasyona bağlıdır**; sahiplik zorlanır (başkasının siparişine 403).
- Sipariş kalemi fiyatı **snapshot**'tır: sipariş anındaki `unit_price_minor` kaydedilir; menü fiyatı
  sonra değişse bile geçmiş sipariş değişmez (*captured vs derived*).
- **Durum makinesi** (`backend/db.js`, `ALLOWED_TRANSITIONS`): `submitted → served → paid` (+`cancelled`).
  Sıçrama **yasak** — `submitted`'dan doğrudan `paid`'e geçilemez; whitelist dışı geçiş reddedilir.
- Toplam **sunucuda** hesaplanır (istemciye güvenilmez).

> **"Menü fiyatı değişince eski siparişler ne olur?"** → *"Değişmez. Fiyatı sipariş anında kaleme
> snapshot'lıyorum; rapor ve geçmiş tutarlı kalır."*

---

## 6. Analitik: canlı sorgu + rollup (ADR-004)

Dashboard'ın 8 grafiği **gerçek SQL agregasyonlarından** gelir (ciro zaman serisi, doluluk ısı
haritası, tesis karşılaştırma, ödeme kırılımı, bebe sandalyesi, iptal oranı, kategori satışları, KPI).

- **OLTP vs OLAP (DDIA Böl. 3):** yazma çok/küçük (rezervasyon), analitik okuma az/ağır. `daily_stats`
  **rollup** tablosu (gün×tesis özeti) ağır agregasyonu hızlandırır.
- Rollup **türetilmiş veridir**; kaynaktan yeniden kurulur (`rebuildDailyStats`). Canlı sonuç ile
  rollup sonucunun **birebir aynı** olduğu `test-analytics.js`'te doğrulanır (parity).
- Ölçüm (197k rezervasyon): aylık ciro **633 ms → 3.6 ms ≈ 178× hızlanma** (ADR-004).

> **"Rollup neden var?"** → *"Aynı cevabı iki büyüklük mertebesi hızlı veriyor. Ama türetilmiş; her an
> kaynaktan yeniden üretilebilir, o yüzden tutarlılığı testle garanti ediyorum."*

---

## 7. Denetim & yönetim (ADR-007)

- `audit_log` **append-only** (yalnız INSERT), mutasyonla **aynı transaction** içinde yazılır — kim,
  ne zaman, neyi değiştirdi izi kaybolmaz.
- Admin gözetim uçları (`/api/admin/*`) sahiplik filtresiz **tüm** kayıtları görür ama `requireAdmin`
  ile korunur (rol JWT'den).

---

## 8. Harita & rotalar

- **Gerçek toplu taşıma güzergahları:** ham GTFS `shapes` → türetilmiş slim GeoJSON
  (`docs/data/transit-routes.geojson`, `scripts/build-routes.js`). Düşük güven eşleşme uydurma çizgiye
  düşmez — kalite kapılı (ADR-006).
- **Sürüş rotası:** OSRM (`router.project-osrm.org`) gerçek yol geometrisini çizer ve **mesafe (km) +
  süre (dk)** gösterir. Çevrimiçi gerekir; erişilemezse düz-çizgi + Haversine tahmini yedeği devreye girer.
- **Mekansal analiz kod içinde:** nokta-poligon (ilçe içinde mi), Haversine (mesafe), KNN (en yakın
  tesis/otopark) — `backend/db.js` ve frontend `matrix.js` (`MatrixEngine`). PostGIS'e geçişte
  `ST_Contains`/`ST_Distance`/`<->` karşılıkları.

---

## 9. Çift-mod frontend (kritik: bunu netleştir)

`docs/` statik bir sitedir (Pages'te backend yoktur). Üç davranış vardır:
1. **`dashboard.html` / `order.html`** — **gerçek çift mod:** önce canlı API'yi dener, erişemezse
   `localStorage` + `seed.json` + JSON snapshot'a düşer.
2. **`index.html` (ana harita + admin)** — **kasıtlı olarak her zaman mock:** `docs/app.js`'teki
   `window.fetch` override'ı bilinen API uçlarını **tarayıcı içinde** simüle eder. Neden? Statik siteye
   gerçek parola hash'i/backend gönderilmez (ADR-002/007). Bilinmeyen uçlar gerçek ağa geçer.
3. **Yerelde canlı:** `cd backend && npm start` sonra `docs/`'u açarsan gerçek backend'e bağlanır.

> **"Pages'te backend yoksa nasıl çalışıyor?"** → *"Frontend'i çift modlu yaptım: canlıysa backend'e
> gider, değilse aynı şekle sahip çevrimdışı replikayla çalışır. Ana harita ise güvenlik gereği hep
> tarayıcı-içi mock — statik siteye gerçek kimlik/hash koymam."*

---

## 10. ⭐ NE GERÇEK, NE DEMO? (dürüstlük tablosu — en önemli bölüm)

Mentör "bu veri gerçek mi?" diye sorarsa **dürüst ve net** ol. Uydurmayı gerçek gibi sunmak en büyük
risktir; ayrımı bilmek en büyük güçtür.

| Ekran / özellik | Durum | Açıklama |
|---|---|---|
| Rezervasyon, sipariş, kapasite, kullanıcılar | **GERÇEK** | Canlı backend + SQLite; atomik transaction'lar. |
| Auth (parola hash, JWT, imza) | **GERÇEK** | PBKDF2 600k + per-user salt, HS256. |
| Analitik dashboard grafikleri | **GERÇEK ama snapshot** | Veri gerçek SQL'den; Pages'te backend olmadığı için **sabit `analytics.json` anlık görüntüsü** okunur. Banner tarih + adet gösterir. Canlı backend'de değişir. |
| Toplu taşıma güzergahları (GTFS) | **GERÇEK (türetilmiş)** | Ham GTFS'ten üretilmiş gerçek geometri; verisi eksik hatlar dürüstçe "hat yok" der. |
| Sürüş rotası + mesafe/süre (OSRM) | **GERÇEK (canlı, dış API)** | Çevrimiçi çalışır; çevrimdışıysa düz-çizgi + tahmini yedeğe düşer (etiketli). |
| Hava durumu | **DEMO (deterministik)** | API anahtarı yoksa koordinata göre **sabit** üretilir (rastgele değil). Anahtar varsa gerçek OpenWeather. |
| Haritadaki İSPARK otopark doluluğu | **DEMO (deterministik)** | Harita işaretleri ayrı bir hardcoded liste (15 kamu otoparkı). Doluluk konuma göre **sabit demo**; sahte "canlı feed" iddiası yok. |
| (Backend) her tesisin kendi İSPARK'ı | **GERÇEK** | `ispark_status` tohumlu; atomik take/release var (ADR-003). Şu an UI'da yüzeye çıkmıyor — istersen bağlanabilir. |

> **"Hava/İSPARK gerçek mi?"** → *"Hayır, onlar bilinçli demo — gerçek bir İBB feed'im yok. Ama
> uydurma-rastgele değil, deterministik: aynı yerde hep aynı değer, ve ekranda 'demo' olarak dürüstçe
> etiketli. Gerçek canlı veri istersem OpenWeather anahtarı takıp hava durumunu gerçeğe çeviriyorum."*

---

## 11. Çalıştırma & demo senaryosu

```bash
# 1) Backend (ilk açılışta migration + seed otomatik)
cd backend && npm install && npm start          # http://localhost:8085

# 2) Testler (geçici DB; gerçek veriye dokunmaz) — hepsi yeşil olmalı
node backend/test-db.js          # şema, kısıt, PBKDF2, KNN, atomik rezervasyon
node backend/test-concurrency.js # write-skew / overbooking kanıtı (worker_threads)
node backend/test-orders.js      # sipariş + durum makinesi
node backend/test-analytics.js   # rollup == canlı (parity)
node backend/test-admin.js       # audit log, requireAdmin

# 3) Arayüz (canlı mod için backend açıkken)
cd docs && python3 -m http.server 8092          # http://localhost:8092

# 4) Zengin analitik snapshot'ı yeniden üretmek (istersen)
DB_PATH=/tmp/rich.db node scripts/generate-data.js --scale=1 --reset
DB_PATH=/tmp/rich.db node scripts/export-analytics.js   # -> docs/data/analytics.json
```

**Önerilen demo akışı:** (1) haritadan tesis seç → menü + hava + İSPARK + rota görünsün → (2) giriş yap,
rezervasyon oluştur (imza görünür) → (3) sipariş ver, durumunu `submitted→served→paid` ilerlet →
(4) dashboard'da grafikleri göster (banner "snapshot" der) → (5) `test-concurrency.js`'i çalıştırıp
overbooking'in engellendiğini kanıtla (bu, sunumun en güçlü anı).

---

## 12. Bilinen sınırlar (dürüstçe söyle — güçlü görünürsün)
- Analitik dashboard Pages'te **sabit snapshot**tır (canlı backend'de gerçek zamanlı).
- Hava ve haritadaki İSPARK doluluğu **demo** (deterministik, etiketli).
- Sürüş rotası **dış API'ye (OSRM) bağlıdır**; çevrimdışıyken düz-çizgi tahminine düşer.
- Harita karoları CDN gerektirir; çevrimdışıyken sade gri arka plan + uyarı gösterir.
- Backend'in gerçek per-tesis İSPARK'ı (atomik take/release) henüz UI'da yüzeye çıkmıyor
  (bağlanabilir — olası bir sonraki adım).

> Kapanış cümlesi: *"Neyin gerçek, neyin demo olduğunu biliyorum ve ayırıyorum. Çekirdek iş kuralları
> (kapasite, kimlik, tutarlılık) gerçek ve testli; demolar ise dürüstçe etiketli."*
