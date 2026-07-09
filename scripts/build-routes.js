#!/usr/bin/env node
/**
 * build-routes.js - GTFS → gerçek hat geometrileri (Faz v2-06, ADR-006).
 *
 * Resmi İBB GTFS feed'inden, tesislere hizmet veren hatların GERÇEK güzergah çizgilerini
 * (shapes.txt) çıkarır ve slim bir GeoJSON üretir. Sonuç repoya işlenir → harita çevrimdışı
 * gerçek güzergahları çizer (canlı API yok). Sıfır dış bağımlılık (stdlib CSV parse).
 *
 * Kullanım:
 *   node scripts/build-routes.js                        # data/gtfs -> docs/data/transit-routes.geojson
 *   node scripts/build-routes.js --gtfs=DIR --out=FILE --seed=FILE
 */
const fs = require('fs');
const path = require('path');

const arg = (name, def) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : def; };
const REPO = path.join(__dirname, '..');
const GTFS_DIR = arg('gtfs', path.join(REPO, 'data', 'gtfs'));
const OUT = arg('out', path.join(REPO, 'docs', 'data', 'transit-routes.geojson'));
const SEED = arg('seed', path.join(REPO, 'data', 'seed.json'));
const SOURCE = arg('source', 'ibb-gtfs'); // 'ibb-gtfs' = gerçek resmi feed; 'fixture-sample' = örnek

// dataviz doğrulanmış paletinden mod renkleri (light hex; frontend temaya göre yeniden renklendirebilir)
const MODE_COLOR = { bus: '#2a78d6', metrobus: '#eb6834', ferry: '#1baf7a', rail: '#4a3aa7', walk: '#898781' };

// --- Minimal CSV parse (tırnaklı alanları destekler) ---
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  }
  out.push(cur); return out;
}
function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.length);
  if (!lines.length) return [];
  const head = parseCsvLine(lines[0]).map(h => h.trim().replace(/^﻿/, ''));
  return lines.slice(1).map(l => { const c = parseCsvLine(l); const o = {}; head.forEach((h, i) => o[h] = (c[i] || '').trim()); return o; });
}

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000, r = Math.PI / 180;
  const d = Math.acos(Math.min(1, Math.sin(aLat * r) * Math.sin(bLat * r) + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.cos((bLng - aLng) * r))) * R;
  return isNaN(d) ? Infinity : d;
}

// --- GTFS yükle ---
function loadGtfs(dir) {
  const routes = readCsv(path.join(dir, 'routes.txt'));
  const trips = readCsv(path.join(dir, 'trips.txt'));
  const shapesRows = readCsv(path.join(dir, 'shapes.txt'));
  const stops = readCsv(path.join(dir, 'stops.txt'));

  // shape_id -> [[lat,lng],...] sıralı
  const shapes = {};
  for (const s of shapesRows) {
    (shapes[s.shape_id] = shapes[s.shape_id] || []).push([+s.shape_pt_lat, +s.shape_pt_lon, +s.shape_pt_sequence]);
  }
  for (const k in shapes) shapes[k] = shapes[k].sort((a, b) => a[2] - b[2]).map(p => [p[0], p[1]]);

  // route_id -> en uzun (temsili) shape
  const routeShapes = {};
  for (const t of trips) {
    if (!t.shape_id || !shapes[t.shape_id]) continue;
    const cur = routeShapes[t.route_id];
    if (!cur || shapes[t.shape_id].length > shapes[cur].length) routeShapes[t.route_id] = t.shape_id;
  }

  const byId = {};
  for (const r of routes) byId[r.route_id] = r;
  return { routes, byId, shapes, routeShapes, stops };
}

// --- Tesis alanlarından hat ref'lerini ayrıştır ---
function parseRefs(fac) {
  const refs = [];
  const clean = (s) => (s || '').replace(/\([^)]*\)/g, ' '); // parantez içini at
  // Otobüs (iett_info): virgülle ayrık kısa adlar
  clean(fac.iett_info).split(',').map(x => x.trim()).filter(x => x && x !== 'Mevcut Değil')
    .forEach(ref => refs.push({ ref, hint: 'bus' }));
  // Vapur (vapur_info): uzun ad (Haliç Hattı vb.)
  const v = clean(fac.vapur_info).trim();
  if (v && v !== 'Mevcut Değil') refs.push({ ref: v, hint: 'ferry' });
  // Ray + metrobüs (transit_transfer)
  const tt = fac.transit_transfer || '';
  (tt.match(/\bM\d+[A-Z]?\b/g) || []).forEach(ref => refs.push({ ref, hint: 'rail' }));
  (tt.match(/\bT\d+\b/g) || []).forEach(ref => refs.push({ ref, hint: 'rail' }));
  if (/marmaray/i.test(tt)) refs.push({ ref: 'Marmaray', hint: 'rail' });
  if (/metrob[üu]s/i.test(tt)) refs.push({ ref: 'Metrobüs', hint: 'metrobus' });
  return refs;
}

// --- Ref'i GTFS route ile eşle ---
function matchRoute(ref, hint, gtfs) {
  const R = ref.toUpperCase();
  for (const rt of gtfs.routes) {
    const sn = (rt.route_short_name || '').toUpperCase();
    const ln = (rt.route_long_name || '').toUpperCase();
    if (hint === 'metrobus') { if (rt.route_type === '3' && (sn.startsWith('34') || ln.includes('METROB'))) return rt; }
    else if (hint === 'ferry') { if (ln.includes(R) || sn === R) return rt; }
    else { if (sn === R) return rt; } // bus / rail: kısa ad tam eşleşme
  }
  return null;
}

function finalMode(rt, hint) {
  if (hint === 'metrobus') return 'metrobus';
  switch (rt.route_type) {
    case '4': return 'ferry';
    case '0': case '1': case '2': return 'rail';
    default: return 'bus';
  }
}

// --- Ana akış ---
function build() {
  if (!fs.existsSync(path.join(GTFS_DIR, 'routes.txt'))) {
    console.error(`[routes] GTFS bulunamadı: ${GTFS_DIR}/routes.txt yok.`);
    console.error('[routes] Resmi İBB GTFS feed\'ini data/gtfs/ altına ekleyin (routes/trips/shapes/stops.txt).');
    process.exit(2);
  }
  const gtfs = loadGtfs(GTFS_DIR);
  const facilities = JSON.parse(fs.readFileSync(SEED, 'utf8')).facilities || [];

  const lineFeatures = {};   // ref -> feature (dedup)
  const facilityIndex = {};  // facility_id -> [ref,...]
  const walkFeatures = [];
  const unmatched = new Set();

  for (const fac of facilities) {
    const refs = parseRefs(fac);
    const matchedRefs = [];
    for (const { ref, hint } of refs) {
      const rt = matchRoute(ref, hint, gtfs);
      if (!rt) { unmatched.add(`${ref} (${hint})`); continue; }
      const shapeId = gtfs.routeShapes[rt.route_id];
      if (!shapeId || !gtfs.shapes[shapeId] || gtfs.shapes[shapeId].length < 2) { unmatched.add(`${ref} (shape yok)`); continue; }
      const mode = finalMode(rt, hint);
      const key = `${mode}:${rt.route_short_name || ref}`;
      if (!lineFeatures[key]) {
        lineFeatures[key] = {
          type: 'Feature',
          properties: { kind: 'line', ref: rt.route_short_name || ref, mode, color: MODE_COLOR[mode], route_long_name: rt.route_long_name || '' },
          geometry: { type: 'LineString', coordinates: gtfs.shapes[shapeId].map(([lat, lng]) => [lng, lat]) }
        };
      }
      if (!matchedRefs.includes(key)) matchedRefs.push(key);
    }
    facilityIndex[fac.id] = matchedRefs;

    // Yürüme bacağı: en yakın durak -> tesis (son ~500m; gerçek koordinatlar)
    let best = null;
    for (const s of gtfs.stops) {
      const d = haversine(fac.lat, fac.lng, +s.stop_lat, +s.stop_lon);
      if (!best || d < best.d) best = { d, s };
    }
    if (best && best.d < 2000) {
      walkFeatures.push({
        type: 'Feature',
        properties: { kind: 'walk', facility_id: fac.id, mode: 'walk', color: MODE_COLOR.walk, distance_m: Math.round(best.d), stop_name: best.s.stop_name },
        geometry: { type: 'LineString', coordinates: [[fac.lng, fac.lat], [+best.s.stop_lon, +best.s.stop_lat]] }
      });
    }
  }

  const features = [...Object.values(lineFeatures), ...walkFeatures];
  const out = {
    type: 'FeatureCollection',
    generated_at: new Date().toISOString(),
    meta: { source: SOURCE, line_count: Object.keys(lineFeatures).length, walk_count: walkFeatures.length, facility_count: facilities.length, unmatched: [...unmatched] },
    facility_index: facilityIndex,
    features
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`[routes] ${out.meta.line_count} hat + ${out.meta.walk_count} yürüme bacağı -> ${path.relative(REPO, OUT)}`);
  if (unmatched.size) console.log(`[routes] Eşleşmeyen ${unmatched.size} ref (GTFS'te yok veya farklı adlandırılmış): ${[...unmatched].slice(0, 12).join(', ')}${unmatched.size > 12 ? ' …' : ''}`);
  return out;
}

if (require.main === module) build();
module.exports = { build, parseRefs, matchRoute, loadGtfs };
