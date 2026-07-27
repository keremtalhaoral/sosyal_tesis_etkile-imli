-- =============================================================================
-- queries.sql — Projenin her özelliğini gösteren çalıştırılabilir SQL sorguları
-- =============================================================================
-- Kullanım: DBeaver'da data/app.db'yi bağla ve sorguları tek tek çalıştır
--          (ya da: psql -d mufettis -f queries.sql).
-- Anlatımlı hâli (amaç/ne gösterir/PostGIS): docs/sorgu-defteri.md
-- Analitik sorguların sonuç dönmesi için önce veri üret:
--   node scripts/generate-data.js --reset --scale=3     (~640K rezervasyon)
-- Para her yerde tam sayı kuruş (*_minor); TL için /100.0. (ADR-001)
-- =============================================================================

-- ----- 1. TEMEL KEŞİF --------------------------------------------------------

-- 1.1 Veri hacmi (tüm tablo satır sayıları)
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

-- 1.2 Tesis listesi: ELLE girilen işaret ile GERÇEK (türetilmiş) doluluk yan yana.
-- manual_occupancy adminin elle yazdığı sayıdır; gerçek doluluk rezervasyonlardan hesaplanır
-- (migration v7 / ADR-009). İkisinin farklı olması normaldir - asıl mesele hangisinin
-- "doluluk" diye SUNULDUĞU: artık sağdaki.
SELECT f.kod, f.ad, f.capacity AS kapasite,
       f.manual_occupancy AS elle_isaret,
       COALESCE(o.seats, 0) AS bugun_rezerve_koltuk,
       LEAST(100, ROUND(COALESCE(o.seats,0) * 100.0 / f.capacity))::int AS gercek_doluluk_yuzde
FROM facilities f
LEFT JOIN LATERAL (
  SELECT SUM(r.guests)::int AS seats FROM reservations r
  WHERE r.facility_id = f.id AND r.reserve_date = CURRENT_DATE AND r.status <> 'cancelled'
) o ON TRUE
ORDER BY f.capacity DESC;

-- ----- 2. MEKANSAL / CBS -- GERÇEK PostGIS (ADR-009) -------------------------
-- Bu sorgular eskiden elle yazılmış Haversine/acos formülleriydi (ve acos küçük
-- mesafelerde hassasiyet kaybediyordu). Artık jeodezik hesabı PostGIS yapıyor.

-- 2.1 En yakın 3 tesis (KNN), Taksim'den (41.0369, 28.9850)
-- <-> operatörü idx_facilities_geog GiST indeksini kullanır: tüm tabloyu tarayıp
-- sıralamaz, indeksten doğrudan en yakınları çeker. ::geography ŞART - geometry
-- üzerinde <-> DERECE ölçer ve 41°N'de metre sıralamasıyla uyuşmaz.
SELECT kod, ad,
       ROUND((ST_Distance(geom::geography,
              ST_SetSRID(ST_MakePoint(28.9850, 41.0369), 4326)::geography) / 1000)::numeric, 2) AS km
FROM facilities
ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint(28.9850, 41.0369), 4326)::geography
LIMIT 3;

-- 2.2 İki tesis arası mesafe
SELECT a.ad AS tesis_a, b.ad AS tesis_b,
       ROUND((ST_Distance(a.geom::geography, b.geom::geography) / 1000)::numeric, 2) AS km
FROM facilities a JOIN facilities b ON b.id > a.id
WHERE a.kod = 'ALTY-01' AND b.kod = 'ALTY-08';

-- 2.2b MEKANSAL JOIN: hangi tesis hangi ilçede? (eskiden JS'te ray-casting'di)
SELECT d.name AS ilce, COUNT(f.id) AS tesis_sayisi,
       ROUND(COUNT(f.id) * 100000.0 / d.population, 2) AS tesis_100k_kisi
FROM districts d LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
WHERE d.geom IS NOT NULL
GROUP BY d.id, d.name, d.population
ORDER BY tesis_100k_kisi ASC LIMIT 10;

-- 2.2c Bir tesisin 2 km çevresindeki diğer tesisler (ST_DWithin - indeks kullanır)
SELECT b.kod, b.ad, ROUND(ST_Distance(a.geom::geography, b.geom::geography)::numeric) AS metre
FROM facilities a JOIN facilities b ON b.id <> a.id
WHERE a.kod = 'ALTY-01'
  AND ST_DWithin(a.geom::geography, b.geom::geography, 2000)
ORDER BY metre;

-- 2.3 Bounding box içindeki tesisler
SELECT kod, ad, lat, lng FROM facilities
WHERE lat BETWEEN 41.00 AND 41.20 AND lng BETWEEN 28.90 AND 29.00
ORDER BY lat DESC;

-- ----- 3. DEMOGRAFİ / KARAR DESTEK -------------------------------------------

-- 3.1 İlçe nüfus sıralaması
SELECT name AS ilce, population AS nufus FROM districts ORDER BY population DESC LIMIT 10;

-- 3.2 Nüfus istatistikleri
SELECT COUNT(*) ilce_sayisi, SUM(population) toplam_nufus,
       ROUND(AVG(population)) ort_nufus, MAX(population) en_kalabalik FROM districts;

-- ----- 4. REZERVASYON & KAPASİTE (ADR-003) -----------------------------------

-- 4.1 Belirli slot doluluğu (kapasite kontrolünün kalbi / write-skew)
SELECT COALESCE(SUM(guests), 0) AS dolu_koltuk
FROM reservations
WHERE facility_id = 1 AND reserve_date = '2026-06-01' AND reserve_time = '19:00'
  AND status != 'cancelled';

-- 4.2 Bir günün tüm slot doluluğu (tek tesis)
SELECT reserve_time AS slot, SUM(guests) AS misafir, COUNT(*) AS rezervasyon
FROM reservations
WHERE facility_id = 1 AND reserve_date = '2026-06-01' AND status != 'cancelled'
GROUP BY reserve_time ORDER BY slot;

-- 4.3 Doluluk ısı haritası (haftanın günü × slot)
SELECT EXTRACT(DOW FROM reserve_date)::int AS gun_0paz,
       reserve_time AS slot, SUM(guests) AS misafir
FROM reservations WHERE status <> 'cancelled'
GROUP BY gun_0paz, slot ORDER BY misafir DESC;

-- ----- 5. SİPARİŞ & FİYAT SNAPSHOT (ADR-001/005) -----------------------------

-- 5.1 Sipariş toplamı = kalem snapshot toplamı (boş dönmeli = tutarlı)
SELECT o.id AS siparis, o.total_minor AS kayitli_toplam,
       SUM(oi.quantity * oi.unit_price_minor) AS kalemlerden_toplam
FROM orders o JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.total_minor HAVING o.total_minor <> SUM(oi.quantity * oi.unit_price_minor) LIMIT 5;

-- 5.2 Snapshot ≠ güncel menü fiyatı (fiyat sonradan değişmişse dolar)
SELECT oi.id, m.name, oi.unit_price_minor AS siparis_ani_fiyat, m.price_minor AS guncel_menu_fiyat
FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
WHERE oi.unit_price_minor <> m.price_minor LIMIT 5;

-- 5.2b Immutability demosu (güvenli, geri alınır)
-- BEGIN;
-- UPDATE menu_items SET price_minor = price_minor + 500 WHERE id = 1;
-- SELECT oi.unit_price_minor AS eski, m.price_minor AS yeni
-- FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id WHERE oi.menu_item_id = 1 LIMIT 3;
-- ROLLBACK;

-- 5.3 Sipariş durum makinesi dağılımı
SELECT status AS durum, COUNT(*) AS adet FROM orders GROUP BY status ORDER BY adet DESC;

-- 5.4 En çok satan menü kalemleri
SELECT m.name, m.category, SUM(oi.quantity) AS adet,
       ROUND(SUM(oi.quantity * oi.unit_price_minor)/100.0, 2) AS ciro_TL
FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
GROUP BY m.id ORDER BY adet DESC LIMIT 10;

-- 5.5 Kategori bazında satış
SELECT m.category, SUM(oi.quantity) AS adet,
       ROUND(SUM(oi.quantity * oi.unit_price_minor)/100.0, 2) AS ciro_TL
FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
GROUP BY m.category ORDER BY ciro_TL DESC;

-- ----- 6. ANALİTİK (ADR-004) -------------------------------------------------

-- 6.1 KPI özeti (iptaller hariç)
SELECT COUNT(*) AS rezervasyon, ROUND(SUM(amount_minor)/100.0, 2) AS ciro_TL,
       ROUND(AVG(guests), 2) AS ort_grup, SUM(highchair_count) AS mama_sandalyesi
FROM reservations WHERE status <> 'cancelled';

-- 6.2 Aylık ciro zaman serisi
SELECT to_char(reserve_date, 'YYYY-MM') AS ay, ROUND(SUM(amount_minor)/100.0, 2) AS ciro_TL, COUNT(*) AS rez
FROM reservations WHERE status <> 'cancelled' GROUP BY ay ORDER BY ay DESC;

-- 6.3 Ödeme tipi kırılımı
SELECT COALESCE(payment_type, 'bilinmiyor') AS odeme, COUNT(*) AS rez,
       ROUND(SUM(amount_minor)/100.0, 2) AS ciro_TL
FROM reservations WHERE status <> 'cancelled' GROUP BY payment_type ORDER BY rez DESC;

-- 6.4 İptal oranı
SELECT COUNT(*) AS toplam,
       SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS iptal,
       ROUND(100.0*SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END)/COUNT(*), 2) AS iptal_yuzde
FROM reservations;

-- 6.5 Mama sandalyesi trendi
SELECT to_char(reserve_date, 'YYYY-MM') AS ay, SUM(highchair_count) AS mama,
       COUNT(CASE WHEN highchair_count > 0 THEN 1 END) AS mama_isteyen_rez
FROM reservations WHERE status <> 'cancelled' GROUP BY ay ORDER BY ay DESC;

-- 6.6 Top tesisler (ciro)
SELECT f.kod, f.ad, ROUND(SUM(r.amount_minor)/100.0, 2) AS ciro_TL, COUNT(r.id) AS rez
FROM facilities f LEFT JOIN reservations r ON r.facility_id = f.id AND r.status != 'cancelled'
GROUP BY f.id ORDER BY ciro_TL DESC LIMIT 10;

-- ----- 7. ROLLUP vs CANLI (türetilmiş veri, OLAP) ----------------------------
-- Önce: node -e "require('./backend/analytics').rebuildDailyStats()"

-- 7.1a CANLI aylık ciro
SELECT to_char(reserve_date, 'YYYY-MM') AS ay, SUM(amount_minor) AS ciro
FROM reservations WHERE status <> 'cancelled' GROUP BY ay ORDER BY ay DESC LIMIT 3;
-- 7.1b ROLLUP aylık ciro (aynı sonuç, daha hızlı)
SELECT to_char(stat_date, 'YYYY-MM') AS ay, SUM(revenue_minor) AS ciro
FROM daily_stats GROUP BY ay ORDER BY ay DESC LIMIT 3;

-- ----- 8. İSPARK (ADR-003) ---------------------------------------------------

-- 8.1 Otopark doluluğu
SELECT f.ad, i.capacity AS kapasite, i.occupied AS dolu, (i.capacity - i.occupied) AS bos,
       ROUND(100.0 * i.occupied / i.capacity, 1) AS doluluk_yuzde
FROM ispark_status i JOIN facilities f ON f.id = i.facility_id ORDER BY doluluk_yuzde DESC;

-- 8.1b Atomik güncelleme demosu (geri alınır)
-- BEGIN;
-- UPDATE ispark_status SET occupied = occupied + 1 WHERE facility_id = 1 AND occupied < capacity;
-- SELECT facility_id, occupied FROM ispark_status WHERE facility_id = 1;
-- ROLLBACK;

-- ----- 9. GÜVENLİK & DENETİM (ADR-002/007) -----------------------------------

-- 9.1 Parolalar PHC formatında (düz metin YOK)
SELECT username, left(password, 28) AS hash_onek FROM users LIMIT 5;

-- 9.2 Rol dağılımı
SELECT role AS rol, COUNT(*) AS adet FROM users GROUP BY role;

-- 9.3 Audit log (son işlemler + aktör)
SELECT a.created_at, u.username AS aktor, a.action, a.entity_type, a.entity_id, a.detail
FROM audit_log a JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT 20;

-- ----- 10. KAPASİTE & BÜYÜK VERİ (DDIA Böl. 3) -------------------------------

-- 10.1 İndeksli sorgu planı (noktasal) - "Index Scan using idx_reservations_slot" görmeli
EXPLAIN (ANALYZE, BUFFERS)
SELECT SUM(guests) FROM reservations
WHERE facility_id = 1 AND reserve_date = '2026-06-01' AND reserve_time = '19:00';

-- 10.2 İndekssiz sütun (tam tarama) - "Seq Scan" görmeli: farkı yan yana koy
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM reservations WHERE crypto_signature = 'generated';

-- 10.3 Ağır agregasyon (DBeaver alt barda süreyi gösterir)
SELECT to_char(reserve_date, 'YYYY-MM') AS ay, SUM(amount_minor) AS ciro, COUNT(*) AS rez
FROM reservations WHERE status <> 'cancelled' GROUP BY ay ORDER BY ay DESC;


-- =============================================================================
-- 11-16. BÖLÜMLER: YAZMA, CANLI İZLEME, KISIT KIRMA, TRANSACTION, TÜRETME, ŞEMA
-- =============================================================================
-- BURADAN İTİBAREN VERİYİ DEĞİŞTİREN SORGULAR VAR.
-- Önce `demo` şemasına geçin - `public` şemasındaki 425 bin satırlık veriye dokunmayın:
--
--     SET search_path = demo, public;
--
-- Demo şemasını kurmak/sıfırlamak için:  npm run demo:reset
-- Backend'i demo şemasına bağlamak için: npm run demo:start
-- =============================================================================

-- ----- 11. YAZMA İŞLEMLERİ (INSERT / UPDATE / DELETE) -------------------------
-- Defterin ilk 10 bölümü yalnız OKUMA anlatıyordu. Veritabanı yönetmek yazmayı da bilmektir.

-- 11.1 INSERT + RETURNING: eklediğin satırı AYNI sorguda geri al.
-- RETURNING PostgreSQL'in güzel bir özelliği: "ekle sonra SELECT ile bul" yerine tek adım.
-- id GENERATED ALWAYS AS IDENTITY olduğu için elle id VERİLMEZ; veritabanı üretir.
INSERT INTO facilities (kod, ad, adres, lat, lng, capacity, manual_occupancy)
VALUES ('SQL-01', 'SQL ile Eklenen Tesis', 'Kadıköy', 40.9910, 29.0250, 60, 0)
RETURNING id, kod, ad, capacity;

-- 11.2 geom OTOMATİK doldu mu? (generated kolon - elle yazılmadı, lat/lng'den türedi)
SELECT kod, lat, lng, ST_AsText(geom) AS geometri
FROM facilities WHERE kod = 'SQL-01';

-- 11.3 Toplu INSERT: tek ifadede birden çok satır (satır başına round-trip yok).
INSERT INTO menu_items (facility_id, name, category, price_minor)
SELECT f.id, x.ad, x.kategori, x.fiyat
FROM facilities f
CROSS JOIN (VALUES
  ('SQL Çayı',    'İçecek',   1500),
  ('SQL Kahvesi', 'İçecek',   4500),
  ('SQL Tatlısı', 'Tatlı',    6000)
) AS x(ad, kategori, fiyat)
WHERE f.kod = 'SQL-01'
RETURNING id, name, price_minor;

-- 11.4 UPDATE + RETURNING: önceki ve sonraki değeri birlikte görmek
UPDATE facilities SET capacity = capacity + 20, updated_at = now()
WHERE kod = 'SQL-01'
RETURNING kod, capacity AS yeni_kapasite;

-- 11.5 UPDATE ... FROM: başka tablodan gelen değere göre güncelleme
-- (Tüm menü fiyatlarına tesis kapasitesine bağlı küçük bir zam.)
UPDATE menu_items m SET price_minor = m.price_minor + (f.capacity / 10)
FROM facilities f
WHERE f.id = m.facility_id AND f.kod = 'SQL-01'
RETURNING m.name, m.price_minor;

-- 11.6 UPSERT (ON CONFLICT): varsa güncelle, yoksa ekle - seed'in idempotent olma sırrı
INSERT INTO districts (name, population) VALUES ('Kadıköy', 482713)
ON CONFLICT (name) DO UPDATE SET population = EXCLUDED.population
RETURNING name, population;

-- 11.7 DELETE + CASCADE: tesisi sil, menüsü/İSPARK'ı da gitsin
-- Önce neyin gideceğini SAY (silmeden önce bakmak iyi alışkanlık):
SELECT (SELECT COUNT(*) FROM menu_items m JOIN facilities f ON f.id=m.facility_id WHERE f.kod='SQL-01') AS silinecek_menu,
       (SELECT COUNT(*) FROM facilities WHERE kod='SQL-01') AS silinecek_tesis;
DELETE FROM facilities WHERE kod = 'SQL-01' RETURNING id, kod, ad;
-- Menü kalemleri de gitti mi? (0 dönmeli - ON DELETE CASCADE)
SELECT COUNT(*) AS kalan_yetim_menu FROM menu_items WHERE name LIKE 'SQL %';


-- ----- 12. CANLI İZLEME: "uygulamada X yaptım, veritabanında ne oldu?" --------
-- Bu bölüm DBeaver sunumunun kalbi. Her blok: uygulamada bir işlem yap, F5'e bas, satırı gör.
-- Bütün sorgular `ORDER BY id DESC LIMIT n` kullanır: EN SON olan en üstte görünsün.

-- 12.1 KAYIT OL -> users
-- Bakılacak: parola DÜZ METİN DEĞİL. Format: pbkdf2_sha256$<iterasyon>$<salt>$<hash>
-- Farklı satırların salt'ları FARKLI olmalı (aynı parolayı iki kişi seçse bile hash farklı).
SELECT id, username, role,
       split_part(password, '$', 1) AS algoritma,
       split_part(password, '$', 2) AS iterasyon,
       left(split_part(password, '$', 3), 12) || '…' AS salt_onek,
       created_at
FROM users ORDER BY id DESC LIMIT 5;

-- 12.2 REZERVASYON YAP -> reservations
-- Bakılacak: crypto_signature (HMAC imzası) ve status='confirmed'.
SELECT r.id, u.username, f.ad AS tesis, r.reserve_date, r.reserve_time,
       r.guests, r.status, left(r.crypto_signature, 20) || '…' AS imza, r.created_at
FROM reservations r
JOIN users u ON u.id = r.user_id
JOIN facilities f ON f.id = r.facility_id
ORDER BY r.id DESC LIMIT 5;

-- 12.3 SİPARİŞ VER -> orders + order_items + reservations.amount_minor
-- TEK işlem ÜÇ tabloyu birden değiştiriyor; hepsi aynı transaction'da.
SELECT o.id AS siparis, o.status, ROUND(o.total_minor/100.0, 2) AS toplam_tl,
       m.name AS urun, oi.quantity AS adet,
       ROUND(oi.unit_price_minor/100.0, 2) AS birim_fiyat_snapshot,
       ROUND(r.amount_minor/100.0, 2) AS rezervasyon_toplami
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN menu_items m ON m.id = oi.menu_item_id
JOIN reservations r ON r.id = o.reservation_id
ORDER BY o.id DESC, oi.id LIMIT 10;

-- 12.4 FİYAT SNAPSHOT KANITI: menüyü değiştir, eski sipariş değişmesin
-- Önce menü fiyatını değiştir (DBeaver'da elle de yapabilirsin):
UPDATE menu_items SET price_minor = price_minor + 10000
WHERE id = (SELECT menu_item_id FROM order_items ORDER BY id DESC LIMIT 1)
RETURNING name, price_minor AS yeni_menu_fiyati;
-- Sonra karşılaştır: güncel fiyat DEĞİŞTİ, siparişteki snapshot AYNI KALDI.
SELECT m.name,
       ROUND(m.price_minor/100.0, 2)        AS guncel_menu_fiyati,
       ROUND(oi.unit_price_minor/100.0, 2)  AS siparis_anindaki_fiyat,
       ROUND((m.price_minor - oi.unit_price_minor)/100.0, 2) AS fark
FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
ORDER BY oi.id DESC LIMIT 5;

-- 12.5 SİPARİŞ DURUMUNU İLERLET (submitted -> served -> paid) -> orders + audit_log
SELECT a.id, a.action, a.entity_type, a.entity_id,
       a.detail->>'from' AS onceki_durum, a.detail->>'to' AS yeni_durum,
       u.username AS islemi_yapan, a.created_at
FROM audit_log a JOIN users u ON u.id = a.actor_user_id
WHERE a.entity_type = 'order'
ORDER BY a.id DESC LIMIT 10;

-- 12.6 REZERVASYONU İPTAL ET -> status + amount_minor + audit_log
-- Bakılacak: satır SİLİNMEDİ (status='cancelled'), tutar geri alındı, audit kaydı düştü.
SELECT r.id, r.status, ROUND(r.amount_minor/100.0, 2) AS kalan_tutar,
       a.detail->>'cancelled_orders' AS iptal_edilen_siparis,
       ROUND((a.detail->>'reverted_minor')::numeric/100.0, 2) AS geri_alinan_tl
FROM reservations r
LEFT JOIN audit_log a ON a.entity_type='reservation' AND a.entity_id=r.id AND a.action='reservation.cancel'
WHERE r.status = 'cancelled'
ORDER BY r.id DESC LIMIT 5;

-- 12.7 TESİS EKLE (admin) -> facilities + ispark_status + audit_log
-- Tek admin işlemi ÜÇ tabloya dokunuyor.
SELECT f.id, f.kod, f.ad, f.capacity,
       i.capacity AS ispark_kapasite,
       a.action AS audit_kaydi, a.detail
FROM facilities f
LEFT JOIN ispark_status i ON i.facility_id = f.id
LEFT JOIN audit_log a ON a.entity_type='facility' AND a.entity_id=f.id AND a.action='facility.create'
ORDER BY f.id DESC LIMIT 5;

-- 12.8 HER ŞEYİ TEK BAKIŞTA: tabloların canlı satır sayıları
-- Sunumda bunu bir sekmede açık bırakıp her işlemden sonra F5'e basmak etkileyicidir.
SELECT 'users' AS tablo, COUNT(*) AS satir FROM users
UNION ALL SELECT 'facilities',   COUNT(*) FROM facilities
UNION ALL SELECT 'reservations', COUNT(*) FROM reservations
UNION ALL SELECT 'orders',       COUNT(*) FROM orders
UNION ALL SELECT 'order_items',  COUNT(*) FROM order_items
UNION ALL SELECT 'ispark_status',COUNT(*) FROM ispark_status
UNION ALL SELECT 'ispark_holds', COUNT(*) FROM ispark_holds
UNION ALL SELECT 'audit_log',    COUNT(*) FROM audit_log
ORDER BY tablo;

-- 12.9 SON 2 DAKİKADA NE OLDU? (sunum sırasında "şu an ne değişti" sorusu)
SELECT 'rezervasyon' AS tur, id, created_at FROM reservations WHERE created_at > now() - interval '2 minutes'
UNION ALL
SELECT 'sipariş', id, created_at FROM orders WHERE created_at > now() - interval '2 minutes'
UNION ALL
SELECT 'audit',   id, created_at FROM audit_log WHERE created_at > now() - interval '2 minutes'
ORDER BY created_at DESC;


-- ----- 13. KISITLARI BİLEREK KIR (hata mesajı = kısıtın kanıtı) ---------------
-- Aşağıdaki sorguların HEPSİ HATA VERMELİ. Hata almak burada BAŞARIDIR: veritabanının
-- geçersiz durumu gerçekten engellediğini gösterir. Uygulama koduna güvenmek yerine
-- kuralı veritabanına yazmanın anlamı budur (DDIA Böl. 7).
-- DBeaver hata mesajını kırmızı bir kutuda gösterir - sunumda göstermeye değer.

-- 13.1 CHECK: kapasite pozitif olmalı        -> 23514 check_violation
INSERT INTO facilities (kod, ad, lat, lng, capacity) VALUES ('KIR-1', 'Negatif', 41, 29, -5);

-- 13.2 CHECK: koordinat geçerli aralıkta olmalı -> 23514
INSERT INTO facilities (kod, ad, lat, lng, capacity) VALUES ('KIR-2', 'Uzay', 999, 29, 10);

-- 13.3 CHECK: misafir sayısı pozitif olmalı  -> 23514
-- NOT: id'ler alt sorgudan seçiliyor. Sabit id yazarsak (user_id=1 gibi) o kullanıcı bu
-- şemada yoksa FK hatası alırız ve YANLIŞ kısıtı test etmiş oluruz. Test ettiğin şeyin
-- gerçekten test ettiğin şey olduğundan emin ol.
INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
VALUES ((SELECT MIN(id) FROM users), (SELECT MIN(id) FROM facilities), '2027-05-05', '19:00', 0, 'x');

-- 13.4 TİP: imkansız tarih                    -> 22008 datetime_field_overflow
-- (SQLite'ta reserve_date TEXT olduğu için bu KABUL EDİLİYORDU. Gerçek tipin değeri budur.)
INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
VALUES ((SELECT MIN(id) FROM users), (SELECT MIN(id) FROM facilities), '2027-13-45', '19:00', 2, 'x');

-- 13.5 FK: olmayan tesise rezervasyon         -> 23503 foreign_key_violation
INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
VALUES ((SELECT MIN(id) FROM users), 999999, '2027-05-05', '19:00', 2, 'x');

-- 13.6 UNIQUE: aynı tesis kodu iki kez        -> 23505 unique_violation
INSERT INTO facilities (kod, ad, lat, lng, capacity)
SELECT kod, 'Kopya', 41, 29, 10 FROM facilities LIMIT 1;

-- 13.7 KISMİ UNIQUE: aynı kullanıcı aynı slota İKİ AKTİF rezervasyon -> 23505
-- Ama İPTAL EDİLMİŞ bir rezervasyon slotu bloke ETMEZ (migration v9).
-- Önce bir rezervasyon oluştur, sonra aynısını tekrar dene:
INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
SELECT (SELECT MIN(id) FROM users), (SELECT MIN(id) FROM facilities), '2027-08-08', '19:00', 2, 'ilk';
INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
SELECT (SELECT MIN(id) FROM users), (SELECT MIN(id) FROM facilities), '2027-08-08', '19:00', 2, 'ikinci';   -- <- 23505
-- Şimdi ilkini iptal et ve TEKRAR dene: bu sefer GEÇMELİ.
UPDATE reservations SET status='cancelled'
WHERE reserve_date='2027-08-08' AND reserve_time='19:00' AND status <> 'cancelled';
INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
SELECT (SELECT MIN(id) FROM users), (SELECT MIN(id) FROM facilities), '2027-08-08', '19:00', 2, 'iptalden sonra'
RETURNING id, status;   -- <- BAŞARILI: kısmi indeks yalnız aktif satırlara bakıyor

-- 13.8 İSPARK: doluluk kapasiteyi aşamaz      -> 23514
UPDATE ispark_status SET occupied = capacity + 1 WHERE facility_id = (SELECT MIN(facility_id) FROM ispark_status);

-- 13.9 GENERATED kolon elle yazılamaz         -> 428C9
UPDATE facilities SET geom = ST_SetSRID(ST_MakePoint(0,0), 4326) WHERE id = (SELECT MIN(id) FROM facilities);

-- 13.10 Para negatife düşemez                 -> 23514
UPDATE reservations SET amount_minor = -100 WHERE id = (SELECT MIN(id) FROM reservations);


-- ----- 14. TRANSACTION'I ELLE GÖR (iki DBeaver oturumu gerekir) ---------------
-- HAZIRLIK: DBeaver'da AYNI veritabanına İKİNCİ bir SQL Editor sekmesi aç
-- (SQL Editor > New SQL Editor). DBeaver her sekmeye ayrı bağlantı verir.
-- Otomatik commit'i KAPAT: araç çubuğundaki "Auto" düğmesi -> Manual Commit.

-- 14.1 [OTURUM A] Transaction başlat ve bir satırı kilitle - COMMIT ETME.
BEGIN;
UPDATE facilities SET capacity = capacity + 1 WHERE id = 1;
-- Buraya kadar çalıştır ve DUR. Satır artık A'nın kilidinde.

-- 14.2 [OTURUM B] Aynı satırı güncellemeyi dene -> BEKLER (spinner döner).
--      Bu bekleme, kilidin gerçek olduğunun kanıtıdır.
UPDATE facilities SET capacity = capacity + 100 WHERE id = 1;

-- 14.3 [OTURUM A ya da ÜÇÜNCÜ bir sekme] Kim kimi bekliyor? Kilidi GÖR.
SELECT bekleyen.pid       AS bekleyen_pid,
       bekleyen.query     AS bekleyen_sorgu,
       engelleyen.pid     AS engelleyen_pid,
       engelleyen.query   AS engelleyen_sorgu,
       bekleyen.wait_event_type, bekleyen.wait_event
FROM pg_stat_activity bekleyen
JOIN pg_stat_activity engelleyen ON engelleyen.pid = ANY(pg_blocking_pids(bekleyen.pid))
WHERE cardinality(pg_blocking_pids(bekleyen.pid)) > 0;

-- 14.4 Açık transaction'lar ve ne kadardır açık oldukları
SELECT pid, state, now() - xact_start AS transaction_suresi, left(query, 60) AS son_sorgu
FROM pg_stat_activity
WHERE xact_start IS NOT NULL AND datname = current_database()
ORDER BY xact_start;

-- 14.5 [OTURUM A] Geri al -> B'nin beklemesi ANINDA biter ve B'nin güncellemesi uygulanır.
ROLLBACK;
-- ROLLBACK ile A'nın +1'i hiç olmamış gibi kayboldu. "Ya hep ya hiç" (atomiklik) budur.

-- 14.6 İzolasyon seviyesini gör / değiştir
SHOW default_transaction_isolation;                  -- read committed (PostgreSQL varsayılanı)
BEGIN ISOLATION LEVEL SERIALIZABLE;
SHOW transaction_isolation;                          -- serializable
ROLLBACK;
-- Uygulamanın rezervasyon transaction'ı SERIALIZABLE kullanıyor (backend/database.js).
-- Neden gerekli olduğu: node backend/test-concurrency.js


-- ----- 15. TÜRETİLMİŞ VERİ: rollup gerçekten türetilmiş mi? -------------------
-- DDIA Böl. 11: türetilmiş veri her an kaynaktan yeniden üretilebilmelidir.
-- Bunu KANITLAYALIM: rollup'ı sil, canlı sorgu etkilenmiyor, sonra yeniden kur, aynı sayı gelsin.

-- 15.1 Şu anki durum: rollup ile canlı sorgu aynı mı?
SELECT 'canli' AS kaynak, COALESCE(SUM(amount_minor),0)::bigint AS ciro_kurus
FROM reservations WHERE status <> 'cancelled'
UNION ALL
SELECT 'rollup', COALESCE(SUM(revenue_minor),0)::bigint FROM daily_stats;

-- 15.2 Rollup'ı TAMAMEN SİL (korkma - türetilmiş veri, kaynak duruyor)
DELETE FROM daily_stats;
SELECT COUNT(*) AS kalan_rollup_satiri FROM daily_stats;   -- 0

-- 15.3 Canlı sorgu HÂLÂ doğru cevabı veriyor (kaynağa bakıyor, rollup'a değil)
SELECT COALESCE(SUM(amount_minor),0)::bigint AS canli_ciro_kurus
FROM reservations WHERE status <> 'cancelled';

-- 15.4 Rollup'ı yeniden kur (terminalden):
--     node -e "require('./backend/analytics').rebuildDailyStats().then(n=>console.log(n))"
-- Sonra 15.1'i tekrar çalıştır: iki satır yine AYNI sayıyı vermeli.

-- 15.5 Aynı ders, doluluk için: `manual_occupancy` SAKLANAN, gerçek doluluk TÜRETİLEN.
SELECT f.kod, f.ad,
       f.manual_occupancy AS elle_girilen_isaret,
       COALESCE(SUM(r.guests) FILTER (WHERE r.status <> 'cancelled'), 0) AS bugun_rezerve_koltuk,
       LEAST(100, ROUND(COALESCE(SUM(r.guests) FILTER (WHERE r.status <> 'cancelled'),0) * 100.0 / f.capacity))::int
         AS gercek_doluluk_yuzde
FROM facilities f
LEFT JOIN reservations r ON r.facility_id = f.id AND r.reserve_date = CURRENT_DATE
GROUP BY f.id, f.kod, f.ad, f.manual_occupancy, f.capacity
ORDER BY f.id;


-- ----- 16. ŞEMAYI SORGULAYARAK KEŞFET ----------------------------------------
-- DBeaver'ın sol ağaçta gösterdiği her şey aslında SORGULANABİLİR veridir.
-- PostgreSQL kendi yapısını da tablolarda tutar (information_schema / pg_catalog).

-- 16.1 Bu şemadaki tablolar ve satır sayısı tahminleri
SELECT c.relname AS tablo,
       c.reltuples::bigint AS tahmini_satir,   -- planlayıcının istatistiği (ANALYZE ile tazelenir)
       pg_size_pretty(pg_total_relation_size(c.oid)) AS disk_boyutu
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = current_schema() AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC;

-- 16.2 Bir tablonun kolonları (DBeaver'ın "Columns" sekmesinin SQL karşılığı)
SELECT ordinal_position AS sira, column_name AS kolon, data_type AS tip,
       is_nullable AS bos_olabilir, column_default AS varsayilan
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = 'reservations'
ORDER BY ordinal_position;

-- 16.3 TÜM kısıtlar: hangi kural nerede yazılı?
-- p=birincil anahtar, f=yabancı anahtar, u=benzersiz, c=CHECK
SELECT rel.relname AS tablo, con.conname AS kisit_adi,
       CASE con.contype WHEN 'p' THEN 'BİRİNCİL ANAHTAR' WHEN 'f' THEN 'YABANCI ANAHTAR'
                        WHEN 'u' THEN 'BENZERSİZ' WHEN 'c' THEN 'CHECK' ELSE con.contype::text END AS tur,
       pg_get_constraintdef(con.oid) AS tanim
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = current_schema()
ORDER BY rel.relname, con.contype;

-- 16.4 İndeksler: hangi sorgu için hangi indeks + kaç kez kullanıldı?
-- idx_scan = bu indeks kaç kez kullanıldı. 0 ise ya sorgu hiç koşmadı ya indeks gereksiz.
SELECT i.indexrelname AS indeks, i.relname AS tablo,
       i.idx_scan AS kullanim_sayisi,
       pg_size_pretty(pg_relation_size(i.indexrelid)) AS boyut,
       pg_get_indexdef(i.indexrelid) AS tanim
FROM pg_stat_user_indexes i
JOIN pg_namespace n ON n.oid = (SELECT relnamespace FROM pg_class WHERE oid = i.relid)
WHERE n.nspname = current_schema()
ORDER BY i.idx_scan DESC;

-- 16.5 PostGIS geometri kolonları (hangi tabloda hangi geometri tipi, hangi SRID)
SELECT f_table_name AS tablo, f_geometry_column AS kolon, type AS geometri_tipi,
       srid, coord_dimension AS boyut
FROM geometry_columns
WHERE f_table_schema = current_schema();

-- 16.6 Yabancı anahtar ilişkileri (DBeaver'ın ER diyagramında çizdiği okların kaynağı)
SELECT src.relname AS kaynak_tablo, a.attname AS kaynak_kolon,
       tgt.relname AS hedef_tablo,
       CASE con.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'a' THEN 'NO ACTION'
                            WHEN 'r' THEN 'RESTRICT' WHEN 'n' THEN 'SET NULL' END AS silinince
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = ANY(con.conkey)
JOIN pg_namespace n ON n.oid = src.relnamespace
WHERE con.contype = 'f' AND n.nspname = current_schema()
ORDER BY src.relname;

-- 16.7 Uygulanmış migration'lar (şema evriminin tarihçesi)
SELECT version, applied_at FROM schema_migrations ORDER BY version;

-- 16.8 Veritabanı ve eklenti sürümleri (sunumda "ne kullanıyorsun" sorusuna tek cevap)
SELECT version() AS postgresql, postgis_version() AS postgis, current_database() AS veritabani,
       current_schema() AS aktif_sema, current_user AS kullanici;
