/**
 * test-db.js - Merkezi veri katmani icin duman testleri.
 * Calistirma: node backend/test-db.js  (gecici bir DB dosyasi kullanir, gercek veriye dokunmaz)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Gercek data/app.db yerine gecici dosya kullan
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-test-')), 'test.db');

const db = require('./db');
const { hashPassword, getDb } = require('./database');

let passed = 0;
let failed = 0;
const assert = (name, condition) => {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
};

// 1. Seed dogrulamasi: kanonik veri tek kaynaktan yuklendi mi?
const facilities = db.getFacilities();
assert('seed: 30 tesis yüklendi', facilities.length === 30);
assert('seed: transit bilgisi korundu', facilities[0].transit.otobus.includes('39D'));
assert('seed: API şekli değişmedi (koordinatlar dizisi)', Array.isArray(facilities[0].koordinatlar));

// 2. Kimlik: kullanıcı seed edildi; parola PHC formatında ve ham DEĞİL.
const admin = db.getUserByUsername('admin');
assert('auth: admin kullanıcısı seed edildi', !!admin);
assert('auth: parola PHC formatında saklanıyor', /^pbkdf2_sha256\$\d+\$/.test(admin.password));

// 3. KNN yakınlık analizi DB üzerinden çalışıyor mu?
const closest = db.getClosestFacilities(41.0369, 28.9850, 3); // Taksim
assert('kNN: 3 sonuç döndü', closest.length === 3);
assert('kNN: mesafeye göre sıralı', closest[0].distance <= closest[1].distance);

// 4. Rezervasyon transaction'ı: kayıt + doluluk güncellemesi atomik mi?
const user = db.getUserByUsername('user');
const target = facilities.find(f => f.dolulukOrani < 90);
const before = db.getFacilityById(target.id).dolulukOrani;
const r1 = db.createReservation({
  userId: user.id, facilityId: target.id,
  reserveDate: '2026-08-01', reserveTime: '19:00', guests: 4,
  cryptoSignature: 'test-sig'
});
assert('tx: rezervasyon oluştu', Number.isInteger(r1.id));
assert('tx: doluluk oranı güncellendi', db.getFacilityById(target.id).dolulukOrani >= before);
assert('tx: rezervasyon sorgulanabiliyor', db.getReservationsByUserId(user.id).length === 1);

// 5. Çifte rezervasyon UNIQUE kısıtı ile engellenmeli, doluluk değişmemeli (rollback)
const occBeforeDup = db.getFacilityById(target.id).dolulukOrani;
let dupBlocked = false;
try {
  db.createReservation({
    userId: user.id, facilityId: target.id,
    reserveDate: '2026-08-01', reserveTime: '19:00', guests: 2,
    cryptoSignature: 'test-sig-2'
  });
} catch (err) {
  dupBlocked = String(err.message).includes('UNIQUE');
}
assert('kısıt: çifte rezervasyon engellendi', dupBlocked);
assert('tx: rollback doluluğu geri aldı', db.getFacilityById(target.id).dolulukOrani === occBeforeDup);

// 6. Kapasite aşımı reddedilmeli
let capacityBlocked = false;
try {
  db.createReservation({
    userId: user.id, facilityId: target.id,
    reserveDate: '2026-08-02', reserveTime: '12:00', guests: 100000,
    cryptoSignature: 'test-sig-3'
  });
} catch (err) {
  capacityBlocked = err.statusCode === 409;
}
assert('kısıt: kapasite aşımı reddedildi', capacityBlocked);

// 7. CHECK kısıtları geçersiz tesisleri veritabanı seviyesinde reddetmeli
let checkBlocked = false;
try {
  db.createFacility({ kod: 'TEST-XX', ad: 'Geçersiz', lat: 999, lng: 29, capacity: 10 });
} catch (err) {
  checkBlocked = String(err.message).includes('CHECK');
}
assert('kısıt: geçersiz koordinat reddedildi (CHECK)', checkBlocked);

// 8. Tesis silme: FK cascade rezervasyonları da temizlemeli
const created = db.createFacility({ kod: 'TEST-01', ad: 'Test Tesisi', lat: 41.0, lng: 29.0, capacity: 50, occupancy: 10 });
db.createReservation({
  userId: user.id, facilityId: created.id,
  reserveDate: '2026-08-03', reserveTime: '10:00', guests: 2,
  cryptoSignature: 'test-sig-4'
});
db.deleteFacility(created.id);
const orphans = db.getReservationsByUserId(user.id).filter(r => r.facility_id === created.id);
assert('FK: cascade silme yetim rezervasyon bırakmadı', orphans.length === 0);

// ===========================================================================
// Migration v2 (Faz v2-01: Veri Modeli) testleri
// ===========================================================================
const conn = getDb();

// 9. Menü şablonu her tesise uygulandı mı? (30 tesis x 14 kalem = 420)
const menuCount = conn.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
assert('menü: şablon tüm tesislere uygulandı (30x14=420)', menuCount === 420);
const oneFacilityMenu = conn.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE facility_id = 1').get().n;
assert('menü: bir tesiste 14 kalem', oneFacilityMenu === 14);
assert('menü: fiyat kuruş (integer)', Number.isInteger(conn.prepare('SELECT price_minor FROM menu_items LIMIT 1').get().price_minor));

// 10. menu_items UNIQUE(facility_id, name): aynı tesiste çift ad reddedilmeli
let menuDupBlocked = false;
try {
  conn.prepare('INSERT INTO menu_items (facility_id, name, category, price_minor) VALUES (1, ?, ?, ?)')
    .run('Çay', 'Sıcak İçecek', 1500);
} catch (err) {
  menuDupBlocked = String(err.message).includes('UNIQUE');
}
assert('menü kısıt: aynı tesiste çift ad reddedildi', menuDupBlocked);

// 11. reservations yeni kolonlar + CHECK: highchair_count negatif reddedilmeli
const cols = new Set(conn.prepare('PRAGMA table_info(reservations)').all().map(c => c.name));
assert('şema: reservations yeni kolonlar eklendi', ['status','amount_minor','payment_type','highchair_count'].every(c => cols.has(c)));
let hcCheckBlocked = false;
try {
  conn.prepare(`INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature, highchair_count)
                VALUES (2, 1, '2027-01-01', '10:00', 2, 'x', -1)`).run();
} catch (err) {
  hcCheckBlocked = String(err.message).includes('CHECK');
}
assert('rez kısıt: negatif highchair_count reddedildi (CHECK)', hcCheckBlocked);

// 12. Sipariş rezervasyona bağlı; order_items snapshot fiyat; FK cascade
const resForOrder = conn.prepare(`INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
                                   VALUES (2, 1, '2027-02-02', '13:00', 2, 'sig')`).run();
const resId = Number(resForOrder.lastInsertRowid);
const orderRes = conn.prepare('INSERT INTO orders (reservation_id) VALUES (?)').run(resId);
const orderId = Number(orderRes.lastInsertRowid);
const menuItem = conn.prepare('SELECT id, price_minor FROM menu_items WHERE facility_id = 1 LIMIT 1').get();
conn.prepare('INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_minor) VALUES (?, ?, ?, ?)')
  .run(orderId, menuItem.id, 2, menuItem.price_minor);
assert('sipariş: rezervasyona bağlı sipariş + kalem oluştu',
  conn.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?').get(orderId).n === 1);

// 13. order_items quantity > 0 CHECK
let qtyBlocked = false;
try {
  conn.prepare('INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_minor) VALUES (?, ?, 0, 100)')
    .run(orderId, menuItem.id);
} catch (err) {
  qtyBlocked = String(err.message).includes('CHECK');
}
assert('sipariş kısıt: quantity=0 reddedildi (CHECK)', qtyBlocked);

// 14. Rezervasyon silinince sipariş ve kalemleri cascade ile temizlenmeli
conn.prepare('DELETE FROM reservations WHERE id = ?').run(resId);
const orphanOrders = conn.prepare('SELECT COUNT(*) AS n FROM orders WHERE reservation_id = ?').get(resId).n;
const orphanItems = conn.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?').get(orderId).n;
assert('FK: rezervasyon silinince sipariş cascade silindi', orphanOrders === 0);
assert('FK: sipariş silinince kalemler cascade silindi', orphanItems === 0);

// ===========================================================================
// Faz v2-02: Kriptografi testleri
// ===========================================================================
const { verifyPassword } = require('./database');
const { signJwt, verifyJwt } = require('./security');

// 15. Doğru parola doğrulanır, yanlış reddedilir
const u1 = db.createUser('kripto_test_1', 'S3cret-Parola!');
const rec1 = db.getUserByUsername('kripto_test_1');
assert('kripto: doğru parola doğrulandı', verifyPassword('S3cret-Parola!', rec1.password) === true);
assert('kripto: yanlış parola reddedildi', verifyPassword('yanlis', rec1.password) === false);

// 16. Aynı parola farklı kullanıcıda FARKLI hash üretir (per-user salt kanıtı)
db.createUser('kripto_test_2', 'AyniParola123');
db.createUser('kripto_test_3', 'AyniParola123');
const r2 = db.getUserByUsername('kripto_test_2').password;
const r3 = db.getUserByUsername('kripto_test_3').password;
assert('kripto: aynı parola farklı hash (salt çalışıyor)', r2 !== r3);
assert('kripto: ikisi de doğrulanabiliyor', verifyPassword('AyniParola123', r2) && verifyPassword('AyniParola123', r3));

// 17. JWT imza + exp doğrulama
const token = signJwt({ id: 1, username: 'x', role: 'admin' });
const decoded = verifyJwt(token);
assert('jwt: geçerli token çözüldü', decoded && decoded.username === 'x' && decoded.role === 'admin');
assert('jwt: exp claim eklendi', typeof decoded.exp === 'number' && decoded.exp > decoded.iat);
assert('jwt: kurcalanmış imza reddedildi', verifyJwt(token.slice(0, -3) + 'AAA') === null);

// 18. Süresi geçmiş token reddedilir (payload'u geçmiş exp ile yeniden imzalamadan test:
//     elle bozulmuş exp imzayı geçersiz kılar; süre kontrolünü ayrı bir sahte token ile doğrularız)
const parts = token.split('.');
const b64urlJson = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const expiredPayload = b64urlJson({ id: 1, username: 'x', role: 'admin', iat: 1, exp: 2 });
const crypto2 = require('crypto');
const forgedSig = crypto2.createHmac('sha256', process.env.JWT_SECRET || 'DEV-ONLY-INSECURE-SECRET-do-not-use-in-production')
  .update(`${parts[0]}.${expiredPayload}`).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
assert('jwt: süresi geçmiş token reddedildi', verifyJwt(`${parts[0]}.${expiredPayload}.${forgedSig}`) === null);

console.log(`\n${passed} başarılı, ${failed} başarısız`);
process.exit(failed === 0 ? 0 : 1);
