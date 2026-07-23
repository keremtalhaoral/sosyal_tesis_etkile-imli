/**
 * test-analytics.js - Analytics motoru testleri (Faz v2-04).
 * Bilinen küçük veri kümesiyle: KPI doğru, granülerlik gruplaması doğru, iptal hariç,
 * ve en önemlisi ROLLUP == CANLI (türetilmiş veri kaynağıyla tutarlı).
 * Çalıştırma: node backend/test-analytics.js (geçici DB).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-')), 'test.db');

const { getDb } = require('./database');
const analytics = require('./analytics');

let passed = 0, failed = 0;
const assert = (name, cond) => { if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.error(`  FAIL  ${name}`); } };

const db = getDb();
// Bilinen veri: facility 1, user 2 (seed). 3 onaylı + 1 iptal, farklı aylar.
const ins = db.prepare(`INSERT INTO reservations
  (user_id, facility_id, reserve_date, reserve_time, guests, highchair_count, status, amount_minor, payment_type, crypto_signature)
  VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 't')`);
ins.run(2, '2026-01-10', '19:00', 4, 1, 'confirmed', 10000, 'card');
ins.run(2, '2026-01-20', '13:00', 2, 0, 'confirmed', 5000, 'cash');
ins.run(2, '2026-02-05', '19:00', 3, 1, 'confirmed', 8000, 'online');
ins.run(2, '2026-02-06', '19:00', 5, 0, 'cancelled', 99999, 'card'); // iptal: cirodan HARİÇ

// 1. KPI: ciro sadece onaylılardan (10000+5000+8000 = 23000)
const kpi = analytics.kpiSummary();
assert('kpi: ciro iptal hariç (23000)', kpi.revenue_minor === 23000);
assert('kpi: rezervasyon sayısı onaylı (3)', kpi.reservations === 3);
assert('kpi: ort. grup büyüklüğü (9 misafir / 3 = 3)', kpi.avg_group_size === 3);
assert('kpi: iptal oranı (1/4 = 0.25)', kpi.cancellation_rate === 0.25);
assert('kpi: bebe sandalyesi toplam (2)', kpi.highchairs === 2);

// 2. Aylık ciro serisi
const monthly = analytics.revenueTimeSeries('month');
assert('aylık: 2 ay (2026-01, 2026-02)', monthly.length === 2);
assert('aylık: Ocak cirosu 15000', monthly.find(m => m.bucket === '2026-01').revenue_minor === 15000);
assert('aylık: Şubat cirosu 8000 (iptal hariç)', monthly.find(m => m.bucket === '2026-02').revenue_minor === 8000);

// 3. Yıllık gruplama
const yearly = analytics.revenueTimeSeries('year');
assert('yıllık: tek yıl (2026) toplam 23000', yearly.length === 1 && yearly[0].revenue_minor === 23000);

// 4. Ödeme kırılımı (card: 1 onaylı 10000; cash 5000; online 8000 — iptal card HARİÇ)
const pay = analytics.paymentBreakdown();
const card = pay.find(p => p.payment_type === 'card');
assert('ödeme: card yalnız onaylı (1 rez, 10000)', card.reservations === 1 && card.revenue_minor === 10000);

// 5. ROLLUP == CANLI (en kritik: türetilmiş veri kaynakla tutarlı)
const n = analytics.rebuildDailyStats();
assert('rollup: daily_stats dolduruldu', n >= 1);
const live = analytics.revenueTimeSeries('month');
const roll = analytics.revenueFromRollup('month');
const sameMonthly = JSON.stringify(live.map(x => [x.bucket, x.revenue_minor, x.reservations]))
                 === JSON.stringify(roll.map(x => [x.bucket, x.revenue_minor, x.reservations]));
assert('rollup == canlı (aylık ciro birebir)', sameMonthly);
const liveKpiRev = analytics.kpiSummary().revenue_minor;
const rollTotal = db.prepare('SELECT SUM(revenue_minor) AS s FROM daily_stats').get().s;
assert('rollup: toplam ciro canlı KPI ile eşit', rollTotal === liveKpiRev);

// 6. Isı haritası: 19:00 slotunda 3 onaylı rezervasyon
const heat = analytics.occupancyHeatmap();
const at19 = heat.filter(h => h.slot === '19:00').reduce((s, h) => s + h.reservations, 0);
assert('heatmap: 19:00 slotunda 2 onaylı (iptal hariç)', at19 === 2);

console.log(`\n${passed} başarılı, ${failed} başarısız`);
process.exit(failed === 0 ? 0 : 1);
