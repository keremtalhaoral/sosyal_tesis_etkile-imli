/**
 * test-analytics.js - Analytics motoru testleri (ADR-004).
 * Bilinen küçük veri kümesiyle: KPI doğru, granülerlik gruplaması doğru, iptal hariç,
 * ve en önemlisi ROLLUP == CANLI (türetilmiş veri kaynağıyla tutarlı).
 * Çalıştırma: node backend/test-analytics.js (izole şema).
 */
const t = require('./test-helper').setup('analytics');
const { assert } = t;

const analytics = require('./analytics');
const db = require('./db');

(async () => {
  const conn = await t.init();
  const user = await db.getUserByUsername('user');

  // Bilinen veri: facility 1. 3 onaylı + 1 iptal, farklı aylar.
  const ins = (date, time, guests, hc, status, amount, pay) => conn.run(`
    INSERT INTO reservations
      (user_id, facility_id, reserve_date, reserve_time, guests, highchair_count, status, amount_minor, payment_type, crypto_signature)
    VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, 't')`,
    [user.id, date, time, guests, hc, status, amount, pay]);

  await ins('2026-01-10', '19:00', 4, 1, 'confirmed', 10000, 'card');
  await ins('2026-01-20', '13:00', 2, 0, 'confirmed', 5000, 'cash');
  await ins('2026-02-05', '19:00', 3, 1, 'confirmed', 8000, 'online');
  await ins('2026-02-06', '19:00', 5, 0, 'cancelled', 99999, 'card'); // iptal: cirodan HARİÇ

  // 1. KPI: ciro sadece onaylılardan (10000+5000+8000 = 23000)
  const kpi = await analytics.kpiSummary();
  assert('kpi: ciro iptal hariç (23000)', kpi.revenue_minor === 23000);
  assert('kpi: rezervasyon sayısı onaylı (3)', kpi.reservations === 3);
  assert('kpi: ort. grup büyüklüğü (9 misafir / 3 = 3)', kpi.avg_group_size === 3);
  assert('kpi: iptal oranı (1/4 = 0.25)', kpi.cancellation_rate === 0.25);
  assert('kpi: bebe sandalyesi toplam (2)', kpi.highchairs === 2);

  // 2. Aylık ciro serisi (to_char ile YYYY-MM gruplaması)
  const monthly = await analytics.revenueTimeSeries('month');
  assert('aylık: 2 ay (2026-01, 2026-02)', monthly.length === 2);
  assert('aylık: Ocak cirosu 15000', monthly.find(m => m.bucket === '2026-01').revenue_minor === 15000);
  assert('aylık: Şubat cirosu 8000 (iptal hariç)', monthly.find(m => m.bucket === '2026-02').revenue_minor === 8000);

  // 3. Yıllık + günlük + haftalık gruplama
  const yearly = await analytics.revenueTimeSeries('year');
  assert('yıllık: tek yıl (2026) toplam 23000', yearly.length === 1 && yearly[0].revenue_minor === 23000);
  const daily = await analytics.revenueTimeSeries('day');
  assert('günlük: 3 farklı gün, bucket YYYY-MM-DD biçiminde',
    daily.length === 3 && /^\d{4}-\d{2}-\d{2}$/.test(daily[0].bucket));
  const weekly = await analytics.revenueTimeSeries('week');
  assert('haftalık: ISO hafta biçimi (IYYY-Www)', weekly.every(w => /^\d{4}-W\d{2}$/.test(w.bucket)));

  // 4. Ödeme kırılımı (card: 1 onaylı 10000 — iptal card HARİÇ)
  const pay = await analytics.paymentBreakdown();
  const card = pay.find(p => p.payment_type === 'card');
  assert('ödeme: card yalnız onaylı (1 rez, 10000)', card.reservations === 1 && card.revenue_minor === 10000);

  // 5. ROLLUP == CANLI (en kritik: türetilmiş veri kaynakla tutarlı)
  const n = await analytics.rebuildDailyStats();
  assert('rollup: daily_stats dolduruldu', n >= 1);
  const live = await analytics.revenueTimeSeries('month');
  const roll = await analytics.revenueFromRollup('month');
  assert('rollup == canlı (aylık ciro birebir)',
    JSON.stringify(live.map(x => [x.bucket, x.revenue_minor, x.reservations]))
    === JSON.stringify(roll.map(x => [x.bucket, x.revenue_minor, x.reservations])));
  const rollTotal = (await conn.one('SELECT SUM(revenue_minor)::int AS s FROM daily_stats')).s;
  assert('rollup: toplam ciro canlı KPI ile eşit', rollTotal === (await analytics.kpiSummary()).revenue_minor);

  // 6. Isı haritası: 19:00 slotunda 2 onaylı rezervasyon (iptal hariç)
  const heat = await analytics.occupancyHeatmap();
  const at19 = heat.filter(h => h.slot === '19:00').reduce((s, h) => s + h.reservations, 0);
  assert('heatmap: 19:00 slotunda 2 onaylı (iptal hariç)', at19 === 2);
  assert('heatmap: dow 0-6 arası tamsayı', heat.every(h => Number.isInteger(h.dow) && h.dow >= 0 && h.dow <= 6));

  // 7. İPTAL EDİLEN SİPARİŞ kategori cirosuna girmemeli (H1'in analytics ayağı).
  // Rezervasyon bazlı ciro iptalleri düşüyor; categorySales de düşmezse aynı iptal
  // bir raporda var, diğerinde yok olur.
  const resv = await db.createReservation({
    userId: user.id, facilityId: 1, reserveDate: '2027-06-01', reserveTime: '19:00', guests: 2, cryptoSignature: 'c'
  });
  const menu = await db.getMenu(1);
  const order = await db.createOrder({ userId: user.id, reservationId: resv.id, paymentType: 'card', items: [{ menuItemId: menu[0].id, quantity: 2 }] });
  const catBefore = (await analytics.categorySales()).reduce((s, c) => s + c.revenue_minor, 0);
  assert('kategori: aktif siparişin kalemleri sayılıyor', catBefore === order.total_minor);

  const staff = await db.createUser('analytics_staff', 'p', 'admin');
  await db.updateOrderStatus(order.id, 'cancelled', staff.id);
  const catAfter = (await analytics.categorySales()).reduce((s, c) => s + c.revenue_minor, 0);
  assert('kategori: iptal edilen siparişin kalemleri DÜŞTÜ', catAfter === 0);
  assert('kategori cirosu == KPI cirosu (iki rapor aynı evreni anlatıyor)',
    catAfter === (await analytics.kpiSummary()).revenue_minor - 23000);

  // İptal edilen sipariş rollup'ın order_count'una da girmemeli
  await analytics.rebuildDailyStats();
  const oc = (await conn.one("SELECT COALESCE(SUM(order_count),0)::int AS n FROM daily_stats WHERE stat_date = '2027-06-01'")).n;
  assert('rollup: iptal edilen sipariş order_count\'a sayılmıyor', oc === 0);

  // 8. TAŞMA KORUMASI: para KURUŞ cinsinden tutuluyor; int4 üst sınırı 2.147.483.647 kuruş
  // = yalnız ~21,5 milyon TL. Bir yıllık üretilmiş veri bile bunu aşıyor. Toplamlar ::int
  // olarak cast edilirse PostgreSQL 22003 fırlatır ve dashboard tamamen çöker (yaşandı).
  // Üç büyük satırla sınırı aşıp tüm analitik yolların ayakta kaldığını doğruluyoruz.
  const BIG = 900000000; // 9.000.000 TL
  for (const d of ['2028-01-01', '2028-01-02', '2028-01-03']) {
    await ins(d, '13:00', 1, 0, 'confirmed', BIG, 'card');
  }
  const bigKpi = await analytics.kpiSummary();
  assert('taşma: int4 sınırını aşan ciro doğru toplandı (bigint)', bigKpi.revenue_minor > 2147483647);
  assert('taşma: sonuç JS Number (string değil)', typeof bigKpi.revenue_minor === 'number');
  const bigSeries = await analytics.revenueTimeSeries('year');
  assert('taşma: zaman serisi de çökmüyor', bigSeries.some(r => r.revenue_minor > 2147483647));
  await analytics.rebuildDailyStats();
  assert('taşma: rollup okuması da çökmüyor',
    (await analytics.revenueFromRollup('year')).some(r => r.revenue_minor > 2147483647));
  const dash = await analytics.dashboard('month');
  assert('taşma: tam dashboard payload üretilebiliyor', !!dash.kpi && Array.isArray(dash.revenue));

  await t.finish();
})().catch(async (err) => {
  console.error('\nTEST ÇÖKTÜ:', err);
  await require('./database').dropSchema().catch(() => {});
  process.exit(1);
});
