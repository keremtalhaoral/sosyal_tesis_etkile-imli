/**
 * analytics.js - Analitik sorgular + rollup (Faz v2-04, ADR-004).
 *
 * DDIA Böl. 3 (OLTP vs OLAP): işlemsel yazma (rezervasyon) çok/küçük; analitik okuma
 * (dashboard) az/ağır (tüm geçmişi tarayan agregasyonlar). Bu modül CANLI sorgularla
 * çalışır; daily_stats ROLLUP'ı ise aynı sonucu türetilmiş veriden üretir (test parity ile
 * doğrulanır). Rollup türetilmiş veridir: kaynaktan (reservations/orders) yeniden hesaplanır.
 */

const { getDb } = require('./database');

const NOT_CANCELLED = "status != 'cancelled'";

// Granülerliğe göre tarih grup anahtarı (SQLite tarih fonksiyonları; reserve_date = 'YYYY-MM-DD')
const dateBucket = (granularity, col = 'reserve_date') => {
  switch (granularity) {
    case 'day':   return col;
    case 'week':  return `strftime('%Y-W%W', ${col})`;
    case 'month': return `substr(${col}, 1, 7)`;
    case 'year':  return `substr(${col}, 1, 4)`;
    default:      return `substr(${col}, 1, 7)`; // ay varsayılan
  }
};

// --- KPI özeti --------------------------------------------------------------
const kpiSummary = () => {
  const db = getDb();
  const r = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN ${NOT_CANCELLED} THEN amount_minor ELSE 0 END), 0) AS revenue_minor,
      COUNT(CASE WHEN ${NOT_CANCELLED} THEN 1 END) AS reservations,
      COALESCE(SUM(CASE WHEN ${NOT_CANCELLED} THEN guests ELSE 0 END), 0) AS guests,
      COALESCE(SUM(CASE WHEN ${NOT_CANCELLED} THEN highchair_count ELSE 0 END), 0) AS highchairs,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled,
      COUNT(*) AS total_rows
    FROM reservations
  `).get();
  const avgGroup = r.reservations ? r.guests / r.reservations : 0;
  const cancelRate = r.total_rows ? r.cancelled / r.total_rows : 0;
  return {
    revenue_minor: r.revenue_minor,
    reservations: r.reservations,
    guests: r.guests,
    avg_group_size: Math.round(avgGroup * 100) / 100,
    highchairs: r.highchairs,
    cancellation_rate: Math.round(cancelRate * 1000) / 1000
  };
};

// --- Ciro zaman serisi (canlı) ---------------------------------------------
const revenueTimeSeries = (granularity = 'month') => {
  const bucket = dateBucket(granularity);
  return getDb().prepare(`
    SELECT ${bucket} AS bucket,
           SUM(amount_minor) AS revenue_minor,
           COUNT(*) AS reservations,
           SUM(guests) AS guests
    FROM reservations WHERE ${NOT_CANCELLED}
    GROUP BY bucket ORDER BY bucket
  `).all();
};

// --- Doluluk ısı haritası: haftanın günü (0=Paz) × slot ---------------------
const occupancyHeatmap = () =>
  getDb().prepare(`
    SELECT CAST(strftime('%w', reserve_date) AS INTEGER) AS dow,
           reserve_time AS slot,
           SUM(guests) AS guests,
           COUNT(*) AS reservations
    FROM reservations WHERE ${NOT_CANCELLED}
    GROUP BY dow, slot
  `).all();

// --- Tesis karşılaştırma (ciro/rezervasyon) --------------------------------
const topFacilities = (metric = 'revenue', limit = 10) => {
  const order = metric === 'reservations' ? 'reservations DESC' : 'revenue_minor DESC';
  return getDb().prepare(`
    SELECT f.id, f.ad AS name,
           COALESCE(SUM(r.amount_minor), 0) AS revenue_minor,
           COUNT(r.id) AS reservations
    FROM facilities f
    LEFT JOIN reservations r ON r.facility_id = f.id AND r.${NOT_CANCELLED}
    GROUP BY f.id ORDER BY ${order} LIMIT ?
  `).all(limit);
};

// --- Ödeme tipi kırılımı ----------------------------------------------------
const paymentBreakdown = () =>
  getDb().prepare(`
    SELECT COALESCE(payment_type, 'bilinmiyor') AS payment_type,
           COUNT(*) AS reservations, SUM(amount_minor) AS revenue_minor
    FROM reservations WHERE ${NOT_CANCELLED}
    GROUP BY payment_type ORDER BY reservations DESC
  `).all();

// --- Bebe sandalyesi trendi -------------------------------------------------
const highchairTrend = (granularity = 'month') => {
  const bucket = dateBucket(granularity);
  return getDb().prepare(`
    SELECT ${bucket} AS bucket,
           SUM(highchair_count) AS highchairs,
           COUNT(CASE WHEN highchair_count > 0 THEN 1 END) AS reservations_with_highchair,
           COUNT(*) AS reservations
    FROM reservations WHERE ${NOT_CANCELLED}
    GROUP BY bucket ORDER BY bucket
  `).all();
};

// --- İptal oranı trendi -----------------------------------------------------
const cancellationRate = (granularity = 'month') => {
  const bucket = dateBucket(granularity);
  return getDb().prepare(`
    SELECT ${bucket} AS bucket,
           COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled,
           COUNT(*) AS total
    FROM reservations
    GROUP BY bucket ORDER BY bucket
  `).all();
};

// --- Menü kategori satış kırılımı ------------------------------------------
const categorySales = () =>
  getDb().prepare(`
    SELECT m.category AS category,
           SUM(oi.quantity) AS quantity,
           SUM(oi.quantity * oi.unit_price_minor) AS revenue_minor
    FROM order_items oi
    JOIN menu_items m ON m.id = oi.menu_item_id
    GROUP BY m.category ORDER BY revenue_minor DESC
  `).all();

// ---------------------------------------------------------------------------
// ROLLUP: daily_stats'ı kaynaktan yeniden inşa et (idempotent, batch transaction)
// ---------------------------------------------------------------------------
const rebuildDailyStats = () => {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM daily_stats');
    // Rezervasyon bazlı günlük agregasyon (iptal ayrı sayılır)
    db.exec(`
      INSERT INTO daily_stats (stat_date, facility_id, revenue_minor, reservation_count, guest_count, highchair_count, cancelled_count, order_count)
      SELECT reserve_date, facility_id,
             SUM(CASE WHEN ${NOT_CANCELLED} THEN amount_minor ELSE 0 END),
             COUNT(CASE WHEN ${NOT_CANCELLED} THEN 1 END),
             SUM(CASE WHEN ${NOT_CANCELLED} THEN guests ELSE 0 END),
             SUM(CASE WHEN ${NOT_CANCELLED} THEN highchair_count ELSE 0 END),
             COUNT(CASE WHEN status = 'cancelled' THEN 1 END),
             0
      FROM reservations GROUP BY reserve_date, facility_id
    `);
    // Sipariş sayısını ekle (order -> reservation -> gün/tesis)
    db.exec(`
      UPDATE daily_stats SET order_count = COALESCE((
        SELECT COUNT(*) FROM orders o
        JOIN reservations r ON r.id = o.reservation_id
        WHERE r.reserve_date = daily_stats.stat_date AND r.facility_id = daily_stats.facility_id
      ), 0)
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getDb().prepare('SELECT COUNT(*) AS n FROM daily_stats').get().n;
};

// Aynı ciro zaman serisi ROLLUP'tan (hızlı okuma)
const revenueFromRollup = (granularity = 'month') => {
  const bucket = dateBucket(granularity, 'stat_date');
  return getDb().prepare(`
    SELECT ${bucket} AS bucket,
           SUM(revenue_minor) AS revenue_minor,
           SUM(reservation_count) AS reservations,
           SUM(guest_count) AS guests
    FROM daily_stats GROUP BY bucket ORDER BY bucket
  `).all();
};

// Dashboard için tüm bloklar tek payload (granularity ciro/highchair/iptal için)
const dashboard = (granularity = 'month') => ({
  generated_at: new Date().toISOString(),
  granularity,
  kpi: kpiSummary(),
  revenue: revenueTimeSeries(granularity),
  occupancy_heatmap: occupancyHeatmap(),
  top_facilities: topFacilities('revenue', 10),
  payments: paymentBreakdown(),
  highchair: highchairTrend(granularity),
  cancellations: cancellationRate(granularity),
  category_sales: categorySales()
});

module.exports = {
  kpiSummary, revenueTimeSeries, occupancyHeatmap, topFacilities, paymentBreakdown,
  highchairTrend, cancellationRate, categorySales,
  rebuildDailyStats, revenueFromRollup, dashboard
};
