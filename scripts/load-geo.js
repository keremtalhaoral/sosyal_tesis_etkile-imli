#!/usr/bin/env node
/**
 * load-geo.js - İlçe sınırlarını GeoJSON'dan PostGIS'e yükler (ADR-009).
 *
 * Yükleme mantığı backend/geo.js'te; testler de aynı fonksiyonu kullanır (ikisi ayrışamaz).
 * Bu dosya CLI sarmalayıcısı + doğrulama raporudur.
 *
 * SQLite döneminde bu veri hiç veritabanına girmemişti: backend her açılışta 3.7MB'ı belleğe
 * okuyup point-in-polygon'u JS'te hesaplıyordu. Artık geometri veritabanında, sorgu
 * ST_Contains ile GiST indeksi üzerinden koşuyor.
 *
 * Idempotent: aynı ilçe tekrar yüklenirse geometri GÜNCELLENİR (upsert).
 *
 * Kullanım:
 *   node scripts/load-geo.js
 *   node scripts/load-geo.js --file=docs/data/istanbul-districts.geojson
 */
const path = require('path');
const { db, init, close } = require('../backend/database');
const { loadDistrictGeometry, DEFAULT_GEOJSON } = require('../backend/geo');

const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};

const file = arg('file') ? path.resolve(process.cwd(), arg('file')) : DEFAULT_GEOJSON;

(async () => {
  await init();
  const t0 = Date.now();
  const { features, skipped } = await loadDistrictGeometry(db(), file);

  const stats = await db().one(`
    SELECT COUNT(*)::int AS total,
           COUNT(geom)::int AS with_geom,
           COUNT(*) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::int AS invalid
    FROM districts
  `);
  console.log(`[geo] ${features} ilçe geometrisi yüklendi (${skipped} atlandı) - ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[geo] districts: ${stats.total} satır, ${stats.with_geom} geometrili, ${stats.invalid} geçersiz.`);

  // Doğrulama: mekansal join gerçekten çalışıyor mu? HİÇBİR tesisin ilçeye düşmemesi,
  // koordinat sırasının (lng/lat) ya da SRID'nin yanlış olduğunun işaretidir.
  const joined = await db().one(`
    SELECT COUNT(DISTINCT f.id)::int AS matched, (SELECT COUNT(*)::int FROM facilities) AS total
    FROM facilities f JOIN districts d ON ST_Contains(d.geom, f.geom)
  `);
  console.log(`[geo] Mekansal join kontrolü: ${joined.matched}/${joined.total} tesis bir ilçe poligonuna düştü.`);
  if (joined.matched === 0) {
    console.error('[geo] HATA: hiçbir tesis ilçeye düşmedi - koordinat sırası veya SRID yanlış olabilir.');
    process.exitCode = 1;
  }

  await close();
})().catch(async (err) => {
  console.error('[geo] HATA:', err.message);
  await close().catch(() => {});
  process.exit(1);
});
