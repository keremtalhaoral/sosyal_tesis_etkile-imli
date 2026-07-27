/**
 * analytics.js - Analitik sorgular + rollup (ADR-004).
 *
 * DDIA Böl. 3 (OLTP vs OLAP): işlemsel yazma (rezervasyon) çok/küçük; analitik okuma
 * (dashboard) az/ağır (tüm geçmişi tarayan agregasyonlar). Bu modül CANLI sorgularla
 * çalışır; daily_stats ROLLUP'ı ise aynı sonucu türetilmiş veriden üretir (test parity ile
 * doğrulanır). Rollup türetilmiş veridir: kaynaktan (reservations/orders) yeniden hesaplanır.
 *
 * PostgreSQL geçişinde (ADR-009) tarih gruplaması strftime/substr yerine to_char ile yapılır;
 * artık reserve_date GERÇEK bir date kolonu olduğu için bunlar string kesme değil, takvim
 * bilen fonksiyonlar. Hafta numarası ISO-8601 (IYYY-IW) - yılın son günleri gelecek yılın
 * 1. haftasına düşebilir; SQLite'ın %W'si bunu bilmiyordu.
 */

const { db, transaction } = require('./database');

const NOT_CANCELLED = "status <> 'cancelled'";

// PARA TOPLAMLARI ::bigint OLMALI. amount_minor KURUŞ cinsindendir; int4 üst sınırı
// 2.147.483.647 kuruş = yalnız ~21,5 milyon TL. Tek yıllık üretilmiş veri bile bunu aşıyor
// ve PostgreSQL sessizce yanlış sonuç vermek yerine 22003 (out of range) fırlatıyor.
// Aynı sebeple guests/quantity toplamları da bigint. Dönen değer JS Number'a çevrilir
// (database.js INT8 parser'ı); 2^53 sınırı bu ölçek için fazlasıyla yeterli.

// Granülerliğe göre tarih grup anahtarı
const dateBucket = (granularity, col = 'reserve_date') => {
  switch (granularity) {
    case 'day':   return `to_char(${col}, 'YYYY-MM-DD')`;
    case 'week':  return `to_char(${col}, 'IYYY-"W"IW')`;
    case 'month': return `to_char(${col}, 'YYYY-MM')`;
    case 'year':  return `to_char(${col}, 'YYYY')`;
    default:      return `to_char(${col}, 'YYYY-MM')`; // ay varsayılan
  }
};

// --- KPI özeti --------------------------------------------------------------
const kpiSummary = async () => {
  const r = await db().one(`
    SELECT
      COALESCE(SUM(amount_minor) FILTER (WHERE ${NOT_CANCELLED}), 0)::bigint AS revenue_minor,
      COUNT(*) FILTER (WHERE ${NOT_CANCELLED})::int AS reservations,
      COALESCE(SUM(guests) FILTER (WHERE ${NOT_CANCELLED}), 0)::bigint AS guests,
      COALESCE(SUM(highchair_count) FILTER (WHERE ${NOT_CANCELLED}), 0)::bigint AS highchairs,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
      COUNT(*)::int AS total_rows
    FROM reservations
  `);
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
const revenueTimeSeries = (granularity = 'month') =>
  db().all(`
    SELECT ${dateBucket(granularity)} AS bucket,
           SUM(amount_minor)::bigint AS revenue_minor,
           COUNT(*)::int AS reservations,
           SUM(guests)::bigint AS guests
    FROM reservations WHERE ${NOT_CANCELLED}
    GROUP BY bucket ORDER BY bucket
  `);

// --- Doluluk ısı haritası: haftanın günü (0=Paz) × slot ---------------------
const occupancyHeatmap = () =>
  db().all(`
    SELECT EXTRACT(DOW FROM reserve_date)::int AS dow,
           to_char(reserve_time, 'HH24:MI') AS slot,
           SUM(guests)::bigint AS guests,
           COUNT(*)::int AS reservations
    FROM reservations WHERE ${NOT_CANCELLED}
    GROUP BY dow, slot ORDER BY dow, slot
  `);

// --- Tesis karşılaştırma (ciro/rezervasyon) --------------------------------
const topFacilities = (metric = 'revenue', limit = 10) => {
  const order = metric === 'reservations' ? 'reservations DESC' : 'revenue_minor DESC';
  return db().all(`
    SELECT f.id, f.ad AS name,
           COALESCE(SUM(r.amount_minor), 0)::bigint AS revenue_minor,
           COUNT(r.id)::int AS reservations
    FROM facilities f
    LEFT JOIN reservations r ON r.facility_id = f.id AND r.${NOT_CANCELLED}
    GROUP BY f.id, f.ad ORDER BY ${order} LIMIT $1
  `, [Math.max(1, Math.min(100, Number(limit) || 10))]);
};

// --- Ödeme tipi kırılımı ----------------------------------------------------
const paymentBreakdown = () =>
  db().all(`
    SELECT COALESCE(payment_type, 'bilinmiyor') AS payment_type,
           COUNT(*)::int AS reservations, SUM(amount_minor)::bigint AS revenue_minor
    FROM reservations WHERE ${NOT_CANCELLED}
    GROUP BY payment_type ORDER BY reservations DESC
  `);

// --- Bebe sandalyesi trendi -------------------------------------------------
const highchairTrend = (granularity = 'month') =>
  db().all(`
    SELECT ${dateBucket(granularity)} AS bucket,
           SUM(highchair_count)::bigint AS highchairs,
           COUNT(*) FILTER (WHERE highchair_count > 0)::int AS reservations_with_highchair,
           COUNT(*)::int AS reservations
    FROM reservations WHERE ${NOT_CANCELLED}
    GROUP BY bucket ORDER BY bucket
  `);

// --- İptal oranı trendi -----------------------------------------------------
const cancellationRate = (granularity = 'month') =>
  db().all(`
    SELECT ${dateBucket(granularity)} AS bucket,
           COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
           COUNT(*)::int AS total
    FROM reservations
    GROUP BY bucket ORDER BY bucket
  `);

// --- Menü kategori satış kırılımı ------------------------------------------
// İptal edilen SİPARİŞLERİN kalemleri hariç: rezervasyon bazlı ciro (kpiSummary/
// revenueTimeSeries) iptalleri düşüyor; burada düşmezsek aynı iptal bir raporda var,
// diğerinde yok olur.
const categorySales = () =>
  db().all(`
    SELECT m.category AS category,
           SUM(oi.quantity)::bigint AS quantity,
           SUM(oi.quantity * oi.unit_price_minor)::bigint AS revenue_minor
    FROM order_items oi
    JOIN menu_items m ON m.id = oi.menu_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.${NOT_CANCELLED}
    GROUP BY m.category ORDER BY revenue_minor DESC
  `);

// ---------------------------------------------------------------------------
// ROLLUP: daily_stats'ı kaynaktan yeniden inşa et (idempotent, tek transaction)
// ---------------------------------------------------------------------------
/**
 * İzolasyon seçimi bilinçli: SERIALIZABLE DEĞİL, REPEATABLE READ.
 * Bu bir toplu yeniden-inşa işi; tüm reservations/orders tablosunu okur. SERIALIZABLE
 * altında eşzamanlı her rezervasyonla çakışıp sürekli 40001 alıp yeniden denerdi.
 * REPEATABLE READ tutarlı TEK bir snapshot verir - bize gereken tam olarak bu; daily_stats'a
 * başka hiçbir yazıcı dokunmadığı için güncelleme çakışması da olamaz. (DDIA Böl. 7.1)
 */
const rebuildDailyStats = () =>
  transaction(async (tx) => {
    await tx.run('DELETE FROM daily_stats');
    // Rezervasyon bazlı günlük agregasyon (iptal ayrı sayılır)
    await tx.run(`
      INSERT INTO daily_stats (stat_date, facility_id, revenue_minor, reservation_count, guest_count, highchair_count, cancelled_count, order_count)
      SELECT reserve_date, facility_id,
             COALESCE(SUM(amount_minor) FILTER (WHERE ${NOT_CANCELLED}), 0),
             COUNT(*) FILTER (WHERE ${NOT_CANCELLED}),
             COALESCE(SUM(guests) FILTER (WHERE ${NOT_CANCELLED}), 0),
             COALESCE(SUM(highchair_count) FILTER (WHERE ${NOT_CANCELLED}), 0),
             COUNT(*) FILTER (WHERE status = 'cancelled'),
             0
      FROM reservations GROUP BY reserve_date, facility_id
    `);
    // Sipariş sayısını ekle (order -> reservation -> gün/tesis). İptal edilen siparişler
    // sayılmaz - revenue_minor da onları içermiyor, iki metrik aynı evreni anlatmalı.
    await tx.run(`
      UPDATE daily_stats ds SET order_count = COALESCE((
        SELECT COUNT(*) FROM orders o
        JOIN reservations r ON r.id = o.reservation_id
        WHERE r.reserve_date = ds.stat_date AND r.facility_id = ds.facility_id
          AND o.${NOT_CANCELLED}
      ), 0)
    `);
    const { n } = await tx.one('SELECT COUNT(*)::int AS n FROM daily_stats');
    return n;
  }, { isolation: 'REPEATABLE READ' });

// Aynı ciro zaman serisi ROLLUP'tan (hızlı okuma)
const revenueFromRollup = (granularity = 'month') =>
  db().all(`
    SELECT ${dateBucket(granularity, 'stat_date')} AS bucket,
           SUM(revenue_minor)::bigint AS revenue_minor,
           SUM(reservation_count)::int AS reservations,
           SUM(guest_count)::bigint AS guests
    FROM daily_stats GROUP BY bucket ORDER BY bucket
  `);

// Dashboard için tüm bloklar tek payload (granularity ciro/highchair/iptal için).
// Bloklar birbirinden bağımsız → paralel koşar (havuzda birden fazla bağlantı var).
const dashboard = async (granularity = 'month') => {
  const [kpi, revenue, occupancy_heatmap, top_facilities, payments, highchair, cancellations, category_sales] =
    await Promise.all([
      kpiSummary(),
      revenueTimeSeries(granularity),
      occupancyHeatmap(),
      topFacilities('revenue', 10),
      paymentBreakdown(),
      highchairTrend(granularity),
      cancellationRate(granularity),
      categorySales()
    ]);
  return {
    generated_at: new Date().toISOString(),
    granularity,
    kpi, revenue, occupancy_heatmap, top_facilities, payments, highchair, cancellations, category_sales
  };
};

module.exports = {
  kpiSummary, revenueTimeSeries, occupancyHeatmap, topFacilities, paymentBreakdown,
  highchairTrend, cancellationRate, categorySales,
  rebuildDailyStats, revenueFromRollup, dashboard
};
