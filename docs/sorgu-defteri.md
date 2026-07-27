# Sorgu Defteri — Projenin Her Özelliğini SQL ile Gösterme Rehberi

Bu defter, projenin **her özelliğini** çalıştırılabilir SQL sorgularıyla gösterir. Amaç: DBeaver'da
(veya `psql -d mufettis` ile) tek tek çalıştırıp mentöre "şu özellik şu sorguyla şunu yapıyor"
diyebilmen. Her başlıkta **Amaç → SQL → Ne gösterir** (gerekirse **Örnek çıktı** ve **PostGIS karşılığı**).

- Aynı sorguların **çıplak/çalıştırılabilir** hâli → repo kökündeki [`queries.sql`](../queries.sql)
  (DBeaver'da aç, tek tek veya toplu çalıştır).
- Şema referansı → [`schema.sql`](../schema.sql). Kararların gerekçesi → `docs/adr/`.
- Para her yerde **tam sayı kuruş** (`*_minor`); TL için `/100.0`. (ADR-001)

> **Örnek çıktılar** aşağıda `scripts/generate-data.js --reset --scale=3` ile üretilmiş
> **~642.000 rezervasyon** üzerinde alınmıştır; senin ürettiğin sayılar rastgeleliğe göre değişir.

---

## 0. Önce veri havuzunu hazırla (kapasiteyi görmek için)

`facilities`, `districts`, `menu_items`, `ispark_status` seed'den **dolu** gelir; ama
`reservations`/`orders` **boş başlar** — bu yüzden analitik sorguların sonuç dönmesi için veri üret:

```bash
# Taban (~1 yıl):
node scripts/generate-data.js --reset
# Büyük veri (~3 yıl → yüz binlerce satır; kapasite/benchmark için):
node scripts/generate-data.js --reset --scale=3
# Devasa (~10 yıl → milyonlarca satır):
node scripts/generate-data.js --reset --scale=10
```

Üretilen kayıtlar **geçerlidir**: per-slot kapasite asla aşılmaz (ADR-003). `--scale=3` bende
**642.424 rezervasyon, 353.882 sipariş, 884.449 kalem** üretti (~47 sn).

---

## 1. Temel keşif

**1.1 — Veri hacmi (tüm tabloların satır sayısı):**
```sql
SELECT 'facilities'   AS tablo, COUNT(*) AS satir FROM facilities
UNION ALL SELECT 'districts',     COUNT(*) FROM districts
UNION ALL SELECT 'menu_items',    COUNT(*) FROM menu_items
UNION ALL SELECT 'users',         COUNT(*) FROM users
UNION ALL SELECT 'reservations',  COUNT(*) FROM reservations
UNION ALL SELECT 'orders',        COUNT(*) FROM orders
UNION ALL SELECT 'order_items',   COUNT(*) FROM order_items
UNION ALL SELECT 'ispark_status', COUNT(*) FROM ispark_status
UNION ALL SELECT 'daily_stats',   COUNT(*) FROM daily_stats
UNION ALL SELECT 'audit_log',     COUNT(*) FROM audit_log;
```
*Ne gösterir:* verinin nerede ne kadar durduğu — "kapasiteyi" tek bakışta.

**1.2 — Tesis listesi (kapasite + doluluk):**
```sql
SELECT kod, ad, capacity AS kapasite, occupancy AS doluluk_yuzde, lat, lng
FROM facilities ORDER BY capacity DESC;
```

---

## 2. Mekansal analiz / CBS (GIS)

SQLite'ta PostGIS yok; ama matematik fonksiyonları (`sin/cos/radians/acos`) var, o yüzden
**Haversine** (büyük daire mesafesi) sorgularını **saf SQL** ile yazabiliyoruz — `backend/db.js`'teki
JS Haversine'in birebir SQL karşılığı. İlçe **poligonları** GeoJSON'da yaşadığı için gerçek
nokta-poligon join'i uygulama katmanında (ray-casting) yapılır; PostGIS karşılıkları aşağıda.

**2.1 — En yakın 3 tesis (KNN / proximity), Taksim'den (41.0369, 28.9850):**
```sql
SELECT kod, ad,
  ROUND(6371 * acos(MIN(1,
    cos(radians(41.0369)) * cos(radians(lat)) * cos(radians(lng) - radians(28.9850)) +
    sin(radians(41.0369)) * sin(radians(lat))
  )), 2) AS km
FROM facilities
ORDER BY km ASC
LIMIT 3;
```
*Örnek çıktı:* Cihangir (0.96 km), Kasımpaşa (1.71 km), Haliç (2.53 km).
*Ne gösterir:* mesafe-bazlı en yakın komşu analizi. `MIN(1, ...)` kayan nokta taşmasına karşı
`acos` argümanını kelepçeler.
*PostGIS karşılığı:*
```sql
-- SELECT kod, ad FROM facilities
-- ORDER BY geom <-> ST_MakePoint(28.9850, 41.0369)::geography LIMIT 3;
```

**2.2 — İki tesis arası mesafe:**
```sql
SELECT a.ad AS tesis_a, b.ad AS tesis_b,
  ROUND(6371 * acos(MIN(1,
    cos(radians(a.lat))*cos(radians(b.lat))*cos(radians(b.lng)-radians(a.lng)) +
    sin(radians(a.lat))*sin(radians(b.lat))
  )), 2) AS km
FROM facilities a JOIN facilities b ON b.id > a.id
WHERE a.kod = 'ALTY-01' AND b.kod = 'ALTY-08';
```

**2.3 — Bir kutu (bounding box) içindeki tesisler (Avrupa yakası kabaca):**
```sql
SELECT kod, ad, lat, lng FROM facilities
WHERE lat BETWEEN 41.00 AND 41.20 AND lng BETWEEN 28.90 AND 29.00
ORDER BY lat DESC;
```
*PostGIS karşılığı:* `WHERE geom && ST_MakeEnvelope(28.90,41.00,29.00,41.20,4326)`.

---

## 3. Demografi / karar destek

**3.1 — İlçe nüfus sıralaması (TÜİK 2023):**
```sql
SELECT name AS ilce, population AS nufus FROM districts ORDER BY population DESC LIMIT 10;
```
*Örnek çıktı:* Esenyurt 978.923, Küçükçekmece 792.030, Pendik 741.895 …

**3.2 — Nüfus istatistikleri (karar destek girdisi):**
```sql
SELECT COUNT(*) ilce_sayisi, SUM(population) toplam_nufus,
       ROUND(AVG(population)) ort_nufus, MAX(population) en_kalabalik
FROM districts;
```
*PostGIS karşılığı (choropleth / spatial join — ilçe başına tesis sayısı):*
```sql
-- SELECT d.name, COUNT(f.id) tesis FROM districts d
-- LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom) GROUP BY d.id;
-- (Bu projede poligonlar GeoJSON'da; join uygulama katmanında ray-casting ile yapılır.)
```

---

## 4. Rezervasyon & kapasite (ADR-003)

**4.1 — Belirli bir slotun doluluğu (write-skew'in kalbi):**
```sql
SELECT COALESCE(SUM(guests), 0) AS dolu_koltuk
FROM reservations
WHERE facility_id = 1 AND reserve_date = '2026-06-01' AND reserve_time = '19:00'
  AND status != 'cancelled';
```
*Ne gösterir:* Kapasite kontrolü bu toplama dayanır. Yeni rezervasyon `dolu_koltuk + guests <=
capacity` ise kabul edilir — ve bu okuma+yazma **tek atomik transaction** içinde olur (yoksa iki
eşzamanlı rezervasyon aynı boşluğu görüp kapasiteyi aşar = write-skew). `idx_reservations_slot`
indeksi bu sorguyu noktasal yapar (bkz. §10).

**4.2 — Bir günün tüm slot doluluk tablosu (tek tesis):**
```sql
SELECT reserve_time AS slot, SUM(guests) AS misafir, COUNT(*) AS rezervasyon
FROM reservations
WHERE facility_id = 1 AND reserve_date = '2026-06-01' AND status != 'cancelled'
GROUP BY reserve_time ORDER BY slot;
```

**4.3 — Doluluk ısı haritası (haftanın günü × slot):**
```sql
SELECT EXTRACT(DOW FROM reserve_date)::int AS gun_0paz,
       reserve_time AS slot, SUM(guests) AS misafir
FROM reservations WHERE status != 'cancelled'
GROUP BY gun_0paz, slot ORDER BY misafir DESC;
```
*Örnek çıktı:* en yoğun → Cumartesi/Pazar 13:00 ve 19:00–20:30 (hafta sonu + öğle/akşam).

---

## 5. Sipariş & fiyat snapshot (ADR-001 / ADR-005)

**5.1 — Sipariş toplamı = kalemlerin snapshot fiyatı (captured, derived değil):**
```sql
SELECT o.id AS siparis, o.total_minor AS kayitli_toplam,
       SUM(oi.quantity * oi.unit_price_minor) AS kalemlerden_toplam
FROM orders o JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id HAVING kayitli_toplam <> kalemlerden_toplam
LIMIT 5;
```
*Ne gösterir:* Sonuç **boş** olmalı → kayıtlı toplam her zaman kalem snapshot'larının toplamına eşit.
Tutar sipariş anında yakalanır (captured), sonradan menü fiyatından türetilmez.

**5.2 — Snapshot ≠ güncel menü fiyatı (immutability kanıtı):**
```sql
SELECT oi.id, m.name, oi.unit_price_minor AS siparis_ani_fiyat,
       m.price_minor AS guncel_menu_fiyat
FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
WHERE oi.unit_price_minor <> m.price_minor
LIMIT 5;
```
*Ne gösterir:* Menü fiyatı **sonradan** değişse bile eski siparişin kalem fiyatı sabit kalır. Üretilen
veride fiyat değişmediği için boş döner; farkı görmek için (güvenli, geri alınan demo):
```sql
BEGIN;
UPDATE menu_items SET price_minor = price_minor + 500 WHERE id = 1;
SELECT oi.unit_price_minor AS eski, m.price_minor AS yeni
FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
WHERE oi.menu_item_id = 1 LIMIT 3;   -- eski < yeni: snapshot değişmedi
ROLLBACK;   -- demoyu geri al
```

**5.3 — Sipariş durum makinesi dağılımı (`submitted→served→paid`):**
```sql
SELECT status AS durum, COUNT(*) AS adet FROM orders GROUP BY status ORDER BY adet DESC;
```
*Not:* Jeneratör siparişleri doğrudan `paid` yazar; canlı uygulamada durumlar
`submitted → served → paid` olarak ilerler (sıçrama yasak, whitelist state machine — ADR-007).

**5.4 — En çok satan menü kalemleri:**
```sql
SELECT m.name, m.category, SUM(oi.quantity) AS adet,
       ROUND(SUM(oi.quantity * oi.unit_price_minor)/100.0, 2) AS ciro_TL
FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
GROUP BY m.id ORDER BY adet DESC LIMIT 10;
```

**5.5 — Kategori bazında satış:**
```sql
SELECT m.category, SUM(oi.quantity) AS adet,
       ROUND(SUM(oi.quantity * oi.unit_price_minor)/100.0, 2) AS ciro_TL
FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
GROUP BY m.category ORDER BY ciro_TL DESC;
```
*Örnek çıktı:* Ana Yemek ~518K TL, Kahvaltı ~469K TL, Tatlı ~265K TL …

---

## 6. Analitik (ADR-004) — `analytics.js` ile birebir

**6.1 — KPI özeti (iptaller hariç):**
```sql
SELECT COUNT(*) AS rezervasyon,
       ROUND(SUM(amount_minor)/100.0, 2) AS ciro_TL,
       ROUND(AVG(guests), 2) AS ort_grup,
       SUM(highchair_count) AS mama_sandalyesi
FROM reservations WHERE status != 'cancelled';
```
*Örnek çıktı:* 591.022 rezervasyon, ~1.606.268 TL ciro, ortalama grup 3.5.

**6.2 — Aylık ciro zaman serisi:**
```sql
SELECT to_char(reserve_date, 'YYYY-MM') AS ay,
       ROUND(SUM(amount_minor)/100.0, 2) AS ciro_TL, COUNT(*) AS rez
FROM reservations WHERE status != 'cancelled'
GROUP BY ay ORDER BY ay DESC;
```
*(Granülerlik: gün = `reserve_date`, hafta = `to_char(reserve_date, 'IYYY-"W"IW')`, yıl =
`to_char(reserve_date, 'YYYY')`.)*

**6.3 — Ödeme tipi kırılımı:**
```sql
SELECT COALESCE(payment_type, 'bilinmiyor') AS odeme, COUNT(*) AS rez,
       ROUND(SUM(amount_minor)/100.0, 2) AS ciro_TL
FROM reservations WHERE status != 'cancelled'
GROUP BY payment_type ORDER BY rez DESC;
```

**6.4 — İptal oranı:**
```sql
SELECT COUNT(*) AS toplam,
       SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS iptal,
       ROUND(100.0*SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END)/COUNT(*), 2) AS iptal_yuzde
FROM reservations;
```
*Örnek çıktı:* %8 (jeneratör CANCEL_RATE = 0.08 ile üretir).

**6.5 — Bebe (mama) sandalyesi trendi:**
```sql
SELECT to_char(reserve_date, 'YYYY-MM') AS ay, SUM(highchair_count) AS mama,
       COUNT(CASE WHEN highchair_count > 0 THEN 1 END) AS mama_isteyen_rez
FROM reservations WHERE status != 'cancelled'
GROUP BY ay ORDER BY ay DESC;
```

**6.6 — Top tesisler (ciro):**
```sql
SELECT f.kod, f.ad, ROUND(SUM(r.amount_minor)/100.0, 2) AS ciro_TL, COUNT(r.id) AS rez
FROM facilities f
LEFT JOIN reservations r ON r.facility_id = f.id AND r.status != 'cancelled'
GROUP BY f.id ORDER BY ciro_TL DESC LIMIT 10;
```

---

## 7. Rollup vs Canlı — türetilmiş veri (OLAP dersi, ADR-004)

`daily_stats`, `reservations`'tan **türetilen** günlük rollup'tır. Aynı sonucu çok daha hızlı verir
(taranan satır: yüz binler yerine ~gün×tesis). Önce backend'de tazele:
`node -e "require('./backend/analytics').rebuildDailyStats()"`.

**7.1 — Aynı ciro, iki kaynaktan (eşit olmalı):**
```sql
-- CANLI (kaynak tablo, ağır):
SELECT to_char(reserve_date, 'YYYY-MM') AS ay, SUM(amount_minor) AS ciro
FROM reservations WHERE status != 'cancelled' GROUP BY ay ORDER BY ay DESC LIMIT 3;

-- ROLLUP (türetilmiş, hafif):
SELECT to_char(stat_date, 'YYYY-MM') AS ay, SUM(revenue_minor) AS ciro
FROM daily_stats GROUP BY ay ORDER BY ay DESC LIMIT 3;
```
*Ne gösterir:* İki sonuç **birebir aynı** → türetilmiş veri kaynakla tutarlı. Fark yalnız hız
(DDIA Böl. 3, OLTP vs OLAP). `daily_stats` satır sayısı: ~32.850 (3 yıl × 30 tesis × ~365 gün).

---

## 8. İSPARK — otopark doluluğu (ADR-003)

**8.1 — Doluluk yüzdesi + boş yer:**
```sql
SELECT f.ad, i.capacity AS kapasite, i.occupied AS dolu,
       (i.capacity - i.occupied) AS bos,
       ROUND(100.0 * i.occupied / i.capacity, 1) AS doluluk_yuzde
FROM ispark_status i JOIN facilities f ON f.id = i.facility_id
ORDER BY doluluk_yuzde DESC;
```
*Not:* `occupied` canlı **compare-and-set** ile (take/release uçları) değişir; jeneratör bunu
doldurmaz, o yüzden 0 görünür. Atomik güncelleme örneği (geri alınan demo):
```sql
BEGIN;
UPDATE ispark_status SET occupied = occupied + 1
WHERE facility_id = 1 AND occupied < capacity;   -- CHECK: occupied <= capacity garanti
SELECT facility_id, occupied FROM ispark_status WHERE facility_id = 1;
ROLLBACK;
```

---

## 9. Güvenlik & denetim (ADR-002 / ADR-007)

**9.1 — Parolalar PHC formatında hash'li (düz metin YOK):**
```sql
SELECT username, left(password, 28) AS hash_onek FROM users LIMIT 5;
```
*Örnek çıktı:* `pbkdf2_sha256$600000$W1eDSS...` → algoritma$iterasyon$salt$hash. Parolanın kendisi
hiçbir yerde saklanmaz; her kullanıcıya ayrı salt.

**9.2 — Kullanıcı rolleri dağılımı:**
```sql
SELECT role AS rol, COUNT(*) AS adet FROM users GROUP BY role;
```

**9.3 — Denetim kaydı (audit log) — son işlemler + kim yaptı:**
```sql
SELECT a.created_at, u.username AS aktor, a.action, a.entity_type, a.entity_id, a.detail
FROM audit_log a JOIN users u ON u.id = a.actor_user_id
ORDER BY a.created_at DESC LIMIT 20;
```
*Not:* `audit_log` **append-only** (yalnız INSERT, mutasyonla aynı transaction). Admin panelinden
tesis CRUD / sipariş durum geçişi yapınca dolar.

---

## 10. Kapasite & büyük veri (DDIA Böl. 3)

**10.1 — İndeksli sorgu planı (noktasal erişim):**
```sql
EXPLAIN QUERY PLAN
SELECT SUM(guests) FROM reservations
WHERE facility_id = 1 AND reserve_date = '2026-06-01' AND reserve_time = '19:00';
```
*Örnek çıktı:* `SEARCH reservations USING INDEX idx_reservations_slot (...)` → tam tarama değil,
indeksten noktasal. 642K satırda bile slot doluluğu milisaniyede gelir.

**10.2 — İndekssiz sütunla karşılaştır (tam tarama):**
```sql
EXPLAIN QUERY PLAN
SELECT COUNT(*) FROM reservations WHERE crypto_signature = 'generated';
```
*Örnek çıktı:* `SCAN reservations` → indeks yok, tüm tabloyu tarar. İndeksin neden önemli olduğunun
kanıtı (sorgu desenine göre indeks seçilir — ADR-003).

**10.3 — Aylık ciro (ağır agregasyon) + süre:**
DBeaver sorguyu çalıştırınca alt barda süreyi gösterir; `psql`'de `\timing on`.
```sql
SELECT to_char(reserve_date, 'YYYY-MM') AS ay, SUM(amount_minor) AS ciro, COUNT(*) AS rez
FROM reservations WHERE status != 'cancelled' GROUP BY ay ORDER BY ay DESC;
```
*Ölçüm:* ~642K satırda ~300 ms (canlı). Aynısı `daily_stats` rollup'ından çok daha hızlı (§7).

---

## PostGIS geçiş notu

Mekansal sorguların (KNN, choropleth, bounding box) burada Haversine/uygulama-katmanı karşılıkları
verildi. Üretimde PostgreSQL + PostGIS'e geçilirse (`DATABASE.md` yol haritası): `geometry`/`geography`
kolonları + GiST indeks + `ST_Distance`, `ST_Contains`, `<->` operatörleri bu sorguları **indeksli ve
tek satırda** yapar. Şema ve kısıtlar (CHECK/FK) taşınabilir; iş mantığı aynı kalır.

---

# İKİNCİ KISIM: Yazma, Canlı İzleme ve Sunum

Buraya kadarki 10 bölüm **okuma** anlatıyordu: "veritabanında ne var?" Bu kısım
**yazma** ve **izleme** anlatıyor: *"uygulamada bir şey yaptım — veritabanında ne oldu?"*

## Önce: neden ayrı bir `demo` şeması?

`public` şemasında 425 bin üretilmiş rezervasyon var. Orada "rezervasyon yaptım, satır belirdi"
göstermek samanlıkta iğne aramaktır. `demo` şeması **sıfır rezervasyonla** başlar: yaptığınız
her işlem tablonun **tek satırı** olarak belirir.

```bash
npm run demo:reset     # demo şemasını sıfırla + küçük veriyle doldur (5 tesis, 3 kullanıcı, 0 rezervasyon)
npm run demo:start     # backend'i demo şemasına bağlı başlat
```

DBeaver'da SQL Editor'ün en üstüne şunu yazıp çalıştırın (sekme boyunca geçerli olur):

```sql
SET search_path = demo, public;
```

> `public` şemasındaki büyük veri **etkilenmez**. İki dünya birbirinden tamamen ayrı —
> bu yüzden demo sırasında yanlışlıkla gerçek veriyi bozmak mümkün değil.

Giriş bilgileri (yalnız `demo` şemasında geçerli, `demo-reset` bunları yazar):

| Kullanıcı | Parola | Rol |
|---|---|---|
| `demo_admin` | `DemoAdmin2026` | admin |
| `ayse` | `AyseParola26` | user |
| `mehmet` | `MehmetParola26` | user |

---

## 11. Yazma işlemleri — `INSERT` / `UPDATE` / `DELETE`

Bir veritabanını "yönetmek", okumayı değil **yazmayı** bilmektir.

**`RETURNING` — PostgreSQL'in en pratik özelliklerinden biri.** Klasik yol "ekle, sonra
`SELECT` ile bul"dur; iki tur gider. `RETURNING` eklenen satırı **aynı** sorguda geri verir:

```sql
INSERT INTO facilities (kod, ad, lat, lng, capacity, manual_occupancy)
VALUES ('SQL-01', 'SQL ile Eklenen Tesis', 'Kadıköy', 40.9910, 29.0250, 60, 0)
RETURNING id, kod, ad, capacity;
```

`id` yazmadığımıza dikkat edin: kolon `GENERATED ALWAYS AS IDENTITY`, yani id'yi veritabanı
üretir. Elle yazmaya kalkarsanız hata alırsınız — ve bu iyi bir şey, çünkü iki farklı yerin
aynı id'yi üretmesi imkânsız hale gelir.

**Hemen ardından şunu çalıştırın:**

```sql
SELECT kod, lat, lng, ST_AsText(geom) FROM facilities WHERE kod = 'SQL-01';
```

`geom` kolonunu **hiç yazmadık** ama dolu. Çünkü o bir *generated* kolon: `lat`/`lng`'den
otomatik türüyor. Bunun anlamı, koordinat ile harita noktasının **asla ayrışamayacağı** —
birini güncelleyip diğerini unutmak mümkün değil.

**`ON CONFLICT` (upsert)** — projenin seed'inin neden tekrar tekrar çalıştırılabildiğinin cevabı:

```sql
INSERT INTO districts (name, population) VALUES ('Kadıköy', 482713)
ON CONFLICT (name) DO UPDATE SET population = EXCLUDED.population;
```

*"Varsa güncelle, yoksa ekle."* Buna **idempotent** denir: aynı işlemi bir kez de yapsanız
beş kez de yapsanız sonuç aynı.

**`DELETE` ve cascade** — tesisi silin, menüsü ve İSPARK kaydı da gitsin. Silmeden önce
neyin gideceğini saymak iyi bir alışkanlıktır (`queries.sql` 11.7).

---

## 12. Canlı izleme — sunumun kalbi

Bu bölümdeki her sorgu bir soruyu yanıtlar: **"uygulamada X yaptım, veritabanında ne oldu?"**
Hepsi `ORDER BY id DESC LIMIT n` kullanır ki en son yaptığınız işlem **en üstte** görünsün.

| Uygulamada yaptığınız | Değişen tablolar | Sorgu |
|---|---|---|
| Kayıt ol | `users` | 12.1 |
| Rezervasyon yap | `reservations` | 12.2 |
| Sipariş ver | `orders` + `order_items` + `reservations.amount_minor` | 12.3 |
| Menü fiyatını değiştir | *(eski sipariş DEĞİŞMEZ)* | 12.4 |
| Sipariş durumunu ilerlet | `orders.status` + `audit_log` | 12.5 |
| Rezervasyonu iptal et | `reservations` + `orders` + `audit_log` | 12.6 |
| Tesis ekle (admin) | `facilities` + `ispark_status` + `audit_log` | 12.7 |

**12.1'de mutlaka parolaya bakın.** Sorgu PHC formatını parçalarına ayırıyor:

```
algoritma        iterasyon    salt_onek
pbkdf2_sha256    600000       jIdbjq9SA96r…
```

İki şey gösterin: (a) düz metin parola **yok**, (b) her satırın **salt'ı farklı** — yani iki
kişi aynı parolayı seçse bile hash'leri farklı olur, tek bir "önceden hesaplanmış tablo"
(rainbow table) ikisini birden kıramaz.

**12.3 tek işlemin üç tabloyu birden değiştirdiğini gösterir.** Sipariş verildiğinde
`orders`'a bir satır, `order_items`'a kalemler, `reservations.amount_minor`'a tutar yazılır —
hepsi **aynı transaction'da**. Biri olup diğeri olmazsa veri tutarsız kalırdı.

**12.4 en etkileyici olanı.** Menü fiyatını değiştirin, sonra karşılaştırın:

```
urun         guncel_menu_fiyati    siparis_anindaki_fiyat    fark
SQL Kahvesi  280.00                180.00                    100.00
```

Sipariş **fiyatı kopyalamıştı** (snapshot), menüye *referans vermemişti*. Bu yüzden geçmiş
siparişler ve raporlar sonradan değişmez. Buna *captured vs derived* denir: bazı veriler
o anki değerini saklamalı, bazıları her seferinde yeniden hesaplanmalı.

**12.8'i sunumda ayrı bir sekmede açık bırakın** — tüm tabloların canlı satır sayısı. Her
işlemden sonra <kbd>F5</kbd> basıp sayıların arttığını göstermek çok etkili.

---

## 13. Kısıtları bilerek kır — hata almak burada **başarıdır**

Bu bölümdeki sorguların hepsi **hata verir**. Bu kasıtlı: hata mesajı, kuralın gerçekten
veritabanında yazılı olduğunun kanıtıdır. Uygulama kodu atlanabilir (birisi doğrudan SQL
yazabilir, bir script hata yapabilir) — veritabanı kısıtı atlanamaz.

DBeaver hatayı kırmızı bir kutuda gösterir. Mentöre göstermeye değer.

| # | Denenen | Hata kodu | Ne öğretiyor |
|---|---|---|---|
| 13.1 | kapasite `-5` | `23514` CHECK | Anlamsız değer DB'ye giremez |
| 13.2 | enlem `999` | `23514` CHECK | Koordinat aralığı zorlanıyor |
| 13.3 | `guests = 0` | `23514` CHECK | Sıfır kişilik rezervasyon yok |
| 13.4 | tarih `2027-13-45` | `22008` | **Gerçek `date` tipi.** SQLite'ta `TEXT` olduğu için bu KABUL EDİLİYORDU |
| 13.5 | olmayan tesise rezervasyon | `23503` FK | Yetim kayıt imkânsız |
| 13.6 | aynı tesis kodu iki kez | `23505` UNIQUE | Kod benzersiz |
| 13.7 | aynı slota iki **aktif** rezervasyon | `23505` | Kısmi benzersiz indeks |
| 13.8 | otopark doluluğu > kapasite | `23514` | Sayaç sınırlı |
| 13.9 | `geom`'u elle yazma | `428C9` | Generated kolon korumalı |
| 13.10 | negatif tutar | `23514` | Para negatife düşmez |

**13.7 en öğreticisi**, çünkü hem hata verir hem de arkasından **başarılı olur**:

1. Aynı slota ikinci aktif rezervasyon → `23505` hata.
2. İlkini iptal edin (`status='cancelled'`).
3. **Aynı slota tekrar deneyin → bu sefer geçer.**

Çünkü kısıt normal bir `UNIQUE` değil, **kısmi (partial) benzersiz indeks**:

```sql
CREATE UNIQUE INDEX uq_reservations_active_slot
  ON reservations (user_id, facility_id, reserve_date, reserve_time)
  WHERE status <> 'cancelled';        -- <-- kural yalnız AKTİF satırlara uygulanır
```

Eskiden buradaki kısıt `status`'ü hiç bilmiyordu; iptal edilen bir rezervasyon o slotu
**sonsuza dek** bloke ediyordu — kullanıcı fikrini değiştirip aynı yere dönemiyordu.

---

## 14. Transaction'ı elle gör — iki oturum gerekir

Transaction anlatmanın en iyi yolu, **kilidi gözle görmektir**.

**Hazırlık:** DBeaver'da `SQL Editor > New SQL Editor` ile **ikinci** bir sekme açın
(DBeaver her sekmeye ayrı bağlantı verir). Araç çubuğundaki **Auto** düğmesini
**Manual Commit**'e alın.

1. **[A]** `BEGIN;` sonra `UPDATE facilities SET capacity = capacity + 1 WHERE id = 1;`
   — **commit etmeyin**, orada durun. Satır artık A'nın kilidinde.
2. **[B]** Aynı satırı güncellemeyi deneyin. **Spinner döner, bekler.** İşte kilit budur.
3. **[Üçüncü sekme]** Kim kimi bekliyor, SQL ile görün:

```sql
SELECT bekleyen.pid, engelleyen.pid AS engelleyen, bekleyen.wait_event
FROM pg_stat_activity bekleyen
JOIN pg_stat_activity engelleyen ON engelleyen.pid = ANY(pg_blocking_pids(bekleyen.pid))
WHERE cardinality(pg_blocking_pids(bekleyen.pid)) > 0;
```

4. **[A]** `ROLLBACK;` → B'nin beklemesi **anında** biter ve B'nin güncellemesi uygulanır.
   A'nın `+1`'i **hiç olmamış gibi** kaybolur. "Ya hep ya hiç" (atomiklik) budur.

**Sonra izolasyon seviyesine bakın:**

```sql
SHOW default_transaction_isolation;   -- read committed  (PostgreSQL varsayılanı)
```

Uygulamanın rezervasyon transaction'ı bu varsayılanı **kullanmıyor**; `SERIALIZABLE`
istiyor. Neden gerekli olduğunu tek komutla gösterebilirsiniz:

```bash
node backend/test-concurrency.js
```

40 paralel worker, kapasite 10 → READ COMMITTED'da **18-22** rezervasyon geçiyor
(overbooking), SERIALIZABLE'da **tam 10**.

---

## 15. Türetilmiş veri gerçekten türetilmiş mi?

DDIA Bölüm 11'in kuralı: *türetilmiş veri her an kaynaktan yeniden üretilebilmelidir.*
Bunu iddia etmek kolay — **kanıtlayalım**:

1. Rollup ile canlı sorgu aynı sayıyı veriyor mu? (15.1)
2. **Rollup'ı tamamen silin.** (15.2) Korkmayın: türetilmiş veri, kaynak duruyor.
3. Canlı sorgu **hâlâ doğru** cevabı veriyor. (15.3) Çünkü kaynağa bakıyor.
4. Rollup'ı yeniden kurun:
   ```bash
   node -e "require('./backend/analytics').rebuildDailyStats().then(n=>console.log(n+' satır'))"
   ```
5. 15.1'i tekrar çalıştırın: iki satır yine **aynı** sayı.

Aynı ders doluluk için de geçerli (15.5): `manual_occupancy` **saklanan** bir işaret,
gerçek doluluk ise rezervasyonlardan **türetilen** bir sayı. Sorgu ikisini yan yana
gösterir — genelde farklıdırlar ve bu normaldir. Önemli olan hangisinin kullanıcıya
"doluluk" diye sunulduğu.

---

## 16. Şemayı sorgulayarak keşfet

DBeaver'ın sol ağaçta gösterdiği her şey aslında **sorgulanabilir veridir**. PostgreSQL
kendi yapısını da tablolarda tutar (`information_schema`, `pg_catalog`). Bunu bilmek,
"aracın sihirli değil, sadece SQL yazıyor" farkındalığını verir.

| Sorgu | Ne gösterir | DBeaver'daki karşılığı |
|---|---|---|
| 16.1 | tablolar + boyut | ağaçtaki tablo listesi |
| 16.2 | kolonlar ve tipleri | tablo > Columns sekmesi |
| 16.3 | **tüm kısıtlar** | tablo > Constraints |
| 16.4 | indeksler + **kaç kez kullanıldı** | tablo > Indexes |
| 16.5 | PostGIS geometri kolonları | — |
| 16.6 | yabancı anahtarlar | **ER Diagram'daki oklar** |
| 16.7 | uygulanmış migration'lar | — |

**16.4'e özellikle bakın:** `idx_scan` kolonu bir indeksin **kaç kez kullanıldığını** söyler.
`0` olan bir indeks ya hiç sorgulanmamıştır ya da gereksizdir — indeks bedava değildir, her
yazmada güncellenir. "Her kolona indeks atalım" yaklaşımının neden yanlış olduğunun ölçülebilir
cevabı burada.

**16.3 mentöre gösterilecek en iyi sorgulardan biri:** projedeki bütün iş kurallarının
veritabanına nasıl yazıldığını tek tabloda listeler.
