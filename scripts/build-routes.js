#!/usr/bin/env node
/**
 * build-routes.js - GTFS → gerçek hat geometrileri (Faz v2-06, ADR-006).
 *
 * Resmi İBB/İETT GTFS feed'inden, tesislere hizmet veren hatların GERÇEK güzergah
 * çizgilerini (shapes) çıkarır ve slim bir GeoJSON üretir. Sonuç repoya işlenir →
 * harita çevrimdışı gerçek güzergahları çizer (canlı API yok). Sıfır dış bağımlılık.
 *
 * İKİ FEED BİÇİMİ desteklenir (otomatik algılanır):
 *   1) "direct"    : trips'te shape_id DOLU → route→shape doğrudan (sentetik fixture).
 *   2) "geometric" : trips'te shape_id YOK (gerçek İETT feed'i) → route→shape GEOMETRİK
 *                    eşleme: route → temsili sefer → durak dizisi (stop_times) → durakları
 *                    en iyi saran shape polyline'ı (grid örtüşme + ortalama-en-yakın mesafe).
 *
 * Gerçek İETT feed'i tuhaflıkları (hepsi burada ele alınır):
 *   - Dosya-başına DEĞİŞKEN sınırlayıcı: routes/trips/stops/stop_times ';' , shapes/agency ',' .
 *   - Bozuk durak koordinatları: "410.191.700.005.564" → 41.0191700005564 (binlik ayraç kayması).
 *   - route_long_name mojibake (UTF-8'in Latin1 çözülmesi) → görüntü için düzeltilir.
 *   - trips'te shape_id YOK → geometrik eşleme (yukarıda).
 *
 * KALİTE KAPISI ("emin ol"): geometrik eşlemede bir hat, ancak yüksek güvenle
 * (örtüşme ≥ --cov ve ortalama sapma ≤ --dist m) eşleşirse çizilir; aksi halde
 * meta.unmatched'e SEBEBİYLE yazılır (uydurma düz çizgi ÇİZİLMEZ).
 *
 * Kullanım:
 *   node scripts/build-routes.js                         # data/gtfs -> docs/data/transit-routes.geojson
 *   node scripts/build-routes.js --gtfs=DIR --out=FILE --seed=FILE
 *   node scripts/build-routes.js --cov=0.6 --dist=350    # kalite eşikleri
 */
const fs = require('fs');
const path = require('path');

const arg = (name, def) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : def; };
const REPO = path.join(__dirname, '..');
const GTFS_DIR = arg('gtfs', path.join(REPO, 'data', 'gtfs'));
const OUT = arg('out', path.join(REPO, 'docs', 'data', 'transit-routes.geojson'));
const SEED = arg('seed', path.join(REPO, 'data', 'seed.json'));
const SOURCE = arg('source', 'ibb-gtfs');           // 'ibb-gtfs' = gerçek feed; 'fixture-sample' = örnek
const COV_MIN = parseFloat(arg('cov', '0.6'));      // geometrik eşleme min örtüşme (0..1)
const DIST_MAX = parseFloat(arg('dist', '350'));    // geometrik eşleme max ortalama sapma (m)

// dataviz doğrulanmış paletinden mod renkleri (light hex; frontend temaya göre yeniden renklendirebilir)
const MODE_COLOR = { bus: '#2a78d6', metrobus: '#eb6834', ferry: '#1baf7a', rail: '#4a3aa7', walk: '#898781' };
const GRID = 0.0025; // ~200 m hücre (geometrik örtüşme indeksi)

// --- CSV yardımcıları (sınırlayıcı otomatik; tırnaklı alan desteği) ---
function splitCsv(line, delim) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ''; } else cur += c; }
  }
  out.push(cur); return out;
}
function findFile(dir, base) { // .txt veya .csv
  for (const ext of ['.txt', '.csv']) { const p = path.join(dir, base + ext); if (fs.existsSync(p)) return p; }
  return null;
}
function sniffDelim(headerLine) { return (headerLine.split(';').length > headerLine.split(',').length) ? ';' : ','; }
function readTable(dir, base) {
  const file = findFile(dir, base);
  if (!file) return { rows: [], head: [] };
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.length);
  if (!lines.length) return { rows: [], head: [] };
  const delim = sniffDelim(lines[0]);
  const head = splitCsv(lines[0], delim).map(h => h.trim().replace(/^﻿/, ''));
  const rows = lines.slice(1).map(l => { const c = splitCsv(l, delim); const o = {}; head.forEach((h, i) => o[h] = (c[i] || '').trim()); return o; });
  return { rows, head, delim, dataCount: lines.length - 1 };
}

// Bozuk koordinat un-mangle: "410.191.700.005.564" → 41.0191700005564 (İstanbul: tam kısım 2 hane)
function num(s) {
  s = (s || '').trim(); if (!s) return NaN;
  if (/^-?\d{1,2}\.\d{3,}$/.test(s)) return parseFloat(s); // zaten normal (fixture / düzgün feed)
  const d = s.replace(/[^\d]/g, ''); if (d.length < 3) return NaN;
  return parseFloat(d.slice(0, 2) + '.' + d.slice(2));
}
// mojibake düzeltme (yalnız görüntü metni): UTF-8 baytları Latin1 çözülmüşse geri çevir
function fixText(s) {
  if (!s || !/[ÃÂÄÅ]/.test(s)) return s || '';
  try { const back = Buffer.from(s, 'latin1').toString('utf8'); return /�/.test(back) ? s : back; } catch { return s; }
}
function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000, r = Math.PI / 180;
  const d = Math.acos(Math.min(1, Math.sin(aLat * r) * Math.sin(bLat * r) + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.cos((bLng - aLng) * r))) * R;
  return isNaN(d) ? Infinity : d;
}
const inIstanbul = (lat, lng) => lat > 40.5 && lat < 41.9 && lng > 27.5 && lng < 30.2;

// --- GTFS yükle ---
function loadGtfs(dir) {
  const routes = readTable(dir, 'routes').rows;
  const tripsT = readTable(dir, 'trips');
  const trips = tripsT.rows;
  const shapesRows = readTable(dir, 'shapes').rows;
  const stopsRows = readTable(dir, 'stops').rows;

  // shape_id -> sıralı [[lat,lng],...]
  const shapes = {};
  for (const s of shapesRows) (shapes[s.shape_id] = shapes[s.shape_id] || []).push([+s.shape_pt_lat, +s.shape_pt_lon, +s.shape_pt_sequence]);
  for (const k in shapes) shapes[k] = shapes[k].sort((a, b) => a[2] - b[2]).map(p => [p[0], p[1]]);

  // duraklar (un-mangle + İstanbul bbox filtresi)
  const stops = {};
  const stopList = [];
  for (const s of stopsRows) {
    const lat = num(s.stop_lat), lng = num(s.stop_lon);
    if (!inIstanbul(lat, lng)) continue;
    const o = { id: s.stop_id, lat, lng, name: s.stop_name };
    stops[s.stop_id] = o; stopList.push(o);
  }

  const byId = {}, byShort = {}, shortOf = {};
  for (const r of routes) {
    byId[r.route_id] = r;
    const sn = (r.route_short_name || '').trim();
    shortOf[r.route_id] = sn;
    (byShort[sn] = byShort[sn] || []).push(r.route_id);
  }

  // Mod: trips'te shape_id dolu mu? → direct, değilse → geometric
  const hasShapeId = trips.some(t => t.shape_id && shapes[t.shape_id]);
  const mode = hasShapeId ? 'direct' : 'geometric';

  let routeShapes = {};       // direct: route_id -> en uzun shape_id
  const routeOfTrip = {};     // geometric: trip_id -> route_id
  const tripsByRoute = {};    // geometric: route_id -> [trip_id,...]
  if (mode === 'direct') {
    for (const t of trips) {
      if (!t.shape_id || !shapes[t.shape_id]) continue;
      const cur = routeShapes[t.route_id];
      if (!cur || shapes[t.shape_id].length > shapes[cur].length) routeShapes[t.route_id] = t.shape_id;
    }
  } else {
    for (const t of trips) { routeOfTrip[t.trip_id] = t.route_id; (tripsByRoute[t.route_id] = tripsByRoute[t.route_id] || []).push(t.trip_id); }
  }

  return { routes, byId, byShort, shortOf, shapes, routeShapes, routeOfTrip, tripsByRoute, stops, stopList, mode, tripCount: trips.length };
}

// shape'ler için grid hücre indeksi (geometrik örtüşme)
function buildShapeCells(shapes) {
  const cell = (a, b) => Math.round(a / GRID) + ',' + Math.round(b / GRID);
  const shapeCells = {};
  for (const k in shapes) { const set = new Set(); for (const [a, b] of shapes[k]) set.add(cell(a, b)); shapeCells[k] = set; }
  return { shapeCells, cell };
}

// Bir durak-dizisini (gerçek koordinatlar) en iyi saran shape'i bul (grid → topK → ortalama-en-yakın)
function matchShapeToStops(coords, gtfs, idx) {
  const tc = new Set(); for (const [a, b] of coords) tc.add(idx.cell(a, b));
  const scored = [];
  for (const k in idx.shapeCells) { let h = 0; for (const cc of tc) if (idx.shapeCells[k].has(cc)) h++; const cov = h / tc.size; if (cov > 0) scored.push([k, cov]); }
  scored.sort((a, b) => b[1] - a[1]);
  let win = null;
  for (const [k, cov] of scored.slice(0, 6)) {
    let sum = 0; for (const [a, b] of coords) { let m = Infinity; for (const [la, lo] of gtfs.shapes[k]) { const d = haversine(a, b, la, lo); if (d < m) m = d; } sum += m; }
    const mean = sum / coords.length;
    if (!win || mean < win.mean) win = { shapeId: k, cov, mean };
  }
  return win;
}

// GEOMETRIC: ihtiyaç duyulan kısa-adlar için durak dizisi topla → shape eşle (kalite kapılı)
function resolveGeometric(gtfs, dir, neededShorts) {
  const idx = buildShapeCells(gtfs.shapes);
  // ihtiyaç duyulan sefer kümesi (short_name ∈ needed olan rotaların seferleri)
  const neededTrips = new Set();
  for (const [tid, rid] of Object.entries(gtfs.routeOfTrip)) if (neededShorts.has(gtfs.shortOf[rid])) neededTrips.add(tid);

  // stop_times: yalnız gerekli seferler; sefer -> [[seq, stop_id],...]
  // Not: gerçek feed 144 MB / ~6M satır → satırları indexOf ile akıtarak tara (dev array yok).
  const stFile = findFile(dir, 'stop_times');
  const tripStops = {};
  let stDataRows = 0;
  if (stFile) {
    const raw = fs.readFileSync(stFile, 'utf8');
    const nl = raw.indexOf('\n');
    const delim = sniffDelim(raw.slice(0, nl < 0 ? raw.length : nl));
    const head = splitCsv(raw.slice(0, nl < 0 ? raw.length : nl), delim).map(h => h.trim().replace(/^﻿/, ''));
    const iT = head.indexOf('trip_id'), iS = head.indexOf('stop_id'), iQ = head.indexOf('stop_sequence');
    let pos = nl + 1; const len = raw.length;
    while (pos < len && nl >= 0) {
      let e = raw.indexOf('\n', pos); if (e < 0) e = len;
      const line = raw.slice(pos, e).replace(/\r$/, ''); pos = e + 1;
      if (!line) continue; stDataRows++;
      // stop_times satırında tırnak yok (feed gerçeği) → hızlı split
      const c = line.split(delim);
      const t = c[iT]; if (!neededTrips.has(t)) continue;
      (tripStops[t] = tripStops[t] || []).push([+c[iQ], c[iS]]);
    }
  }

  // Temsili sefer: her route_id için EN UZUN sefer (en dolu güzergah sinyali). Rota varyantları
  // (farklı route_id = farklı desen/yön) farklı shape'lere düşebildiğinden route_id başına bir
  // aday seçip kısa-ad altında en iyisini tutuyoruz (tüm seferleri taramaktan ~40× hızlı).
  const longestPerRoute = {}; // route_id -> {trip, n}
  for (const t in tripStops) {
    const rid = gtfs.routeOfTrip[t]; const n = tripStops[t].length;
    if (!longestPerRoute[rid] || n > longestPerRoute[rid].n) longestPerRoute[rid] = { trip: t, n };
  }

  // kısa-ad başına en iyi shape (kalite kapısını build() uygular; burada ham skoru saklıyoruz)
  const shortGeom = {};
  for (const rid in longestPerRoute) {
    const sn = gtfs.shortOf[rid];
    const t = longestPerRoute[rid].trip;
    const seq = tripStops[t].sort((a, b) => a[0] - b[0]).map(x => gtfs.stops[x[1]]).filter(Boolean);
    if (seq.length < 2) continue;
    const m = matchShapeToStops(seq.map(s => [s.lat, s.lng]), gtfs, idx);
    if (!m) continue;
    const prev = shortGeom[sn];
    const better = !prev || m.cov > prev.cov || (m.cov === prev.cov && gtfs.shapes[m.shapeId].length > gtfs.shapes[prev.shapeId].length);
    if (better) shortGeom[sn] = { ...m, stops: seq.length };
  }

  // truncation tespiti: Excel 1.048.576 satır limiti (başlık dahil) = 1.048.575 veri satırı (tam eşleşme)
  const truncated = stDataRows === 1048575;
  return { shortGeom, idx, stDataRows, truncated };
}

// --- Tesis alanlarından hat ref'lerini ayrıştır ---
function parseRefs(fac) {
  const refs = [];
  const clean = (s) => (s || '').replace(/\([^)]*\)/g, ' '); // parantez içini at
  clean(fac.iett_info).split(',').map(x => x.trim()).filter(x => x && x !== 'Mevcut Değil')
    .forEach(ref => refs.push({ ref, hint: 'bus' }));
  const v = clean(fac.vapur_info).trim();
  if (v && v !== 'Mevcut Değil') refs.push({ ref: v, hint: 'ferry' });
  const tt = fac.transit_transfer || '';
  (tt.match(/\bM\d+[A-Z]?\b/g) || []).forEach(ref => refs.push({ ref, hint: 'rail' }));
  (tt.match(/\bT\d+\b/g) || []).forEach(ref => refs.push({ ref, hint: 'rail' }));
  if (/marmaray/i.test(tt)) refs.push({ ref: 'Marmaray', hint: 'rail' });
  if (/metrob[üu]s/i.test(tt)) refs.push({ ref: 'Metrobüs', hint: 'metrobus' });
  return refs;
}

// DIRECT: ref'i GTFS route ile eşle (fixture yolu)
function matchRoute(ref, hint, gtfs) {
  const R = ref.toUpperCase();
  for (const rt of gtfs.routes) {
    const sn = (rt.route_short_name || '').toUpperCase();
    const ln = (rt.route_long_name || '').toUpperCase();
    if (hint === 'metrobus') { if (rt.route_type === '3' && (sn.startsWith('34') || ln.includes('METROB'))) return rt; }
    else if (hint === 'ferry') { if (ln.includes(R) || sn === R) return rt; }
    else { if (sn === R) return rt; }
  }
  return null;
}
function finalModeDirect(rt, hint) {
  if (hint === 'metrobus') return 'metrobus';
  switch (rt.route_type) { case '4': return 'ferry'; case '0': case '1': case '2': return 'rail'; default: return 'bus'; }
}

// --- Ana akış ---
function build() {
  if (!findFile(GTFS_DIR, 'routes')) {
    console.error(`[routes] GTFS bulunamadı: ${GTFS_DIR}/routes.(txt|csv) yok.`);
    console.error('[routes] Resmi İBB/İETT GTFS feed\'ini data/gtfs/ altına ekleyin.');
    process.exit(2);
  }
  const gtfs = loadGtfs(GTFS_DIR);
  const facilities = JSON.parse(fs.readFileSync(SEED, 'utf8')).facilities || [];

  // GEOMETRIC modda ihtiyaç duyulan kısa-adları önden hesapla (metrobüs = 34* ailesi)
  let geom = null;
  if (gtfs.mode === 'geometric') {
    const needed = new Set();
    for (const fac of facilities) for (const { ref, hint } of parseRefs(fac)) { if (hint === 'bus') needed.add(ref); }
    // metrobüs referansı varsa 34* ailesini ekle
    const wantsMetrobus = facilities.some(f => /metrob[üu]s/i.test(f.transit_transfer || ''));
    if (wantsMetrobus) for (const sn in gtfs.byShort) if (/^34/.test(sn)) needed.add(sn);
    geom = resolveGeometric(gtfs, GTFS_DIR, needed);
  }

  const lineFeatures = {};   // key -> feature (dedup)
  const facilityIndex = {};  // facility_id -> [key,...]
  const walkFeatures = [];
  const unmatched = {};      // "ref (hint)" -> sebep

  // GEOMETRIC: metrobüs için 34* ailesinin en iyi eşleşen shape'i (temsili)
  let metrobusGeom = null;
  if (geom) {
    for (const sn in geom.shortGeom) if (/^34/.test(sn)) {
      const g = geom.shortGeom[sn];
      if (!metrobusGeom || g.cov > metrobusGeom.cov) metrobusGeom = { ...g, ref: '34' };
    }
  }

  for (const fac of facilities) {
    const refs = parseRefs(fac);
    const matchedKeys = [];
    for (const { ref, hint } of refs) {
      let feat = null, key = null;
      if (gtfs.mode === 'direct') {
        const rt = matchRoute(ref, hint, gtfs);
        if (!rt) { unmatched[`${ref} (${hint})`] = 'route-not-found'; continue; }
        const shapeId = gtfs.routeShapes[rt.route_id];
        if (!shapeId || gtfs.shapes[shapeId].length < 2) { unmatched[`${ref} (${hint})`] = 'shape-missing'; continue; }
        const mode = finalModeDirect(rt, hint);
        key = `${mode}:${rt.route_short_name || ref}`;
        if (!lineFeatures[key]) feat = {
          type: 'Feature',
          properties: { kind: 'line', ref: rt.route_short_name || ref, mode, color: MODE_COLOR[mode], route_long_name: fixText(rt.route_long_name) || '' },
          geometry: { type: 'LineString', coordinates: gtfs.shapes[shapeId].map(([lat, lng]) => [lng, lat]) }
        };
      } else {
        // GEOMETRIC (gerçek İETT feed'i): bus/metrobus çözülür; rail/ferry bu feed'de yok
        if (hint === 'rail' || hint === 'ferry') { unmatched[`${ref} (${hint})`] = 'operator-feed-missing'; continue; }
        const g = hint === 'metrobus' ? metrobusGeom : geom.shortGeom[ref];
        if (!g) { unmatched[`${ref} (${hint})`] = 'no-stop-times-coverage'; continue; }
        if (!(g.cov >= COV_MIN && g.mean <= DIST_MAX)) { unmatched[`${ref} (${hint})`] = `low-confidence(cov=${g.cov.toFixed(2)},dist=${Math.round(g.mean)}m)`; continue; }
        const mode = hint === 'metrobus' ? 'metrobus' : 'bus';
        const dispRef = hint === 'metrobus' ? '34 (Metrobüs)' : ref;
        key = `${mode}:${dispRef}`;
        if (!lineFeatures[key]) feat = {
          type: 'Feature',
          properties: { kind: 'line', ref: dispRef, mode, color: MODE_COLOR[mode], match_cov: +g.cov.toFixed(2), match_dist_m: Math.round(g.mean) },
          geometry: { type: 'LineString', coordinates: gtfs.shapes[g.shapeId].map(([lat, lng]) => [lng, lat]) }
        };
      }
      if (feat) lineFeatures[key] = feat;
      if (key && !matchedKeys.includes(key)) matchedKeys.push(key);
    }
    facilityIndex[fac.id] = matchedKeys;

    // Yürüme bacağı: en yakın GERÇEK durak → tesis (tüm tesisler; stops.txt tam)
    let best = null;
    for (const s of gtfs.stopList) { const d = haversine(fac.lat, fac.lng, s.lat, s.lng); if (!best || d < best.d) best = { d, s }; }
    if (best && best.d < 2000) walkFeatures.push({
      type: 'Feature',
      properties: { kind: 'walk', facility_id: fac.id, mode: 'walk', color: MODE_COLOR.walk, distance_m: Math.round(best.d), stop_name: best.s.name },
      geometry: { type: 'LineString', coordinates: [[fac.lng, fac.lat], [best.s.lng, best.s.lat]] }
    });
  }

  const features = [...Object.values(lineFeatures), ...walkFeatures];
  const meta = {
    source: SOURCE, mode: gtfs.mode,
    line_count: Object.keys(lineFeatures).length, walk_count: walkFeatures.length, facility_count: facilities.length,
    quality_gate: gtfs.mode === 'geometric' ? { cov_min: COV_MIN, dist_max_m: DIST_MAX } : undefined,
    unmatched: unmatched
  };
  if (geom && geom.truncated) meta.warning = `stop_times KESİK görünüyor (${geom.stDataRows} veri satırı; Excel 1.048.576 limiti). Tam kapsam için EKSİKSİZ stop_times gerekir. (ADR-006)`;

  const out = { type: 'FeatureCollection', generated_at: new Date().toISOString(), meta, facility_index: facilityIndex, features };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`[routes] mod=${gtfs.mode}  ${meta.line_count} hat + ${meta.walk_count} yürüme bacağı -> ${path.relative(REPO, OUT)}`);
  if (meta.warning) console.warn(`[routes] UYARI: ${meta.warning}`);
  const um = Object.entries(unmatched);
  if (um.length) console.log(`[routes] Eşleşmeyen ${um.length} ref: ${um.slice(0, 10).map(([k, v]) => `${k}→${v}`).join(', ')}${um.length > 10 ? ' …' : ''}`);
  return out;
}

if (require.main === module) build();
module.exports = { build, parseRefs, matchRoute, loadGtfs, num, fixText };
