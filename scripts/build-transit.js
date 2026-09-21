#!/usr/bin/env node
/**
 * build-transit.js - Üç kaynağı tek slim GeoJSON'da birleştirir (ADR-008, ADR-006'nın devamı).
 *
 * KAYNAK ÖNCELİĞİ (aynı hat için birden fazla kaynak varsa üstteki kazanır):
 *   1. iett-soap      GERÇEK durak dizisi + güzergah   (güven: exact)
 *   2. ibb-gtfs       GTFS shapes geometrik eşleme     (güven: kalite kapısını geçenler)
 *   3. metro-istanbul istasyon NOKTALARI                (güven: approximate)
 *
 * DÜRÜSTLÜK KARARI (ADR-006 kalite kapısı ilkesinin devamı):
 * Metro İstanbul uçları istasyon NOKTASI verir, ray geometrisi VERMEZ. Bu yüzden metro/
 * tramvay hatları `geometry_kind: 'station-chain'` etiketiyle üretilir ve haritada kesikli
 * çizilir. Gerçek ray güzergahı gibi sunulmaz - uydurma düz çizgiyi "gerçek" diye göstermek,
 * ADR-006'da reddettiğimiz şeyin ta kendisi olurdu.
 *
 * Girdi:  data/ibb-cache/  (fetch-ibb.js üretir; GITIGNORED)
 *         docs/data/transit-routes.geojson  (varsa: mevcut GTFS çıktısı korunur)
 * Çıktı:  docs/data/transit-routes.geojson  (COMMIT EDİLİR)
 *
 * Kullanım:
 *   node scripts/build-transit.js
 *   node scripts/build-transit.js --cache=DIR --out=FILE --seed=FILE
 *   node scripts/build-transit.js --dry-run      # yazma, sadece raporla
 */
const fs = require('fs');
const path = require('path');
const P = require('./ibb-parse');

const REPO = path.join(__dirname, '..');
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};
const DRY = process.argv.includes('--dry-run');
const CACHE = path.resolve(REPO, arg('cache', path.join('data', 'ibb-cache')));
const OUT = path.resolve(REPO, arg('out', path.join('docs', 'data', 'transit-routes.geojson')));
const SEED = path.resolve(REPO, arg('seed', path.join('data', 'seed.json')));

// dataviz doğrulanmış paletinden mod renkleri (build-routes.js ile senkron)
const MODE_COLOR = { bus: '#2a78d6', metrobus: '#eb6834', ferry: '#1baf7a', rail: '#4a3aa7', walk: '#898781' };

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const haversine = (aLat, aLng, bLat, bLng) => {
  const R = 6371000, r = Math.PI / 180;
  const d = Math.acos(Math.min(1, Math.sin(aLat * r) * Math.sin(bLat * r)
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.cos((bLng - aLng) * r))) * R;
  return Number.isNaN(d) ? Infinity : d;
};

/** Tesisin serbest-metin transit alanlarından hat referanslarını çıkarır. */
const parseRefs = (fac) => {
  const refs = [];
  const clean = (s) => (s || '').replace(/\([^)]*\)/g, ' ');
  clean(fac.iett_info).split(',').map((x) => x.trim())
    .filter((x) => x && x !== 'Mevcut Değil')
    .forEach((ref) => refs.push({ ref, hint: 'bus' }));
  const v = clean(fac.vapur_info).trim();
  if (v && v !== 'Mevcut Değil') refs.push({ ref: v, hint: 'ferry' });
  const tt = fac.transit_transfer || '';
  (tt.match(/\bM\d+[A-Z]?\b/g) || []).forEach((ref) => refs.push({ ref, hint: 'rail' }));
  (tt.match(/\bT\d+\b/g) || []).forEach((ref) => refs.push({ ref, hint: 'rail' }));
  if (/marmaray/i.test(tt)) refs.push({ ref: 'Marmaray', hint: 'rail' });
  if (/metrob[üu]s/i.test(tt)) refs.push({ ref: 'Metrobüs', hint: 'metrobus' });
  return refs;
};

// ---------------------------------------------------------------------------
// Kaynak 1: İETT SOAP (gerçek durak dizileri)
// ---------------------------------------------------------------------------
const buildIettLines = (cache) => {
  const raw = readJson(path.join(cache, 'iett-routes.json'));
  const out = new Map();  // ref -> feature
  if (!raw || !raw.lines) return { features: out, method: null, skipped: 0 };

  let skipped = 0;
  for (const [ref, soapXml] of Object.entries(raw.lines)) {
    const { stops, skipped: s } = P.parseIettLine(ref, soapXml);
    skipped += s;
    // Tek duraklı "hat" çizilmez: iki nokta olmadan güzergah yoktur.
    if (stops.length < 2) continue;
    out.set(ref, {
      type: 'Feature',
      properties: {
        kind: 'line', ref, mode: 'bus', color: MODE_COLOR.bus,
        source: 'iett-soap', confidence: 'exact', geometry_kind: 'stop-sequence',
        stop_count: stops.length,
        first_stop: stops[0].name, last_stop: stops[stops.length - 1].name,
      },
      geometry: { type: 'LineString', coordinates: stops.map((s2) => [s2.lng, s2.lat]) },
    });
  }
  return { features: out, method: raw.method || null, skipped };
};

// ---------------------------------------------------------------------------
// Kaynak 3: Metro İstanbul (istasyon zincirleri - YAKLAŞIK)
// ---------------------------------------------------------------------------
const buildMetroLines = (cache) => {
  const linesRaw = readJson(path.join(cache, 'metro-lines.json'));
  const stationsRaw = readJson(path.join(cache, 'metro-stations.json'));
  const out = new Map();
  const stops = [];
  if (!linesRaw || !stationsRaw) return { features: out, stations: stops, skipped: 0 };

  const { lines } = P.parseMetroLines(linesRaw);
  const { stations, skipped } = P.parseMetroStations(stationsRaw);
  const byLine = {};
  for (const st of stations) (byLine[st.lineId] = byLine[st.lineId] || []).push(st);

  for (const line of lines) {
    let pts = byLine[line.id] || [];
    if (pts.length < 2) continue;
    // Tek YÖN seç: iki yönü birleştirmek çizgiyi ileri-geri katlar (yanıltıcı zikzak).
    const dirCounts = {};
    for (const p of pts) dirCounts[p.directionId || '-'] = (dirCounts[p.directionId || '-'] || 0) + 1;
    const bestDir = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0][0];
    pts = pts.filter((p) => (p.directionId || '-') === bestDir).sort((a, b) => a.order - b.order);
    if (pts.length < 2) continue;

    out.set(line.ref, {
      type: 'Feature',
      properties: {
        kind: 'line', ref: line.ref, mode: 'rail', color: line.color || MODE_COLOR.rail,
        source: 'metro-istanbul',
        confidence: 'approximate',
        // Bu alan haritanın kesikli çizmesini ve lejantta not göstermesini tetikler.
        geometry_kind: 'station-chain',
        note: 'İstasyon noktalarından çizilmiş yaklaşık hat - gerçek ray güzergahı değildir.',
        station_count: pts.length,
        route_long_name: line.name,
      },
      geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lng, p.lat]) },
    });
    for (const p of pts) stops.push({ ...p, ref: line.ref });
  }
  return { features: out, stations: stops, skipped };
};

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------
function build() {
  const facilities = JSON.parse(fs.readFileSync(SEED, 'utf8')).facilities || [];
  const previous = readJson(OUT);

  const iett = buildIettLines(CACHE);
  const metro = buildMetroLines(CACHE);

  // Kaynak 2: önceki GTFS çıktısını KORU (yeniden hesaplamak ham GTFS ister; ADR-006).
  const gtfsLines = new Map();
  const walkFeatures = [];
  if (previous && Array.isArray(previous.features)) {
    for (const f of previous.features) {
      if (f.properties.kind === 'walk') { walkFeatures.push(f); continue; }
      if (f.properties.kind !== 'line') continue;
      if (f.properties.source && f.properties.source !== 'ibb-gtfs') continue; // eski İBB çıktısı
      gtfsLines.set(f.properties.ref, {
        ...f,
        properties: { ...f.properties, source: 'ibb-gtfs', confidence: 'geometric-match', geometry_kind: 'shape' },
      });
    }
  }

  // --- Birleştirme: öncelik iett-soap > ibb-gtfs > metro-istanbul ------------
  const merged = new Map();
  const provenance = { 'iett-soap': 0, 'ibb-gtfs': 0, 'metro-istanbul': 0 };
  const addAll = (map) => {
    for (const [ref, feat] of map) {
      const key = `${feat.properties.mode}:${ref}`;
      if (merged.has(key)) continue;   // daha yüksek öncelikli kaynak zaten koydu
      merged.set(key, feat);
      provenance[feat.properties.source]++;
    }
  };
  addAll(iett.features);
  addAll(gtfsLines);
  addAll(metro.features);

  // --- Tesis indeksi: hangi tesis hangi hatlara bağlı -----------------------
  const facilityIndex = {};
  const unmatched = {};
  for (const fac of facilities) {
    const keys = [];
    for (const { ref, hint } of parseRefs(fac)) {
      // Metrobüs referansı 34* ailesine, diğerleri doğrudan koda eşlenir.
      const candidates = hint === 'metrobus'
        ? [...merged.keys()].filter((k) => /^(metrobus|bus):34/.test(k))
        : [...merged.keys()].filter((k) => k.split(':').slice(1).join(':') === ref);
      if (!candidates.length) {
        unmatched[`${ref} (${hint})`] = hint === 'ferry' ? 'operator-feed-missing' : 'not-in-any-source';
        continue;
      }
      for (const c of candidates) if (!keys.includes(c)) keys.push(c);
    }
    facilityIndex[fac.id] = keys;
  }

  // --- Yürüme bacakları: Metro istasyonları da aday duraktır ----------------
  // Önceki GTFS yürüme bacakları korunur; metro istasyonu daha yakınsa güncellenir.
  const walkByFacility = new Map(walkFeatures.map((w) => [w.properties.facility_id, w]));
  for (const fac of facilities) {
    let best = null;
    for (const st of metro.stations) {
      const d = haversine(fac.lat, fac.lng, st.lat, st.lng);
      if (!best || d < best.d) best = { d, st };
    }
    if (!best || best.d >= 2000) continue;
    const existing = walkByFacility.get(fac.id);
    if (existing && existing.properties.distance_m <= best.d) continue;
    walkByFacility.set(fac.id, {
      type: 'Feature',
      properties: {
        kind: 'walk', facility_id: fac.id, mode: 'walk', color: MODE_COLOR.walk,
        distance_m: Math.round(best.d), stop_name: best.st.name, source: 'metro-istanbul',
      },
      geometry: { type: 'LineString', coordinates: [[fac.lng, fac.lat], [best.st.lng, best.st.lat]] },
    });
  }

  const walks = [...walkByFacility.values()];
  const uncovered = Object.entries(facilityIndex).filter(([, k]) => k.length === 0).map(([id]) => Number(id));

  const meta = {
    generated_at: new Date().toISOString(),
    sources: {
      'iett-soap': { lines: provenance['iett-soap'], method: iett.method, skipped_stops: iett.skipped },
      'ibb-gtfs': { lines: provenance['ibb-gtfs'], note: 'ADR-006 kalite kapısını geçen geometrik eşlemeler' },
      'metro-istanbul': { lines: provenance['metro-istanbul'], skipped_stations: metro.skipped, geometry_kind: 'station-chain (yaklaşık)' },
    },
    line_count: merged.size,
    walk_count: walks.length,
    facility_count: facilities.length,
    coverage: {
      facilities_with_lines: facilities.length - uncovered.length,
      facilities_without_lines: uncovered.length,
      pct: facilities.length ? Math.round((facilities.length - uncovered.length) * 100 / facilities.length) : 0,
      uncovered_facility_ids: uncovered,
    },
    unmatched_count: Object.keys(unmatched).length,
    unmatched,
  };

  const out = {
    type: 'FeatureCollection',
    generated_at: meta.generated_at,
    meta,
    facility_index: facilityIndex,
    features: [...merged.values(), ...walks],
  };

  // --- Rapor ----------------------------------------------------------------
  console.log(`[transit] Kaynaklar: iett-soap=${provenance['iett-soap']}  ibb-gtfs=${provenance['ibb-gtfs']}  metro-istanbul=${provenance['metro-istanbul']}`);
  console.log(`[transit] Toplam ${merged.size} hat + ${walks.length} yürüme bacağı`);
  console.log(`[transit] KAPSAM: ${meta.coverage.facilities_with_lines}/${facilities.length} tesisin hattı var (%${meta.coverage.pct})`);
  if (uncovered.length) console.warn(`[transit] ${uncovered.length} tesiste HİÇ hat yok (id: ${uncovered.join(', ')})`);
  if (!fs.existsSync(CACHE)) {
    console.warn(`[transit] UYARI: İBB önbelleği yok (${path.relative(REPO, CACHE)}).`);
    console.warn('[transit] Yalnız mevcut GTFS çıktısı korundu. Kapsamı artırmak için:');
    console.warn('[transit]   node scripts/fetch-ibb.js   (api.ibb.gov.tr erişimi olan bir ağda)');
  }

  if (DRY) { console.log('[transit] --dry-run: dosya yazılmadı.'); return out; }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`[transit] Yazıldı: ${path.relative(REPO, OUT)}`);
  return out;
}

if (require.main === module) build();
module.exports = { build, buildIettLines, buildMetroLines, parseRefs };
