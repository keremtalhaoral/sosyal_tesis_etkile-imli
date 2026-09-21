-- =============================================================================
-- queries.sql — Projenin her özelliğini gösteren çalıştırılabilir SQL sorguları
-- =============================================================================
-- Kullanım: DBeaver'da data/app.db'yi bağla ve sorguları tek tek çalıştır
--          (ya da: sqlite3 data/app.db < queries.sql).
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

-- 1.2 Tesis listesi (kapasite + doluluk)
SELECT kod, ad, capacity AS kapasite, occupancy AS doluluk_yuzde, lat, lng
FROM facilities ORDER BY capacity DESC;

-- ----- 2. MEKANSAL / CBS (Haversine; PostGIS karşılıkları docs'ta) ------------

-- 2.1 En yakın 3 tesis (KNN), Taksim'den (41.0369, 28.9850)
SELECT kod, ad,
  ROUND(6371 * acos(MIN(1,
    cos(radians(41.0369)) * cos(radians(lat)) * cos(radians(lng) - radians(28.9850)) +
    sin(radians(41.0369)) * sin(radians(lat))
  )), 2) AS km
FROM facilities ORDER BY km ASC LIMIT 3;

-- 2.2 İki tesis arası mesafe
SELECT a.ad AS tesis_a, b.ad AS tesis_b,
  ROUND(6371 * acos(MIN(1,
    cos(radians(a.lat))*cos(radians(b.lat))*cos(radians(b.lng)-radians(a.lng)) +
    sin(radians(a.lat))*sin(radians(b.lat))
  )), 2) AS km
FROM facilities a JOIN facilities b ON b.id > a.id
WHERE a.kod = 'ALTY-01' AND b.kod = 'ALTY-08';

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
SELECT CAST(strftime('%w', reserve_date) AS INTEGER) AS gun_0paz,
       reserve_time AS slot, SUM(guests) AS misafir
FROM reservations WHERE status != 'cancelled'
GROUP BY gun_0paz, slot ORDER BY misafir DESC;

-- ----- 5. SİPARİŞ & FİYAT SNAPSHOT (ADR-001/005) -----------------------------

-- 5.1 Sipariş toplamı = kalem snapshot toplamı (boş dönmeli = tutarlı)
SELECT o.id AS siparis, o.total_minor AS kayitli_toplam,
       SUM(oi.quantity * oi.unit_price_minor) AS kalemlerden_toplam
FROM orders o JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id HAVING kayitli_toplam <> kalemlerden_toplam LIMIT 5;

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
FROM reservations WHERE status != 'cancelled';

-- 6.2 Aylık ciro zaman serisi
SELECT substr(reserve_date, 1, 7) AS ay, ROUND(SUM(amount_minor)/100.0, 2) AS ciro_TL, COUNT(*) AS rez
FROM reservations WHERE status != 'cancelled' GROUP BY ay ORDER BY ay DESC;

-- 6.3 Ödeme tipi kırılımı
SELECT COALESCE(payment_type, 'bilinmiyor') AS odeme, COUNT(*) AS rez,
       ROUND(SUM(amount_minor)/100.0, 2) AS ciro_TL
FROM reservations WHERE status != 'cancelled' GROUP BY payment_type ORDER BY rez DESC;

-- 6.4 İptal oranı
SELECT COUNT(*) AS toplam,
       SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS iptal,
       ROUND(100.0*SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END)/COUNT(*), 2) AS iptal_yuzde
FROM reservations;

-- 6.5 Mama sandalyesi trendi
SELECT substr(reserve_date,1,7) AS ay, SUM(highchair_count) AS mama,
       COUNT(CASE WHEN highchair_count > 0 THEN 1 END) AS mama_isteyen_rez
FROM reservations WHERE status != 'cancelled' GROUP BY ay ORDER BY ay DESC;

-- 6.6 Top tesisler (ciro)
SELECT f.kod, f.ad, ROUND(SUM(r.amount_minor)/100.0, 2) AS ciro_TL, COUNT(r.id) AS rez
FROM facilities f LEFT JOIN reservations r ON r.facility_id = f.id AND r.status != 'cancelled'
GROUP BY f.id ORDER BY ciro_TL DESC LIMIT 10;

-- ----- 7. ROLLUP vs CANLI (türetilmiş veri, OLAP) ----------------------------
-- Önce: node -e "require('./backend/analytics').rebuildDailyStats()"

-- 7.1a CANLI aylık ciro
SELECT substr(reserve_date,1,7) AS ay, SUM(amount_minor) AS ciro
FROM reservations WHERE status != 'cancelled' GROUP BY ay ORDER BY ay DESC LIMIT 3;
-- 7.1b ROLLUP aylık ciro (aynı sonuç, daha hızlı)
SELECT substr(stat_date,1,7) AS ay, SUM(revenue_minor) AS ciro
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
SELECT username, substr(password, 1, 28) AS hash_onek FROM users LIMIT 5;

-- 9.2 Rol dağılımı
SELECT role AS rol, COUNT(*) AS adet FROM users GROUP BY role;

-- 9.3 Audit log (son işlemler + aktör)
SELECT a.created_at, u.username AS aktor, a.action, a.entity_type, a.entity_id, a.detail
FROM audit_log a JOIN users u ON u.id = a.actor_user_id ORDER BY a.created_at DESC LIMIT 20;

-- ----- 10. KAPASİTE & BÜYÜK VERİ (DDIA Böl. 3) -------------------------------

-- 10.1 İndeksli sorgu planı (noktasal)
EXPLAIN QUERY PLAN
SELECT SUM(guests) FROM reservations
WHERE facility_id = 1 AND reserve_date = '2026-06-01' AND reserve_time = '19:00';

-- 10.2 İndekssiz sütun (tam tarama)
EXPLAIN QUERY PLAN
SELECT COUNT(*) FROM reservations WHERE crypto_signature = 'generated';

-- 10.3 Ağır agregasyon (DBeaver alt barda süreyi gösterir)
SELECT substr(reserve_date,1,7) AS ay, SUM(amount_minor) AS ciro, COUNT(*) AS rez
FROM reservations WHERE status != 'cancelled' GROUP BY ay ORDER BY ay DESC;
