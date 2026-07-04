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
const { hashPassword } = require('./database');

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

// 2. Parola hash'i Python (pbkdf2_hmac sha256, 100k) ile bit-uyumlu mu?
// Python: hashlib.pbkdf2_hmac('sha256', b'adminpassword', b'mufettis_salt_value_2026', 100000).hex()
const admin = db.getUserByUsername('admin');
assert('auth: admin kullanıcısı seed edildi', !!admin);
assert('auth: hash deterministik', admin.password === hashPassword('adminpassword'));

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

console.log(`\n${passed} başarılı, ${failed} başarısız`);
process.exit(failed === 0 ? 0 : 1);
