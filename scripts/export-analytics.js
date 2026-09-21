#!/usr/bin/env node
/**
 * export-analytics.js - Pages için önceden hesaplanmış analytics snapshot'ı üretir (Faz v2-04).
 *
 * GitHub Pages sunucusuzdur; dashboard orada canlı DB'ye erişemez. Bu script analytics
 * motorunu çalıştırıp docs/data/analytics.json yazar — merkezi verinin TÜRETİLMİŞ replikası
 * (DDIA Böl. 11). Dashboard, backend'e erişemezse bu snapshot'tan chart çizer.
 *
 * Kullanım: node scripts/export-analytics.js   (data/app.db dolu olmalı; bkz. generate-data.js)
 */
const fs = require('fs');
const path = require('path');
const analytics = require('../backend/analytics');

const GRANS = ['day', 'week', 'month', 'year'];

// Rollup'ı tazele (snapshot tutarlı olsun) — türetilmiş veriyi kaynaktan yeniden hesapla.
analytics.rebuildDailyStats();

const byGranularity = {};
for (const g of GRANS) {
  byGranularity[g] = {
    revenue: analytics.revenueTimeSeries(g),
    highchair: analytics.highchairTrend(g),
    cancellations: analytics.cancellationRate(g)
  };
}

const snapshot = {
  generated_at: new Date().toISOString(),
  kpi: analytics.kpiSummary(),
  occupancy_heatmap: analytics.occupancyHeatmap(),
  top_facilities: analytics.topFacilities('revenue', 10),
  payments: analytics.paymentBreakdown(),
  category_sales: analytics.categorySales(),
  byGranularity
};

const outPath = path.join(__dirname, '..', 'docs', 'data', 'analytics.json');
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');
const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`[export] docs/data/analytics.json yazıldı (${kb} KB).`);
console.log(`[export] KPI: ${(snapshot.kpi.revenue_minor / 100).toLocaleString('tr-TR')} TL ciro, ${snapshot.kpi.reservations} rezervasyon.`);
console.log(`[export] aylık bucket: ${byGranularity.month.revenue.length}, günlük: ${byGranularity.day.revenue.length}`);
