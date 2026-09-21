#!/usr/bin/env node
/**
 * check-consistency.js - Belgelerin koda uyduğunu MAKİNEYLE doğrular.
 *
 * NEDEN VAR: bu projede belge birinci sınıf çıktı (CLAUDE.md: "kod ikincil, öğrenme ve
 * belgelenmiş karar birincil"). Ama belge insan eliyle güncellenirse kaçınılmaz olarak
 * koddan ayrışır - git geçmişinde tekrar eden "belgeleri güncel koda senkronla" commit'leri
 * bunun kanıtı. Bir iddiayı yorumla değil, TESTLE korumak gerekir.
 *
 * Bu script prose okumaz; belgelerdeki YAPISAL iddiaları (API tablosu, migration sayısı,
 * seed sürümü, kapsam sayıları) koddan üretilen gerçekle karşılaştırır.
 *
 * VERİTABANI GEREKTİRMEZ: tüm kontroller dosya okumasıyla yapılır, böylece CI'da ve
 * PostgreSQL çalışmayan bir makinede de koşar.
 *
 * Kullanım:  node scripts/check-consistency.js   (npm run check)
 * Çıkış kodu: 0 = tutarlı, 1 = kayma var
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(REPO, p));

const problems = [];
const notes = [];
const ok = [];
const check = (name, condition, detail = '') => {
  if (condition) { ok.push(name); console.log(`  ✓ ${name}`); }
  else { problems.push({ name, detail }); console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('[check] Belge ↔ kod tutarlılığı\n');

// ---------------------------------------------------------------------------
// 1. API tablosu ↔ server.js'teki gerçek rotalar
// ---------------------------------------------------------------------------
console.log('1) API uçları');
const serverSrc = read('backend/server.js');
const routes = [...serverSrc.matchAll(/app\.(get|post|patch|delete|put)\(\s*'([^']+)'/g)]
  .map((m) => `${m[1].toUpperCase()} ${m[2]}`)
  .filter((r) => r.includes('/api/'));

const dbDoc = read('DATABASE.md');
// Belgedeki tablo satırları: | METOD | `/yol` | ... |
const documented = [...dbDoc.matchAll(/^\|\s*(GET|POST|PATCH|DELETE|PUT)\s*\|\s*`([^`]+)`/gm)]
  .map((m) => `${m[1]} ${m[2].split('?')[0]}`);

const undocumented = routes.filter((r) => !documented.includes(r));
const ghost = documented.filter((d) => !routes.includes(d));

check(`server.js'teki ${routes.length} ucun tümü DATABASE.md'de belgeli`,
  undocumented.length === 0,
  undocumented.length ? `Belgesiz: ${undocumented.join(', ')}` : '');
check('DATABASE.md hayali uç listelemiyor',
  ghost.length === 0,
  ghost.length ? `Kodda YOK ama belgede var: ${ghost.join(', ')}` : '');

// ---------------------------------------------------------------------------
// 2. Migration sayısı ↔ schema.sql ↔ ADR referansları
// ---------------------------------------------------------------------------
console.log('\n2) Şema ve migration');
const dbSrc = read('backend/database.js');
const versions = [...dbSrc.matchAll(/^\s*version:\s*(\d+),/gm)].map((m) => Number(m[1]));
const maxVersion = Math.max(...versions);

check('migration sürümleri kesintisiz ve artan',
  versions.length > 0 && versions.every((v, i) => v === i + 1),
  `Bulunan: ${versions.join(', ')}`);

if (exists('schema.sql')) {
  const schemaHeader = read('schema.sql').slice(0, 1200);
  const declared = (schemaHeader.match(/migration sürümleri:\s*([\d, ]+)/) || [, ''])[1]
    .split(',').map((s) => Number(s.trim())).filter(Boolean);
  check(`schema.sql güncel (v${maxVersion} içeriyor)`,
    declared.includes(maxVersion),
    `schema.sql: v${declared.join(',')} — 'npm run export:schema' çalıştırın`);
  check('schema.sql PostgreSQL DDL\'i (SQLite kalıntısı yok)',
    !/AUTOINCREMENT|PRAGMA|sqlite_/i.test(read('schema.sql')));
}

// ---------------------------------------------------------------------------
// 3. Seed senkronu: kanonik kaynak ↔ Pages replikası
// ---------------------------------------------------------------------------
console.log('\n3) Seed replikası');
const seedA = read('data/seed.json');
const seedB = read('docs/data/seed.json');
check('data/seed.json ile docs/data/seed.json birebir aynı',
  seedA === seedB,
  'Farklılar — `cp data/seed.json docs/data/seed.json` ve version\'ı artırın (DATABASE.md)');
const vA = JSON.parse(seedA).version;
check('seed.json version alanı var (Pages replikası tazelenebilsin)',
  Number.isInteger(vA), `version=${vA}`);

// ---------------------------------------------------------------------------
// 4. ADR bütünlüğü
// ---------------------------------------------------------------------------
console.log('\n4) ADR\'ler');
const adrDir = path.join(REPO, 'docs', 'adr');
const adrs = fs.readdirSync(adrDir).filter((f) => /^ADR-\d+/.test(f)).sort();
const adrNums = adrs.map((f) => Number(f.match(/ADR-(\d+)/)[1]));
check(`ADR numaraları kesintisiz (ADR-001..${String(Math.max(...adrNums)).padStart(3, '0')})`,
  adrNums.every((n, i) => n === i + 1),
  `Bulunan: ${adrNums.join(', ')}`);
check('her ADR bir Durum satırı taşıyor',
  adrs.every((f) => /- \*\*Durum:\*\*/.test(fs.readFileSync(path.join(adrDir, f), 'utf8'))));

// README ve CLAUDE.md ADR aralığını doğru söylüyor mu?
const readme = read('README.md');
const adrRangeClaim = readme.match(/ADR-001\s*…\s*ADR-(\d+)/);
if (adrRangeClaim) {
  check('README\'deki ADR aralığı gerçek dosyalarla uyuşuyor',
    Number(adrRangeClaim[1]) === Math.max(...adrNums),
    `README: ADR-${adrRangeClaim[1]}, gerçek: ADR-${Math.max(...adrNums)}`);
}

// ---------------------------------------------------------------------------
// 5. Test dosyaları npm test'te koşuyor mu?
// ---------------------------------------------------------------------------
console.log('\n5) Test kapsamı');
const pkg = JSON.parse(read('package.json'));
const testScript = pkg.scripts.test || '';
const testFiles = fs.readdirSync(path.join(REPO, 'backend'))
  .filter((f) => /^test-.*\.js$/.test(f) && f !== 'test-helper.js');
const notRun = testFiles.filter((f) => !testScript.includes(f));
check(`${testFiles.length} test dosyasının tümü npm test'te koşuyor`,
  notRun.length === 0,
  notRun.length ? `Koşmayan: ${notRun.join(', ')}` : '');

// ---------------------------------------------------------------------------
// 6. Platform tutarlılığı: SQLite kalıntısı var mı? (ADR-009 sonrası)
// ---------------------------------------------------------------------------
console.log('\n6) Platform (ADR-009 sonrası PostgreSQL)');
const SELF = path.relative(REPO, __filename);
const codeFiles = [
  ...fs.readdirSync(path.join(REPO, 'backend')).filter((f) => f.endsWith('.js')).map((f) => `backend/${f}`),
  ...fs.readdirSync(path.join(REPO, 'scripts')).filter((f) => f.endsWith('.js')).map((f) => `scripts/${f}`),
].filter((f) => f !== SELF);  // bu dosya aranan deseni metin olarak içeriyor, kendini eleme
const sqliteLeftovers = codeFiles.filter((f) => /require\(['"]node:sqlite['"]\)|DatabaseSync/.test(read(f)));
check('kodda node:sqlite kullanımı kalmadı',
  sqliteLeftovers.length === 0,
  sqliteLeftovers.join(', '));
check('backend/package.json kaldırıldı (tek kök npm projesi)', !exists('backend/package.json'));
check('pg bağımlılığı kökte tanımlı', !!(pkg.dependencies && pkg.dependencies.pg));

// ---------------------------------------------------------------------------
// 7. Türetilmiş veri: transit kapsamı (bilgi amaçlı, hata değil)
// ---------------------------------------------------------------------------
console.log('\n7) Türetilmiş veri durumu');
if (exists('docs/data/transit-routes.geojson')) {
  const gj = JSON.parse(read('docs/data/transit-routes.geojson'));
  const cov = gj.meta && gj.meta.coverage;
  if (cov) {
    const line = `Toplu taşıma kapsamı: ${cov.facilities_with_lines}/${gj.meta.facility_count} tesis (%${cov.pct})`;
    console.log(`  · ${line}`);
    if (cov.pct < 80) {
      notes.push(`${line} — artırmak için: npm run fetch:ibb && npm run build:transit (ADR-008)`);
      console.log(`    ↳ %80'in altında. npm run fetch:ibb && npm run build:transit (ADR-008)`);
    }
    const sources = gj.meta.sources || {};
    console.log(`  · Kaynaklar: ${Object.entries(sources).map(([k, v]) => `${k}=${v.lines}`).join('  ')}`);
  }
}
if (exists('docs/data/analytics.json')) {
  const gen = JSON.parse(read('docs/data/analytics.json')).generated_at;
  const days = (Date.now() - new Date(gen)) / 86400000;
  console.log(`  · analytics.json snapshot yaşı: ${days.toFixed(1)} gün`);
  if (days > 30) notes.push(`analytics.json ${days.toFixed(0)} gündür güncellenmemiş — npm run export:analytics`);
}

// ---------------------------------------------------------------------------
// Özet
// ---------------------------------------------------------------------------
console.log(`\n[check] ${ok.length} kontrol geçti, ${problems.length} kayma bulundu.`);
if (notes.length) {
  console.log('\nBilgi notları (hata değil):');
  notes.forEach((n) => console.log(`  · ${n}`));
}
if (problems.length) {
  console.error('\nDüzeltilmesi gerekenler:');
  problems.forEach((p) => console.error(`  ✗ ${p.name}${p.detail ? ` — ${p.detail}` : ''}`));
  process.exit(1);
}
