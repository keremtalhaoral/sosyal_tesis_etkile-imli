# Proje Anlatım Rehberi

> Bu belge, projeyi **bugünkü hâliyle** mentöre/juriye anlatabilmen için yazıldı. Amaç ezber değil:
> **her ekranın arkasında ne olduğunu, hangi kararı neden verdiğini ve neyin gerçek/neyin demo
> olduğunu** dürüstçe açıklayabilmek.
>
> Önceden üç ayrı rehber vardı (proje anlatımı, veritabanı anlatımı, staj sunumu); büyük ölçüde
> çakışıyor ve koddan ayrışıyorlardı. Tek belgede birleştirildiler.
>
> Derin gerekçeler için `docs/adr/` (ADR-001…009), veri mimarisi için `DATABASE.md`,
> dosya-dosya katalog için `docs/teknoloji-ve-dosya-rehberi.md`, çalıştırılabilir SQL için
> `queries.sql` + `docs/sorgu-defteri.md`.

---

## 0. Bir cümlede proje

İstanbul sosyal tesisleri için **etkileşimli Web GIS + karar destek** uygulaması: haritada tesisler,
rezervasyon + sipariş, İSPARK/otopark, toplu taşıma güzergahları ve analitik dashboard.

**Mimari (tek cümle):** **PostgreSQL 16 + PostGIS 3.4** tek gerçek kaynaktır; onu bir
**Node/Express backend** (port 8085) yönetir; **`docs/` statik frontend** (GitHub Pages) hem canlı
backend'e bağlanabilir hem de backend yokken çevrimdışı replika ile çalışır.

---

## 1. Mimari — büyük resim

```
   data/seed.json                    docs/data/istanbul-districts.geojson
   (KANONİK veri, git'te)            (ilçe geometrisi, git'te)
          │ npm start                        │ npm run db:load-geo
          ▼                                  ▼
   ═══════════ PostgreSQL 16 + PostGIS ═══════════  TEK GERÇEK KAYNAK
                        ▲
          backend/ (Node/Express + pg) ──► API :8085
                        │ türetilir (export-analytics / build-transit)
                        ▼
   docs/ (GitHub Pages, statik) ──► localStorage + JSON snapshot (çevrimdışı replika)
```

**Anlatım:** *"Kanonik veri ile türetilmiş veriyi ayırıyorum. `seed.json` insan-okur kanonik kaynak;
veritabanı ondan kurulur; Pages'teki snapshot'lar da veritabanından türetilir. Tek gerçek kaynak
(single source of truth) ilkesi — DDIA Bölüm 11."*

**Backend dosyaları:**
- `database.js` — havuz, **versiyonlu migration** zinciri (v1–v8), seed, `transaction()`, parola hash.
- `db.js` — repository + **PostGIS mekansal sorgular**. *İş katmanı.*
- `analytics.js` — canlı analitik sorgular + `daily_stats` rollup.
- `geo.js` — ilçe geometrisini GeoJSON'dan PostGIS'e yükler.
- `security.js` — JWT + HMAC imza. `validate.js` — girdi doğrulama.
- `server.js` — API router (port 8085) + hava durumu servisi.
- `test-helper.js` — her teste izole PostgreSQL şeması.

---

## 2. 🏆 En güçlü kartın: write-skew ve izolasyon seçimi

Bu, projenin **en savunulabilir ve en etkileyici** parçası. PostgreSQL'e geçişten sonra daha da
güçlendi, çünkü artık **yanlış yolu da çalıştırıp gösterebiliyorsun.**

**Sorun:** Aynı (tesis, tarih, slot) için son boş yerleri iki kişi aynı anda kapamaya çalışırsa,
"önce oku, sonra yaz" kodu **overbooking** yapar. DDIA'da buna **write skew** denir (Böl. 7.2.3).
Kimse kimsenin satırını ezmez (lost update yok), ama iki işlem BİRLİKTE bir invariant'ı kırar.
Çakışma **henüz var olmayan** satırlar üzerinde olduğu için (phantom) satır kilidi de çözmez.

**Çözüm (`backend/db.js` → `createReservation`):** oku + kontrol + yaz tek transaction, ve o
transaction **SERIALIZABLE** (PostgreSQL'de SSI). Çakışmayı veritabanı tespit edip `40001` ile geri
çevirir; `transaction()` jitter'lı geri çekilmeyle yeniden dener.

```js
transaction(async (tx) => {                     // varsayılan: SERIALIZABLE
  const { booked } = await tx.one(`
    SELECT COALESCE(SUM(guests),0)::int AS booked FROM reservations
    WHERE facility_id=$1 AND reserve_date=$2::date AND reserve_time=$3::time
      AND status <> 'cancelled'`, [facilityId, reserveDate, reserveTime]);
  if (booked + guests > facility.capacity) throw 409;   // slot dolu
  await tx.one('INSERT INTO reservations (...) VALUES (...) RETURNING id', [...]);
});
```

**Kanıt — `npm test` içinde ölçülüyor** (40 paralel worker, kapasite 10):

| Yol | Sonuç |
|---|---|
| READ COMMITTED (aynı kod, düşük izolasyon) | **18–22 rezervasyon** → overbook |
| Transaction dışı oku-sonra-yaz | **18–26 rezervasyon** → overbook |
| **SERIALIZABLE + retry (üretimdeki yol)** | **tam 10** → doğru |

> **"İki kişi aynı anda son yeri alırsa?"**
> *"Rezervasyonun okuma-kontrol-yazma dizisi tek transaction'da ve o transaction SERIALIZABLE.
> PostgreSQL çakışan iki işlemden birini 40001 ile geri çeviriyor, ben de sınırlı sayıda yeniden
> deniyorum. Bunu 40 paralel worker'la ölçtüm: READ COMMITTED'da 12–22 rezervasyon geçiyor,
> SERIALIZABLE'da tam kapasite kadar."*

> **"SQLite'ta da bu sorun var mıydı?"** — Sunumun en iyi cevaplarından biri:
> *"Hayır, ama sebebi bizim kodumuz değildi: SQLite `BEGIN IMMEDIATE` ile tüm yazıcıları
> serileştiriyordu. Yani doğruluğu veritabanının eşzamanlılık YETENEKSİZLİĞİNDEN alıyorduk.
> PostgreSQL çok yazıcılı olduğu için koruma artık açıkça seçilmek zorunda. Geçişin bana
> öğrettiği en önemli şey buydu."* (ADR-009)

**İstisna — her şey SERIALIZABLE olmak zorunda değil:**
- İSPARK yer kapma (`UPDATE ... WHERE occupied < capacity`) tek satır çakışmasıdır; satır kilidi yeter.
- Rollup yeniden inşası **REPEATABLE READ** kullanır: tutarlı tek snapshot yeter, SERIALIZABLE
  altında her eşzamanlı rezervasyonla çakışıp boşuna yeniden denerdi.

---

## 3. PostGIS: mekansal işler veritabanında (ADR-009)

Proje bir **Web GIS** projesi, ama mekansal işlerin hiçbiri veritabanında değildi: point-in-polygon
JS'te ray-casting ile, mesafe elle Haversine ile hesaplanıyor, 3.7 MB'lık ilçe geometrisi her
açılışta belleğe okunuyordu. Hepsi SQL'e taşındı:

| Önce (JS) | Sonra (SQL) |
|---|---|
| ray-casting `pointInPolygon` | `ST_Contains(d.geom, f.geom)` — GiST indeksli |
| Haversine `calculateGeodesicDistance` | `ST_Distance(geom::geography, ...)` — metre |
| tüm tesisleri map+sort ile KNN | `ORDER BY geom <-> point` — indeksten |
| 3.7 MB GeoJSON bellekte | `districts.geom geometry(MultiPolygon,4326)` |

`facilities.geom` **generated** kolondur (`ST_SetSRID(ST_MakePoint(lng,lat),4326)` STORED): elle
yazılamaz, dolayısıyla nokta ile lat/lng **asla ayrışamaz**.

> **Anlatması güzel bir ayrıntı:** `geometry <-> ` operatörü DERECE cinsinden düzlemsel mesafe ölçer.
> 41°N'de bir boylam derecesi bir enlem derecesinden ~%25 kısa; bu yüzden derece sıralaması metre
> sıralamasıyla uyuşmuyordu — ilk denemede 2302 m'lik tesis 2308 m'likten SONRA listelendi.
> `::geography` kullanan ayrı bir GiST indeksi eklendi. *"Doğru cevabı almak için indeksin hangi
> uzayda ölçtüğünü bilmek gerekiyor."*

Canlı gösterebileceğin sorgular `queries.sql` bölüm 2'de (KNN, ST_Contains join, ST_DWithin komşuluk).

---

## 4. Kimlik & Kripto (ADR-002)

- **Parola:** `PBKDF2-HMAC-SHA256`, **600.000 iterasyon** (OWASP 2023), **kullanıcı başına rastgele
  salt**, **PHC formatında**: `pbkdf2_sha256$600000$<salt>$<hash>`.
- **Oturum:** `JWT HS256` (`iat`/`exp`), doğrulama **sabit-zamanlı** (`crypto.timingSafeEqual`).
- **Bütünlük:** her rezervasyon/sipariş `HMAC-SHA256` ile imzalanır.
- **Sırlar** env'den; ham parolalar git'e girmez (`data/dev-credentials.json`, gitignored).

> **Anlatması en güçlü hata düzeltmesi:** Kod, kullanıcı bulunamadığında sahte bir hash doğruluyordu
> ki "kullanıcı yok" ile "parola yanlış" aynı sürede dönsün. Ama sahte hash **1 iterasyonluydu**,
> gerçekler 600.000. Ölçtüm: "kullanıcı yok" yanıtı **402× daha hızlı** dönüyordu — yani kod,
> engellemeye çalıştığı **kullanıcı adı sızıntısını bizzat üretiyordu.** Sahte hash artık iterasyon
> sayısını gerçek ayardan alıyor; oran 1.02×. `test-auth.js` bunu ölçüyor.

> **Bonus:** 600k iterasyonlu PBKDF2 senkron çalışıyordu ve Node tek thread'li olduğu için her login
> TÜM API'yi ~100 ms donduruyordu. Async sürüme geçildi: 6 eşzamanlı login altında basit bir GET'in
> gecikmesi ~600 ms'den **14 ms**'ye düştü.

---

## 5. Para = tam sayı kuruş, asla float (ADR-001)

Tüm tutarlar `*_minor` (kuruş, integer). 45,00 TL = `4500`. Tutarlar **sunucuda** hesaplanır.

> **Anlatması güzel tuzak:** Kuruş cinsinden tutmak float sorununu çözüyor ama yenisini getiriyor:
> `int4` üst sınırı 2.147.483.647 kuruş = **yalnız ~21,5 milyon TL**. Bir yıllık üretilmiş veri bile
> bunu aşıyor ve PostgreSQL sessizce yanlış sonuç vermek yerine `22003` fırlatıp dashboard'ı tamamen
> çökertiyordu. Tüm para toplamları `::bigint`. *"Doğru tipi seçmek yetmiyor, toplamın tipini de
> düşünmek gerekiyor."*

---

## 6. Sipariş: rezervasyona bağlı + fiyat snapshot + durum makinesi (ADR-005/007)

- Sipariş bir **rezervasyona bağlıdır**; sahiplik zorlanır (başkasının siparişine 403).
- Sipariş kalemi fiyatı **snapshot**'tır: menü fiyatı sonra değişse bile geçmiş sipariş değişmez
  (*captured vs derived*).
- **Durum makinesi:** `submitted → served → paid` (+`cancelled`). Sıçrama **yasak**.
- Toplam **sunucuda** hesaplanır ve **imzalanır**.

> **Düzeltilen iki hata (ikisi de anlatmaya değer):**
> 1. **İptal parayı geri almıyordu.** Sipariş tutarı `reservations.amount_minor`'a ekleniyor ama
>    iptalde geri alınmıyordu; tüm ciro raporlaması bu kolonu okuduğu için iptal edilen sipariş
>    **sonsuza dek ciro sayılıyordu.** Geri alma artık durum değişikliğiyle aynı transaction'da.
> 2. **İmza tutarı kapsamıyordu.** `signOrder(userId, resvId, totalMinor, items)` çağrılırken tutar
>    henüz hesaplanmadığı için sabit `0` geçiliyordu. Yani imza tutar değişse bile aynı kalıyordu —
>    bütünlük kontrolü tamamen işlevsizdi. İmza artık toplam bilindikten sonra üretiliyor.

---

## 7. Analitik: canlı sorgu + rollup (ADR-004)

Dashboard'ın 8 grafiği **gerçek SQL agregasyonlarından** gelir.

- **OLTP vs OLAP (DDIA Böl. 3):** yazma çok/küçük, analitik okuma az/ağır. `daily_stats` rollup
  tablosu (gün×tesis özeti) ağır agregasyonu hızlandırır.
- Rollup **türetilmiş veridir**; `rebuildDailyStats()` kaynaktan yeniden kurar. Canlı sonuç ile
  rollup sonucunun **birebir aynı** olduğu `test-analytics.js`'te doğrulanır (parity).

> **"Rollup neden var?"** → *"Aynı cevabı iki büyüklük mertebesi hızlı veriyor. Ama türetilmiş; her an
> kaynaktan yeniden üretilebilir, o yüzden tutarlılığı testle garanti ediyorum."*

---

## 8. Doluluk: türetilmiş olmak zorunda (ADR-009)

`facilities` tablosunda `occupancy` diye bir kolon vardı ve harita bunu "doluluk oranı" diye
gösteriyordu. Ama o kolon **yalnız seed'den ve adminin elle girdiği PATCH'ten** değişiyordu —
`createReservation` ona hiç dokunmuyordu. Yani **bir yıllık 400 bin rezervasyon üretsen bile harita
aynı sabit sayıyı gösteriyordu.**

Düzeltme iki adımlı ve ikisi de anlatmaya değer:
1. **Kolonu olduğu şey gibi adlandır** (migration v7): `occupancy` → `manual_occupancy`. Yanlış isim,
   yanlış zihinsel modeli besliyordu.
2. **Gerçek doluluğu türet:** o günün iptal edilmemiş rezervasyonlarının koltuk toplamı / kapasite,
   LATERAL alt sorguyla. API artık ikisini de döndürüyor — panelde "elle işaretlenen" ile "gerçekte
   olan" karşılaştırılabiliyor.

> *"DDIA Bölüm 11'in dersi: türetilebilen bir veriyi elle saklamak, er ya da geç kaynakla ayrışır.
> Doluluk rezervasyonların bir fonksiyonu; öyleyse rezervasyonlardan hesaplanmalı."*

---

## 9. Denetim & yönetim (ADR-007)

- `audit_log` **append-only** (yalnız INSERT), mutasyonla **aynı transaction** içinde yazılır.
- `detail` kolonu artık **JSONB**: audit log sorgulanabilir → `WHERE detail->>'kod' = 'ADM-01'`.
- Admin gözetim uçları (`/api/admin/*`) sahiplik filtresiz tüm kayıtları görür, `requireAdmin` korur.

---

## 10. Harita, rotalar ve toplu taşıma (ADR-006 + ADR-008)

**Toplu taşıma güzergahları üç kaynaktan gelir**, öncelik sırasıyla:

| Kaynak | Ne verir | Güven |
|---|---|---|
| `iett-soap` (HatDurakGuzergah) | gerçek durak dizisi | **exact** |
| `ibb-gtfs` (GTFS shapes) | geometrik eşleme | kalite kapısını geçenler |
| `metro-istanbul` (GetStations) | istasyon noktaları | **approximate** |

> **Dürüstlük kuralı — sunumda mutlaka söyle:** Metro İstanbul uçları istasyon NOKTASI verir, ray
> geometrisi vermez. İstasyonları birleştiren çizgi gerçek güzergah değildir. Veriyi atmak da yanlış
> olurdu, o yüzden karar: **çiz ama gerçekmiş gibi sunma.** Metro hatları haritada **kesikli** çizilir,
> tooltip "⚠ yaklaşık çizim" der, lejant kaynağı gösterir. *"Uydurmayı gerçek gibi sunmamak, bu
> projedeki en tutarlı ilkem."*

**Sürüş rotası:** OSRM gerçek yol geometrisini çizer + mesafe/süre gösterir; çevrimdışıysa
düz-çizgi + Haversine tahmini yedeğine düşer (etiketli).

---

## 11. Çift-mod frontend

`docs/` statik bir sitedir (Pages'te backend yoktur). Üç davranış:
1. **`dashboard.html` / `order.html`** — **gerçek çift mod:** önce canlı API, erişilemezse
   `localStorage` + `seed.json` + JSON snapshot.
2. **`index.html` (ana harita + admin)** — **artık o da çift mod:** açılışta backend yoklanır.
   Erişilebiliyorsa her çağrı gerçek backend'e gider (yaptığınız her işlem PostgreSQL'e yazılır);
   erişilemiyorsa `docs/app.js`'teki `window.fetch` override'ı devreye girer. Sol altta hangi modda
   olduğunuzu gösteren rozet var.

   > **Dürüst düzeltme:** Bu sayfa eskiden HER ZAMAN mock'tu ve belgede gerekçesi "statik siteye
   > gerçek parola hash'i gönderilmez" diye yazıyordu. Bu **yanlıştı** — `/api/auth/login` zaten
   > hash göndermiyor, yalnız token ve `{id, username, role}` dönüyor. Gerçek sebep basitçe
   > GitHub Pages'in sunucu çalıştıramaması. Yanlış gerekçe, olmayan bir güvenlik kaygısını
   > tasarım kararı gibi gösteriyordu; üstelik "uygulamada işlem yap, DBeaver'da gör" demosunu
   > imkansız kılıyordu.
3. **Yerelde canlı:** `npm start` sonra `docs/`'u açarsan gerçek backend'e bağlanır.

---

## 12. ⭐ NE GERÇEK, NE DEMO? (dürüstlük tablosu — en önemli bölüm)

Mentör "bu veri gerçek mi?" diye sorarsa **dürüst ve net** ol.

| Ekran / özellik | Durum | Açıklama |
|---|---|---|
| Rezervasyon, sipariş, kapasite, kullanıcılar | **GERÇEK** | Canlı backend + PostgreSQL; SERIALIZABLE transaction'lar. |
| Tesis doluluk oranı | **GERÇEK (türetilmiş)** | O günün rezervasyonlarından hesaplanır; elle girilen işaret ayrı alanda. |
| Auth (parola hash, JWT, imza) | **GERÇEK** | PBKDF2 600k + per-user salt, HS256, sabit-zamanlı doğrulama. |
| Mekansal analiz (ilçe, KNN, mesafe) | **GERÇEK** | PostGIS `ST_Contains` / `ST_Distance` / `<->`, GiST indeksli. |
| İlçe sınırları + nüfus | **GERÇEK** | Resmi GeoJSON + demografi; alarm eşikleri projenin kendi politikası. |
| Analitik dashboard grafikleri | **GERÇEK ama snapshot** | Veri gerçek SQL'den; Pages'te backend olmadığı için sabit `analytics.json`. Banner tarih gösterir. |
| Toplu taşıma güzergahları | **GERÇEK (türetilmiş)** — metro hariç | GTFS/İETT'ten gerçek geometri. **Metro/tramvay yaklaşık** (istasyon zinciri), kesikli çizilir. |
| Sürüş rotası + mesafe/süre (OSRM) | **GERÇEK (canlı, dış API)** | Çevrimdışıysa düz-çizgi tahminine düşer (etiketli). |
| Hava durumu | **DEMO (deterministik)** | Anahtar yoksa koordinata göre sabit üretilir (rastgele değil). Anahtar varsa gerçek OpenWeather. |
| Haritadaki İSPARK otopark doluluğu | **DEMO (deterministik)** | Ayrı hardcoded liste (15 kamu otoparkı). Sahte "canlı feed" iddiası yok. |
| (Backend) her tesisin kendi İSPARK'ı | **GERÇEK** | `ispark_status` tohumlu; atomik take/release (ADR-003). UI'da henüz yüzeye çıkmıyor. |

> **"Hava/İSPARK gerçek mi?"** → *"Hayır, onlar bilinçli demo — gerçek bir İBB feed'im yok. Ama
> uydurma-rastgele değil, deterministik: aynı yerde hep aynı değer, ve ekranda 'demo' olarak dürüstçe
> etiketli."*

---

## 13. Canlı demo: mentörün önünde çalıştırabileceğin sorgular

`queries.sql` dosyasının tamamı PostgreSQL'e karşı hatasız koşar (bu, `npm run check` benzeri bir
disiplinle doğrulandı). En etkileyici üçü:

```sql
-- 1) KNN: Taksim'e en yakın 3 tesis - indeksten, metre cinsinden
SELECT kod, ad,
       ROUND((ST_Distance(geom::geography,
              ST_SetSRID(ST_MakePoint(28.9850, 41.0369), 4326)::geography) / 1000)::numeric, 2) AS km
FROM facilities
ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint(28.9850, 41.0369), 4326)::geography
LIMIT 3;

-- 2) Mekansal join: hangi ilçede kaç tesis var, 100 bin kişi başına?
SELECT d.name AS ilce, COUNT(f.id) AS tesis,
       ROUND(COUNT(f.id) * 100000.0 / d.population, 2) AS tesis_100k
FROM districts d LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
WHERE d.geom IS NOT NULL
GROUP BY d.id, d.name, d.population ORDER BY tesis_100k ASC LIMIT 10;

-- 3) İndeks kanıtı: "Index Scan using idx_reservations_slot" görmeli
EXPLAIN (ANALYZE, BUFFERS)
SELECT SUM(guests) FROM reservations
WHERE facility_id = 1 AND reserve_date = '2026-06-01' AND reserve_time = '19:00';
```

---

## 14. Çalıştırma & demo senaryosu

```bash
npm install
npm run db:up            # PostgreSQL + PostGIS (docker compose)
npm start                # migration + seed otomatik -> http://localhost:8085
npm run db:load-geo      # ilçe sınırlarını PostGIS'e yükle (bir kez)

npm test                 # 213 test; hepsi yeşil olmalı
npm run check            # belge ↔ kod tutarlılığı

cd docs && python3 -m http.server 8092    # arayüz: http://localhost:8092
```

**Önerilen demo akışı:**
1. Haritadan tesis seç → menü + hava + İSPARK + gerçek güzergah görünsün.
2. Giriş yap, rezervasyon oluştur (imza görünür).
3. Sipariş ver, durumunu `submitted → served → paid` ilerlet.
4. Dashboard'da grafikleri göster (banner "snapshot" der).
5. **Kapanış — sunumun en güçlü anı:** `node backend/test-concurrency.js` çalıştır. READ COMMITTED'ın
   overbook ettiğini, SERIALIZABLE'ın tam kapasitede durduğunu ekranda yan yana göster.

---

## 15. Bilinen sınırlar (dürüstçe söyle — güçlü görünürsün)

- Analitik dashboard Pages'te **sabit snapshot**tır (canlı backend'de gerçek zamanlı).
- Hava ve haritadaki İSPARK doluluğu **demo** (deterministik, etiketli).
- **Metro/tramvay güzergahları yaklaşık** (istasyon zinciri); gerçek ray geometrisi için farklı bir
  kaynak gerekir.
- **Vapur hatları kaynaksız** — Şehir Hatları ayrı bir kurum, açık veri ucu entegre edilmedi.
- Toplu taşıma verisi **anlık değil**, çekim zamanının fotoğrafı (çevrimdışı çalışabilmenin bedeli).
- **Canlı otobüs konumu yok:** İBB `SeferGerceklesme` ucu bilinçli olarak reddedildi — sunucusuz
  Pages mimarisiyle çelişiyor (ADR-008).
- Sürüş rotası **dış API'ye (OSRM) bağlıdır**; çevrimdışıyken düz-çizgi tahminine düşer.
- Backend'in per-tesis İSPARK'ı henüz UI'da yüzeye çıkmıyor.

> **Kapanış cümlesi:** *"Neyin gerçek, neyin demo olduğunu biliyorum ve ayırıyorum. Çekirdek iş
> kuralları — kapasite, kimlik, tutarlılık, mekansal analiz — gerçek ve testli; demolar ise dürüstçe
> etiketli. En çok da şunu öğrendim: bir garantiyi 'çalışıyor' diye kabul etmek yetmiyor, onu
> kıracak koşulu kurup ölçmek gerekiyor."*

---

## 16. Mentörün muhtemel soruları — hızlı cevap anahtarı

| Soru | Kısa cevap |
|---|---|
| Neden PostgreSQL? | Web GIS için mekansal sorgu birinci sınıf ihtiyaç (PostGIS) + gerçek çok-yazıcılı eşzamanlılık. Bedeli: `pg` bağımlılığı ve çalışan sunucu (ADR-009). |
| Neden SQLite ile başladın? | Tek düğüm, sıfır kurulum, hızlı iterasyon. Doğru başlangıçtı; iki iddia karşılıksız kalınca geçtim. |
| Overbooking'i nasıl engelliyorsun? | SERIALIZABLE + 40001 retry. READ COMMITTED'ın overbook ettiğini testle gösteriyorum. |
| Parolaları nasıl saklıyorsun? | PBKDF2 600k, per-user salt, PHC formatı. Düz metin asla. |
| Para neden float değil? | Yuvarlama hataları birikir. Kuruş cinsinden integer; toplamlarda `bigint` (int4 ~21,5M TL'de taşıyor). |
| Menü fiyatı değişince eski siparişler? | Değişmez — fiyat sipariş anında kaleme snapshot'lanır. |
| Rollup neden var? | Ağır agregasyonu hızlandırır; türetilmiş olduğu için kaynaktan yeniden kurulabilir, parity testi var. |
| Pages'te backend yoksa nasıl çalışıyor? | Çift mod: canlıysa API, değilse aynı şekle sahip çevrimdışı replika. Ana harita güvenlik gereği hep mock. |
| Haritadaki metro çizgisi gerçek mi? | Hayır, istasyon noktalarından çizilmiş yaklaşık hat — kesikli çiziliyor ve öyle etiketli. |
| Veri gerçek mi? | Bölüm 12'deki tabloyu göster. |
