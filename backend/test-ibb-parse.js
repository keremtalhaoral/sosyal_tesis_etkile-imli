/**
 * test-ibb-parse.js - İBB yanıt ayrıştırıcılarının testleri (ADR-008).
 *
 * Bu testler AĞA ÇIKMAZ: test/fixtures/ibb/ altındaki kaydedilmiş yanıt biçimlerini kullanır.
 * Böylece ayrıştırıcılar İBB API'sine erişimi olmayan bir ortamda (CI, kurum ağı) da
 * doğrulanabilir - ADR-006'daki GTFS fixture deseninin aynısı.
 *
 * Kapsanan gerçek feed tuhaflıkları:
 *   - binlik ayraç kaymalı koordinat: "289.700.000.000" -> 28.97
 *   - virgüllü ondalık: "41,0320" -> 41.032
 *   - mojibake: "BeÅŸiktaÅŸ" -> "Beşiktaş"
 *   - SOAP zarfı içinde JSON string VE düz XML (iki farklı biçim)
 *   - bozuk/eksik kayıtlar sessizce yutulmaz, skipped'a sayılır
 *
 * Çalıştırma: node backend/test-ibb-parse.js
 */
const fs = require('fs');
const path = require('path');
const P = require('../scripts/ibb-parse');

const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'ibb');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

let passed = 0, failed = 0;
const assert = (name, cond) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
};

// --- Koordinat normalize -----------------------------------------------------
assert('koordinat: binlik ayraç kayması düzeltildi (289.700.000.000 -> 28.97)',
  Math.abs(P.num('289.700.000.000') - 28.97) < 1e-9);
assert('koordinat: virgüllü ondalık düzeltildi (41,0320 -> 41.032)',
  Math.abs(P.num('41,0320') - 41.032) < 1e-9);
assert('koordinat: normal ondalık bozulmadan geçti', P.num('41.0053') === 41.0053);
assert('koordinat: sayı girdi aynen geçti', P.num(28.9855) === 28.9855);
assert('koordinat: boş/geçersiz NaN', Number.isNaN(P.num('')) && Number.isNaN(P.num(null)));
assert('bbox: İstanbul dışı elendi', P.inIstanbul(41.01, 28.97) === true && P.inIstanbul(0, 0) === false);
// Gerçek mojibake: "Beşiktaş"ın UTF-8 baytları (C5 9F) Latin1 olarak çözülmüş hali.
// Fixture'a elle yazılmaz - kaynaktan üretilir ki "görünüşte doğru ama yanlış bayt"
// tuzağına düşmeyelim (ilk denemede tam olarak bu oldu: Å¸ ≠ Å\x9f).
const MOJIBAKE = Buffer.from('Beşiktaş', 'utf8').toString('latin1');
assert('mojibake: Latin1 çözülmüş UTF-8 geri çevrildi', P.fixText(MOJIBAKE) === 'Beşiktaş');
assert('mojibake: temiz metin bozulmadı', P.fixText('Kadıköy') === 'Kadıköy');
assert('mojibake: fixture gerçek bayt dizisini içeriyor',
  read('mojibake-sample.txt') === MOJIBAKE);

// --- Metro İstanbul: hatlar --------------------------------------------------
const { lines, skipped: lineSkip } = P.parseMetroLines(read('metro-lines.json'));
assert('metro hat: 4 geçerli hat ayrıştırıldı (adsız kayıt atlandı)', lines.length === 4 && lineSkip === 1);
assert('metro hat: M2 ref\'i uzun addan çıkarıldı', lines.find(l => l.ref === 'M2').name.includes('Yenikapı'));
assert('metro hat: T1 tramvay ref\'i tanındı', lines.some(l => l.ref === 'T1'));
assert('metro hat: Marmaray özel olarak tanındı', lines.some(l => l.ref === 'Marmaray'));
assert('metro hat: renk korundu', lines.find(l => l.ref === 'M2').color === '#00A94F');

// --- Metro İstanbul: yönler --------------------------------------------------
const { directions, skipped: dirSkip } = P.parseMetroDirections(read('metro-directions.json'));
assert('metro yön: 4 yön ayrıştırıldı (LineId eksik olan atlandı)', directions.length === 4 && dirSkip === 1);
assert('metro yön: lineId string olarak normalize edildi',
  directions.every(d => typeof d.lineId === 'string'));

// --- Metro İstanbul: istasyonlar ---------------------------------------------
const { stations, skipped: stSkip } = P.parseMetroStations(read('metro-stations.json'));
assert('metro istasyon: geçerli istasyonlar alındı, (0,0) elendi', stations.length === 11 && stSkip === 1);
assert('metro istasyon: virgüllü koordinat kurtarıldı',
  stations.some(s => s.name === 'Virgüllü Koordinat' && Math.abs(s.lat - 41.032) < 1e-9));
const m2 = stations.filter(s => s.lineId === '2').sort((a, b) => a.order - b.order);
assert('metro istasyon: M2 hattı 5 istasyon, sıralı', m2.length === 5 && m2[0].name === 'Yenikapı' && m2[4].name === 'Taksim');
assert('metro istasyon: yön bilgisi korundu', m2.every(s => s.directionId === '20'));

// --- İETT: SOAP içinde gömülü JSON -------------------------------------------
const l15 = P.parseIettLine('15', read('iett-line-15-json.xml'));
assert('iett json: SOAP zarfından JSON çözüldü', l15.sourceKind === 'json');
assert('iett json: 4 durak alındı, bozuk koordinat elendi', l15.stops.length === 4 && l15.skipped === 1);
assert('iett json: bozuk koordinatlar düzeltildi (28.97/41.0161)',
  Math.abs(l15.stops[0].lng - 28.97) < 1e-6 && Math.abs(l15.stops[0].lat - 41.0161) < 1e-6);
assert('iett json: duraklar SIRANO\'ya göre sıralı',
  l15.stops.map(s => s.name).join(',').startsWith('Eminönü,Karaköy,Kabataş'));
assert('iett json: mojibake durak adı düzeltildi', l15.stops[3].name === 'Beşiktaş');

// --- İETT: düz XML -----------------------------------------------------------
const l26 = P.parseIettLine('26A', read('iett-line-26A-xml.xml'));
assert('iett xml: düz XML Table kayıtları çözüldü', l26.sourceKind === 'xml' && l26.stops.length === 3);
assert('iett xml: koordinatlar doğru', Math.abs(l26.stops[0].lat - 40.9910) < 1e-6);
assert('iett xml: durak adları Türkçe karakterlerle', l26.stops[0].name === 'Kadıköy İskele');

// --- İETT: SOAP Fault --------------------------------------------------------
const fault = P.parseIettLine('999', read('iett-fault.xml'));
assert('iett fault: hata yanıtı çökmüyor, boş durak listesi dönüyor', fault.stops.length === 0);

// --- Bozuk girdilere dayanıklılık --------------------------------------------
for (const bad of ['', '<xml/>', '{}', '[]', null, undefined]) {
  try {
    P.parseIettLine('x', bad);
  } catch (e) {
    failed++; console.error(`  FAIL  bozuk girdi çökertti: ${JSON.stringify(bad)} -> ${e.message}`);
  }
}
assert('dayanıklılık: bozuk/boş girdiler çökertmiyor', true);
assert('dayanıklılık: boş JSON gövdesi boş sonuç veriyor', P.parseMetroLines('{}').lines.length === 0);

// ===========================================================================
// build-transit.js: kaynak birleştirme ve öncelik kuralı
// ===========================================================================
const os = require('os');
const B = require('../scripts/build-transit');

// Fixture'lardan geçici bir İBB önbelleği kur
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibb-cache-'));
for (const f of ['metro-lines.json', 'metro-stations.json', 'metro-directions.json']) {
  fs.copyFileSync(path.join(FIX, f), path.join(cacheDir, f));
}
fs.writeFileSync(path.join(cacheDir, 'iett-routes.json'), JSON.stringify({
  method: 'GetHat_json',
  lines: { 15: read('iett-line-15-json.xml'), '26A': read('iett-line-26A-xml.xml') },
}));

const iett = B.buildIettLines(cacheDir);
assert('birleştirme: İETT hatları LineString\'e çevrildi', iett.features.size === 2);
const f15 = iett.features.get('15');
assert('birleştirme: İETT hattı exact güven + stop-sequence etiketli',
  f15.properties.source === 'iett-soap' && f15.properties.confidence === 'exact'
  && f15.properties.geometry_kind === 'stop-sequence');
assert('birleştirme: koordinatlar [lng,lat] düzeninde (İstanbul ~28-29 lng)',
  f15.geometry.coordinates.every(([lng, lat]) => lng > 27.5 && lng < 30.2 && lat > 40.5 && lat < 41.9));
assert('birleştirme: durak sayısı ve uç duraklar kaydedildi',
  f15.properties.stop_count === 4 && f15.properties.first_stop === 'Eminönü');

const metro = B.buildMetroLines(cacheDir);
assert('birleştirme: metro hatları üretildi (M2, M4, Marmaray)', metro.features.size === 3);
const m2f = metro.features.get('M2');
assert('birleştirme: metro hattı YAKLAŞIK olarak etiketlendi (dürüstlük kuralı)',
  m2f.properties.confidence === 'approximate' && m2f.properties.geometry_kind === 'station-chain');
assert('birleştirme: metro hattında uyarı notu var', /gerçek ray güzergahı değildir/i.test(m2f.properties.note));
assert('birleştirme: metro renk bilgisi API\'den geldi', m2f.properties.color === '#00A94F');
assert('birleştirme: tek yön seçildi (ileri-geri katlanma yok)',
  m2f.geometry.coordinates.length === 5);

// Tek duraklı "hat" çizilmemeli
fs.writeFileSync(path.join(cacheDir, 'iett-routes.json'), JSON.stringify({
  method: 'x', lines: { 999: read('iett-fault.xml') },
}));
assert('birleştirme: durak dizisi olmayan hat çizilmiyor', B.buildIettLines(cacheDir).features.size === 0);

// Önbellek hiç yoksa çökmemeli (GTFS-only mod)
assert('birleştirme: önbellek yokken çökmüyor',
  B.buildIettLines('/yok/boyle/bir/dizin').features.size === 0
  && B.buildMetroLines('/yok/boyle/bir/dizin').features.size === 0);

// parseRefs: serbest metinden hat kodu çıkarma
const refs = B.parseRefs({
  iett_info: '15, 26A (Kadıköy yönü), Mevcut Değil',
  vapur_info: 'Boğaz Hattı',
  transit_transfer: 'M2 ve T1 aktarması, Marmaray, Metrobüs',
});
assert('parseRefs: otobüs kodları alındı, parantez içi atıldı',
  refs.filter(r => r.hint === 'bus').map(r => r.ref).join(',') === '15,26A');
assert('parseRefs: raylı hatlar tanındı (M2, T1, Marmaray)',
  refs.filter(r => r.hint === 'rail').map(r => r.ref).sort().join(',') === 'M2,Marmaray,T1');
assert('parseRefs: vapur ve metrobüs tanındı',
  refs.some(r => r.hint === 'ferry') && refs.some(r => r.hint === 'metrobus'));

fs.rmSync(cacheDir, { recursive: true, force: true });

console.log(`\n${passed} başarılı, ${failed} başarısız`);
process.exit(failed === 0 ? 0 : 1);
