/**
 * test-db.js - Merkezi veri katmanı için duman testleri (PostgreSQL + PostGIS).
 * Çalıştırma: node backend/test-db.js  (izole bir şema kullanır, gerçek veriye dokunmaz)
 */
const t = require('./test-helper').setup('db');
const { assert } = t;

const db = require('./db');
const { validateReservationInput } = require('./validate');
const { verifyPassword } = require('./database');
const { signJwt, verifyJwt } = require('./security');

(async () => {
  const conn = await t.init({ geo: true });

  // 1. Seed doğrulaması: kanonik veri tek kaynaktan yüklendi mi?
  const facilities = await db.getFacilities();
  assert('seed: 30 tesis yüklendi', facilities.length === 30);
  assert('seed: transit bilgisi korundu', facilities[0].transit.otobus.includes('39D'));
  assert('seed: API şekli değişmedi (koordinatlar dizisi)', Array.isArray(facilities[0].koordinatlar));

  // 2. Kimlik: kullanıcı seed edildi; parola PHC formatında ve ham DEĞİL.
  const admin = await db.getUserByUsername('admin');
  assert('auth: admin kullanıcısı seed edildi', !!admin);
  assert('auth: parola PHC formatında saklanıyor', /^pbkdf2_sha256\$\d+\$/.test(admin.password));

  // 3. PostGIS KNN: sonuçlar METRE cinsinden artan sırada olmalı.
  // (geometry <-> derece ölçer ve 41°N'de sırayı bozabilir; bu yüzden geography kullanıyoruz.)
  const closest = await db.getClosestFacilities(41.0369, 28.9850, 3); // Taksim
  assert('kNN: 3 sonuç döndü', closest.length === 3);
  assert('kNN: gerçekten mesafeye göre sıralı (jeodezik metre)',
    closest.every((c, i) => i === 0 || closest[i - 1].distance <= c.distance));
  assert('kNN: mesafe metre cinsinden makul (İstanbul içi < 50km)',
    closest[0].distance > 0 && closest[0].distance < 50000);

  // 3b. PostGIS mekansal join: ilçe sınırları × tesis noktaları
  const districts = await db.getDistricts();
  assert('PostGIS: ilçeler FeatureCollection olarak döndü', districts.type === 'FeatureCollection' && districts.features.length === 39);
  assert('PostGIS: geometri GeoJSON olarak geldi', !!districts.features[0].geometry.type);
  const totalInDistricts = districts.features.reduce((s, f) => s + f.properties.facilityCount, 0);
  assert('PostGIS: ST_Contains 30 tesisin tümünü bir ilçeye yerleştirdi', totalInDistricts === 30);
  assert('PostGIS: alarm seviyesi hesaplandı',
    districts.features.every(f => ['RED', 'AMBER', 'GREEN'].includes(f.properties.alarmLevel)));

  // 4. Rezervasyon transaction'ı
  const user = await db.getUserByUsername('user');
  const target = facilities.find(f => f.dolulukOrani < 90);
  const r1 = await db.createReservation({
    userId: user.id, facilityId: target.id,
    reserveDate: '2026-08-01', reserveTime: '19:00', guests: 4,
    cryptoSignature: 'test-sig'
  });
  assert('tx: rezervasyon oluştu', Number.isInteger(r1.id));
  assert('tx: per-slot booked doğru', r1.booked === 4 && r1.remaining === target.kapasite - 4);
  assert('tx: rezervasyon sorgulanabiliyor', (await db.getReservationsByUserId(user.id)).length === 1);

  // 5. Çifte rezervasyon UNIQUE kısıtı ile engellenmeli (23505 = unique_violation)
  const dup = await t.expectThrow(() => db.createReservation({
    userId: user.id, facilityId: target.id,
    reserveDate: '2026-08-01', reserveTime: '19:00', guests: 2, cryptoSignature: 'test-sig-2'
  }));
  assert('kısıt: çifte rezervasyon engellendi (23505)', dup && dup.code === '23505');

  // 6. Kapasite aşımı reddedilmeli
  const capErr = await t.expectThrow(() => db.createReservation({
    userId: user.id, facilityId: target.id,
    reserveDate: '2026-08-02', reserveTime: '13:00', guests: 100000, cryptoSignature: 'test-sig-3'
  }));
  assert('kısıt: kapasite aşımı reddedildi (409)', capErr && capErr.statusCode === 409);

  // 7. CHECK kısıtları geçersiz tesisleri veritabanı seviyesinde reddetmeli (23514)
  const chk = await t.expectThrow(() =>
    db.createFacility({ kod: 'TEST-XX', ad: 'Geçersiz', lat: 999, lng: 29, capacity: 10 }, admin.id));
  assert('kısıt: geçersiz koordinat reddedildi (CHECK 23514)', chk && chk.code === '23514');

  // 8. Tesis silme: FK cascade rezervasyonları da temizlemeli
  const created = await db.createFacility({ kod: 'TEST-01', ad: 'Test Tesisi', lat: 41.0, lng: 29.0, capacity: 50, occupancy: 10 }, admin.id);
  await db.createReservation({
    userId: user.id, facilityId: created.id,
    reserveDate: '2026-08-03', reserveTime: '10:00', guests: 2, cryptoSignature: 'test-sig-4'
  });
  await db.deleteFacility(created.id, admin.id);
  const orphans = (await db.getReservationsByUserId(user.id)).filter(r => r.facility_id === created.id);
  assert('FK: cascade silme yetim rezervasyon bırakmadı', orphans.length === 0);

  // 8a-2. geom OLUŞTURULMUŞ kolon: lat/lng ile ASLA ayrışamaz (elle yazılamaz)
  const geomWrite = await t.expectThrow(() =>
    conn.run('UPDATE facilities SET geom = ST_SetSRID(ST_MakePoint(0,0),4326) WHERE id = 1'));
  assert('PostGIS: geom generated kolon, elle yazılamıyor', geomWrite !== null);
  const geomCheck = await conn.one('SELECT ST_X(geom) x, ST_Y(geom) y, lat, lng FROM facilities WHERE id = 1');
  assert('PostGIS: geom lat/lng ile birebir tutarlı',
    Math.abs(geomCheck.x - geomCheck.lng) < 1e-9 && Math.abs(geomCheck.y - geomCheck.lat) < 1e-9);

  // ==========================================================================
  // Per-slot kapasite, türetilmiş doluluk, İSPARK, giriş doğrulama
  // ==========================================================================
  const smallFac = await db.createFacility({ kod: 'SLOT-01', ad: 'Slot Testi', lat: 41, lng: 29, capacity: 5, occupancy: 0 }, admin.id);
  const su1 = await db.createUser('slot_u1', 'p');
  const su2 = await db.createUser('slot_u2', 'p');
  await db.createReservation({ userId: su1.id, facilityId: smallFac.id, reserveDate: '2026-09-01', reserveTime: '19:00', guests: 4, cryptoSignature: 'c' });

  const slotFull = await t.expectThrow(() => db.createReservation({
    userId: su2.id, facilityId: smallFac.id, reserveDate: '2026-09-01', reserveTime: '19:00', guests: 3, cryptoSignature: 'c'
  }));
  assert('per-slot: kapasiteyi aşan ikinci rezervasyon reddedildi (5 kap, 4+3)', slotFull && slotFull.statusCode === 409);

  const fit = await db.createReservation({ userId: su2.id, facilityId: smallFac.id, reserveDate: '2026-09-01', reserveTime: '19:00', guests: 1, cryptoSignature: 'c' });
  assert('per-slot: kalan yere sığan rezervasyon kabul edildi', fit.booked === 5 && fit.remaining === 0);

  const otherSlot = await db.createReservation({ userId: su1.id, facilityId: smallFac.id, reserveDate: '2026-09-01', reserveTime: '13:00', guests: 4, cryptoSignature: 'c' });
  assert('per-slot: farklı slot bağımsız kapasiteye sahip', otherSlot.booked === 4);

  // TÜRETİLMİŞ DOLULUK (migration v7): dolulukOrani artık elle girilen bir alan değil,
  // o günün iptal edilmemiş rezervasyonlarından hesaplanır.
  const OCC_DATE = '2026-09-01';  // smallFac'te 19:00 (5 koltuk) + 13:00 (4 koltuk) dolu
  const occFac = await db.getFacilityById(smallFac.id, OCC_DATE);
  assert('doluluk: o günün rezerve koltukları sayıldı (5+4=9)', occFac.dolulukKaynagi.rezerveKoltuk === 9);
  assert('doluluk: kapasiteye oranla hesaplandı ve 100 ile sınırlandı (9/5 -> 100)', occFac.dolulukOrani === 100);
  assert('doluluk: hesabın hangi tarihe ait olduğu şeffaf', occFac.dolulukKaynagi.tarih === OCC_DATE);

  const emptyDay = await db.getFacilityById(smallFac.id, '2027-01-01');
  assert('doluluk: rezervasyonsuz günde 0', emptyDay.dolulukOrani === 0 && emptyDay.dolulukKaynagi.rezerveKoltuk === 0);

  // Elle girilen gösterge ayrı alanda durur ve gerçek doluluğu ARTIK EZMİYOR.
  const manualFac = await db.createFacility({ kod: 'OCC-01', ad: 'Doluluk Testi', lat: 41, lng: 29, capacity: 10, occupancy: 95 }, admin.id);
  const manualRead = await db.getFacilityById(manualFac.id, '2027-03-01');
  assert('doluluk: elle girilen 95 gerçek doluluğu ezmiyor (gerçek = 0)', manualRead.dolulukOrani === 0);
  assert('doluluk: elle girilen işaret ayrı alanda korunuyor', manualRead.dolulukKaynagi.manuelIsaret === 95);

  await db.createReservation({ userId: su1.id, facilityId: manualFac.id, reserveDate: '2027-03-01', reserveTime: '13:00', guests: 5, cryptoSignature: 'c' });
  assert('doluluk: yeni rezervasyon doluluğu ANINDA yükseltti (5/10 -> 50)',
    (await db.getFacilityById(manualFac.id, '2027-03-01')).dolulukOrani === 50);

  const cancelRes = await db.createReservation({ userId: su2.id, facilityId: manualFac.id, reserveDate: '2027-03-01', reserveTime: '16:00', guests: 4, cryptoSignature: 'c' });
  await conn.run("UPDATE reservations SET status='cancelled' WHERE id=$1", [cancelRes.id]);
  assert('doluluk: iptal edilen rezervasyon sayılmıyor (hâlâ 50)',
    (await db.getFacilityById(manualFac.id, '2027-03-01')).dolulukOrani === 50);

  // İSPARK atomik take/release + CHECK (seed'li tesis 1 üzerinde)
  const ISPARK_FAC = 1;
  const ip = await db.getIsparkStatus(ISPARK_FAC);
  assert('İSPARK: seed ile kayıt oluştu', ip && ip.capacity >= 1 && ip.occupied === 0);
  let taken = 0;
  for (let i = 0; i < ip.capacity + 3; i++) { if (await db.takeIsparkSpot(ISPARK_FAC)) taken++; }
  assert('İSPARK: en fazla kapasite kadar yer kapıldı', taken === ip.capacity);
  assert('İSPARK: dolu olunca take başarısız', (await db.takeIsparkSpot(ISPARK_FAC)) === false);
  assert('İSPARK: release bir yer açar',
    (await db.releaseIsparkSpot(ISPARK_FAC)) === true && (await db.getIsparkStatus(ISPARK_FAC)).occupied === ip.capacity - 1);

  // Giriş doğrulama (validate.js)
  assert('validate: geçerli girdi kabul', validateReservationInput({ facilityId: 1, reserveDate: '2999-01-01', reserveTime: '19:00', guests: 2 }).ok === true);
  assert('validate: geçersiz slot reddi', validateReservationInput({ facilityId: 1, reserveDate: '2999-01-01', reserveTime: '12:00', guests: 2 }).ok === false);
  assert('validate: geçmiş tarih reddi', validateReservationInput({ facilityId: 1, reserveDate: '2000-01-01', reserveTime: '19:00', guests: 2 }).ok === false);
  assert('validate: negatif guests reddi', validateReservationInput({ facilityId: 1, reserveDate: '2999-01-01', reserveTime: '19:00', guests: -1 }).ok === false);
  assert('validate: bebe sandalyesi > guests reddi', validateReservationInput({ facilityId: 1, reserveDate: '2999-01-01', reserveTime: '19:00', guests: 2, highchairCount: 3 }).ok === false);

  // ==========================================================================
  // Şema / kısıt testleri (migration v2)
  // ==========================================================================
  const menuCount = (await conn.one('SELECT COUNT(*)::int AS n FROM menu_items')).n;
  assert('menü: şablon tüm tesislere uygulandı (30x14=420)', menuCount === 420);
  assert('menü: bir tesiste 14 kalem', (await conn.one('SELECT COUNT(*)::int AS n FROM menu_items WHERE facility_id = 1')).n === 14);
  assert('menü: fiyat kuruş (integer)', Number.isInteger((await conn.one('SELECT price_minor FROM menu_items LIMIT 1')).price_minor));

  const menuDup = await t.expectThrow(() =>
    conn.run('INSERT INTO menu_items (facility_id, name, category, price_minor) VALUES (1,$1,$2,$3)', ['Çay', 'Sıcak İçecek', 1500]));
  assert('menü kısıt: aynı tesiste çift ad reddedildi (23505)', menuDup && menuDup.code === '23505');

  const cols = new Set((await conn.all(
    "SELECT column_name FROM information_schema.columns WHERE table_name='reservations' AND table_schema=$1", [t.schema]
  )).map(c => c.column_name));
  assert('şema: reservations yeni kolonlar eklendi', ['status', 'amount_minor', 'payment_type', 'highchair_count'].every(c => cols.has(c)));

  const hcErr = await t.expectThrow(() => conn.run(
    `INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature, highchair_count)
     VALUES ($1, 1, '2027-01-01', '10:00', 2, 'x', -1)`, [user.id]));
  assert('rez kısıt: negatif highchair_count reddedildi (CHECK 23514)', hcErr && hcErr.code === '23514');

  // GERÇEK date/time tipi kazancı: SQLite'ta TEXT olduğu için "2027-13-45" kabul edilirdi.
  const badDate = await t.expectThrow(() => conn.run(
    `INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
     VALUES ($1, 1, '2027-13-45', '10:00', 2, 'x')`, [user.id]));
  assert('tip: imkansız tarih (2027-13-45) DB seviyesinde reddedildi', badDate !== null);

  // Sipariş + FK cascade
  const resId = (await conn.one(
    `INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
     VALUES ($1, 1, '2027-02-02', '13:00', 2, 'sig') RETURNING id`, [user.id])).id;
  const orderId = (await conn.one('INSERT INTO orders (reservation_id) VALUES ($1) RETURNING id', [resId])).id;
  const menuItem = await conn.one('SELECT id, price_minor FROM menu_items WHERE facility_id = 1 LIMIT 1');
  await conn.run('INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_minor) VALUES ($1,$2,$3,$4)',
    [orderId, menuItem.id, 2, menuItem.price_minor]);
  assert('sipariş: rezervasyona bağlı sipariş + kalem oluştu',
    (await conn.one('SELECT COUNT(*)::int AS n FROM order_items WHERE order_id = $1', [orderId])).n === 1);

  const qtyErr = await t.expectThrow(() =>
    conn.run('INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_minor) VALUES ($1,$2,0,100)', [orderId, menuItem.id]));
  assert('sipariş kısıt: quantity=0 reddedildi (CHECK 23514)', qtyErr && qtyErr.code === '23514');

  await conn.run('DELETE FROM reservations WHERE id = $1', [resId]);
  assert('FK: rezervasyon silinince sipariş cascade silindi',
    (await conn.one('SELECT COUNT(*)::int AS n FROM orders WHERE reservation_id = $1', [resId])).n === 0);
  assert('FK: sipariş silinince kalemler cascade silindi',
    (await conn.one('SELECT COUNT(*)::int AS n FROM order_items WHERE order_id = $1', [orderId])).n === 0);

  // ==========================================================================
  // Kriptografi (ADR-002)
  // ==========================================================================
  await db.createUser('kripto_test_1', 'S3cret-Parola!');
  const rec1 = await db.getUserByUsername('kripto_test_1');
  assert('kripto: doğru parola doğrulandı', verifyPassword('S3cret-Parola!', rec1.password) === true);
  assert('kripto: yanlış parola reddedildi', verifyPassword('yanlis', rec1.password) === false);

  await db.createUser('kripto_test_2', 'AyniParola123');
  await db.createUser('kripto_test_3', 'AyniParola123');
  const r2 = (await db.getUserByUsername('kripto_test_2')).password;
  const r3 = (await db.getUserByUsername('kripto_test_3')).password;
  assert('kripto: aynı parola farklı hash (salt çalışıyor)', r2 !== r3);
  assert('kripto: ikisi de doğrulanabiliyor', verifyPassword('AyniParola123', r2) && verifyPassword('AyniParola123', r3));

  const token = signJwt({ id: 1, username: 'x', role: 'admin' });
  const decoded = verifyJwt(token);
  assert('jwt: geçerli token çözüldü', decoded && decoded.username === 'x' && decoded.role === 'admin');
  assert('jwt: exp claim eklendi', typeof decoded.exp === 'number' && decoded.exp > decoded.iat);
  assert('jwt: kurcalanmış imza reddedildi', verifyJwt(token.slice(0, -3) + 'AAA') === null);

  const parts = token.split('.');
  const b64urlJson = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const expiredPayload = b64urlJson({ id: 1, username: 'x', role: 'admin', iat: 1, exp: 2 });
  const forgedSig = require('crypto')
    .createHmac('sha256', process.env.JWT_SECRET || 'DEV-ONLY-INSECURE-SECRET-do-not-use-in-production')
    .update(`${parts[0]}.${expiredPayload}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert('jwt: süresi geçmiş token reddedildi', verifyJwt(`${parts[0]}.${expiredPayload}.${forgedSig}`) === null);

  await t.finish();
})().catch(async (err) => {
  console.error('\nTEST ÇÖKTÜ:', err);
  await require('./database').dropSchema().catch(() => {});
  process.exit(1);
});
