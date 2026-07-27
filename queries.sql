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
