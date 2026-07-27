#!/usr/bin/env node
/**
 * demo-reset.js - Sunum için tertemiz bir `demo` şeması kurar.
 *
 * NEDEN AYRI ŞEMA: `public` şemasında 425 bin üretilmiş rezervasyon var. Orada "uygulamada
 * rezervasyon yaptım, DBeaver'da satır belirdi" demosu yapmak, samanlıkta iğne aramak gibi.
 * `demo` şemasında 0 rezervasyonla başlarsınız: yaptığınız her işlem tablonun TEK satırı
 * olarak belirir - mentör ekranda hiçbir şey aramak zorunda kalmaz.
 *
 * NASIL ÇALIŞIYOR: yeni altyapı GEREKMİYOR. `database.js` zaten PG_SCHEMA ortam değişkenini
 * search_path'e çeviriyor (testler bunu kullanıyor). Biz sadece o mekanizmayı sunum için
 * yeniden kullanıyoruz.
 *
 * Kullanım:
 *   npm run demo:reset     # şemayı sıfırla ve küçük veriyle doldur
 *   npm run demo:start     # backend'i demo şemasına bağlı başlat
 *
 * Sonra DBeaver'da `demo` şemasına bakın. `public` şemasındaki gerçek/büyük veri
 * ETKİLENMEZ - iki dünya birbirinden tamamen ayrı.
 */
process.env.PG_SCHEMA = process.env.PG_SCHEMA || 'demo';

const { loadEnv } = require('../backend/env');
loadEnv();

const { db, init, close, hashPassword } = require('../backend/database');
const { loadDistrictGeometry } = require('../backend/geo');

// Sunumda giriş yapabilmek için parolalar SABİT ve BİLİNİR olmalı.
// Bunlar yalnız `demo` şemasında yaşar; gerçek `public` şemasındaki kullanıcıların
// parolaları hâlâ rastgele üretiliyor ve data/dev-credentials.json'da (gitignored).
const DEMO_USERS = [
  { username: 'demo_admin',   password: 'DemoAdmin2026', role: 'admin' },
  { username: 'ayse',         password: 'AyseParola26',  role: 'user'  },
  { username: 'mehmet',       password: 'MehmetParola26', role: 'user' },
];

// Haritada dağınık dursunlar diye iki yakadan seçilmiş 5 tesis.
const KEEP_FACILITY_IDS = [1, 2, 5, 10, 22];

(async () => {
  const schema = process.env.PG_SCHEMA;
  console.log(`[demo] Şema: ${schema}`);

  // 1) Şemayı tamamen düşür - "sıfırla" gerçekten sıfırdan demek.
  //    (init() şemayı yeniden oluşturacak.)
  await db().run(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  console.log('[demo] Eski şema düşürüldü.');

  // 2) Migration + standart seed (30 tesis, menü, İSPARK).
  await init();
  console.log('[demo] Migration + seed tamam.');

  // 3) İlçe geometrisi (PostGIS demosu için gerekli).
  const geo = await loadDistrictGeometry(db());
  console.log(`[demo] ${geo.features} ilçe geometrisi yüklendi.`);

  // 4) KÜÇÜLT: 5 tesis kalsın. FK cascade menüleri/İSPARK'ı da temizler.
  const removed = await db().run(
    `DELETE FROM facilities WHERE id <> ALL($1::int[])`, [KEEP_FACILITY_IDS]
  );
  console.log(`[demo] ${removed} tesis kaldırıldı, ${KEEP_FACILITY_IDS.length} tanesi bırakıldı.`);

  // 5) Tohumlanan rastgele parolalı kullanıcıları at, SABİT parolalı demo kullanıcıları koy.
  await db().run('DELETE FROM users');
  for (const u of DEMO_USERS) {
    await db().run('INSERT INTO users (username, password, role) VALUES ($1,$2,$3)',
      [u.username, hashPassword(u.password), u.role]);
  }
  console.log(`[demo] ${DEMO_USERS.length} demo kullanıcısı oluşturuldu.`);

  // 6) Rezervasyon/sipariş/audit SIFIR olmalı - demonun tüm amacı bu.
  //    (users silinince cascade ile zaten gittiler; yine de doğrulayalım.)
  const counts = await db().one(`
    SELECT (SELECT COUNT(*)::int FROM facilities)   AS tesis,
           (SELECT COUNT(*)::int FROM users)        AS kullanici,
           (SELECT COUNT(*)::int FROM menu_items)   AS menu,
           (SELECT COUNT(*)::int FROM reservations) AS rezervasyon,
           (SELECT COUNT(*)::int FROM orders)       AS siparis,
           (SELECT COUNT(*)::int FROM audit_log)    AS audit,
           (SELECT COUNT(*)::int FROM districts WHERE geom IS NOT NULL) AS ilce_geom
  `);

  console.log('\n[demo] HAZIR. Tablo durumu:');
  console.log(`   tesis        : ${counts.tesis}`);
  console.log(`   kullanıcı    : ${counts.kullanici}`);
  console.log(`   menü kalemi  : ${counts.menu}`);
  console.log(`   rezervasyon  : ${counts.rezervasyon}   <- sunumda burayı izleyeceksiniz`);
  console.log(`   sipariş      : ${counts.siparis}   <- ve burayı`);
  console.log(`   audit_log    : ${counts.audit}   <- ve burayı`);
  console.log(`   ilçe (geom)  : ${counts.ilce_geom}`);

  if (counts.rezervasyon !== 0 || counts.siparis !== 0) {
    console.error('[demo] HATA: rezervasyon/sipariş sıfır değil - demo senaryosu bozulur.');
    process.exitCode = 1;
  }

  console.log('\n[demo] Giriş bilgileri (yalnız bu şemada geçerli):');
  DEMO_USERS.forEach((u) => console.log(`   ${u.username.padEnd(12)} / ${u.password}   (${u.role})`));
  console.log('\n[demo] Sırada:  npm run demo:start');
  console.log('[demo] DBeaver\'da bakılacak şema: ' + schema);

  await close();
})().catch(async (err) => {
  console.error('[demo] HATA:', err.message);
  await close().catch(() => {});
  process.exit(1);
});
