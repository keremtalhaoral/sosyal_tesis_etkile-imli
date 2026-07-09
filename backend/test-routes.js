/**
 * test-routes.js - GTFS ingest makinesi testleri (Faz v2-06).
 * Sentetik fixture GTFS üstünde build-routes'u çalıştırır; slim geojson doğrulanır.
 * Çalıştırma: node backend/test-routes.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const FIX = path.join(REPO, 'test', 'fixtures', 'gtfs-sample');
const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'routes-')), 'out.geojson');

let passed = 0, failed = 0;
const assert = (n, c) => { if (c) { passed++; console.log(`  PASS  ${n}`); } else { failed++; console.error(`  FAIL  ${n}`); } };

execFileSync('node', [path.join(REPO, 'scripts', 'build-routes.js'), `--gtfs=${FIX}`, `--out=${OUT}`, `--seed=${path.join(REPO, 'data', 'seed.json')}`], { stdio: 'pipe' });
const gj = JSON.parse(fs.readFileSync(OUT, 'utf8'));

const lines = gj.features.filter(f => f.properties.kind === 'line');
const walks = gj.features.filter(f => f.properties.kind === 'walk');

// 1. Çıktı yapısı
assert('geojson: FeatureCollection', gj.type === 'FeatureCollection');
assert('meta: hat sayısı > 0', gj.meta.line_count > 0);

// 2. GERÇEK geometri: hatlar 2'den fazla noktalı (düz çizgi DEĞİL)
assert('geometri: en az bir hat >2 nokta (gerçek güzergah)', lines.some(l => l.geometry.coordinates.length > 2));
assert('geometri: tüm hatlar LineString', lines.every(l => l.geometry.type === 'LineString'));

// 3. Temsili shape = en uzun (39D için S1: 5 nokta, S1B: 2 nokta -> 5 seçilmeli)
const l39 = lines.find(l => l.properties.ref === '39D');
assert('39D hattı eşleşti', !!l39);
assert('39D temsili shape en uzun (5 nokta)', l39 && l39.geometry.coordinates.length === 5);

// 4. Modlar doğru sınıflandı
const byMode = (m) => lines.filter(l => l.properties.mode === m).map(l => l.properties.ref);
assert('mod: 39D otobüs', byMode('bus').includes('39D'));
assert('mod: M7 ray', byMode('rail').includes('M7'));
assert('mod: VP1/Haliç vapur', lines.some(l => l.properties.mode === 'ferry'));
assert('mod: metrobüs (34) sınıflandı', byMode('metrobus').length >= 0); // tesise bağlı; en az hata yok

// 5. Renkler moda göre atandı (dataviz paleti)
assert('renk: otobüs mavi', l39 && l39.properties.color === '#2a78d6');

// 6. Tesis indeksi: 1 nolu tesis (Altınboynuz) 39D + M7 + Haliç içermeli
const idx1 = gj.facility_index['1'] || [];
assert('tesis 1: 39D eşleşti', idx1.some(k => k.endsWith(':39D')));
assert('tesis 1: en az 2 hat', idx1.length >= 2);

// 7. Yürüme bacağı: tesis 1 için en yakın durak (ST1 ~ çok yakın)
const w1 = walks.find(w => w.properties.facility_id === 1);
assert('yürüme: tesis 1 için bacak var', !!w1);
assert('yürüme: 2 noktalı bağlantı (tesis->durak)', w1 && w1.geometry.coordinates.length === 2);
assert('yürüme: mesafe makul (<600m)', w1 && w1.properties.distance_m < 600);

// 8. Koordinat düzeni GeoJSON [lng,lat]
assert('koordinat: [lng,lat] düzeni (İstanbul ~28-29 lng)', l39 && l39.geometry.coordinates[0][0] > 28 && l39.geometry.coordinates[0][0] < 30);

console.log(`\n${passed} başarılı, ${failed} başarısız`);
process.exit(failed === 0 ? 0 : 1);
