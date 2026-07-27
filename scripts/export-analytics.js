#!/usr/bin/env node
/**
 * export-analytics.js - Pages için önceden hesaplanmış analytics snapshot'ı üretir (ADR-004).
 *
 * GitHub Pages sunucusuzdur; dashboard orada canlı DB'ye erişemez. Bu script analytics
 * motorunu çalıştırıp docs/data/analytics.json yazar — merkezi verinin TÜRETİLMİŞ replikası
 * (DDIA Böl. 11). Dashboard, backend'e erişemezse bu snapshot'tan chart çizer.
 *
 * Kullanım: node scripts/export-analytics.js   (veritabanı dolu olmalı; bkz. generate-data.js)
 */
const fs = require('fs');
const path = require('path');
const { init, close } = require('../backend/database');
const analytics = require('../backend/analytics');

const GRANS = ['day', 'week', 'month', 'year'];

(async () => {
  await init();

  // Rollup'ı tazele (snapshot tutarlı olsun) — türetilmiş veriyi kaynaktan yeniden hesapla.
  await analytics.rebuildDailyStats();

  const byGranularity = {};
  for (const g of GRANS) {
    const [revenue, highchair, cancellations] = await Promise.all([
      analytics.revenueTimeSeries(g),
      analytics.highchairTrend(g),
      analytics.cancellationRate(g)
    ]);
    byGranularity[g] = { revenue, highchair, cancellations };
  }

  const [kpi, occupancy_heatmap, top_facilities, payments, category_sales] = await Promise.all([
    analytics.kpiSummary(),
    analytics.occupancyHeatmap(),
    analytics.topFacilities('revenue', 10),
    analytics.paymentBreakdown(),
    analytics.categorySales()
  ]);

  const snapshot = {
    generated_at: new Date().toISOString(),
    kpi, occupancy_heatmap, top_facilities, payments, category_sales, byGranularity
  };

  const outPath = path.join(__dirname, '..', 'docs', 'data', 'analytics.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`[export] docs/data/analytics.json yazıldı (${kb} KB).`);
  console.log(`[export] KPI: ${(kpi.revenue_minor / 100).toLocaleString('tr-TR')} TL ciro, ${kpi.reservations} rezervasyon.`);
  console.log(`[export] aylık bucket: ${byGranularity.month.revenue.length}, günlük: ${byGranularity.day.revenue.length}`);

  await close();
})().catch(async (err) => {
  console.error('[export] HATA:', err.message);
  await close().catch(() => {});
  process.exit(1);
});
