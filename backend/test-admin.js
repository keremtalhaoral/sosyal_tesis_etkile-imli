/**
 * test-admin.js - Admin paneli testleri (Faz v2-07, ADR-007).
 * audit_log yazımı, admin gözetim uçlarının sahiplik-filtresiz oluşu, requireAdmin yetki kuralı.
 * Çalıştırma: node backend/test-admin.js (geçici DB).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'admin-')), 'test.db');

const db = require('./db');
const { getDb } = require('./database');
const { signJwt, verifyJwt } = require('./security');

let passed = 0, failed = 0;
const assert = (name, cond) => { if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.error(`  FAIL  ${name}`); } };

const conn = getDb();
const admin = db.getUserByUsername('admin');           // seed'li admin
const alice = db.createUser('alice_admin_test', 'p');
const bob = db.createUser('bob_admin_test', 'p');

// 1. Tesis CRUD audit log'a yazıyor (INSERT/UPDATE/DELETE her biri bir kayıt)
const fac = db.createFacility({ kod: 'ADM-01', ad: 'Admin Test Tesisi', lat: 41.0, lng: 29.0, capacity: 40, isparkCapacity: 12 }, admin.id);
db.updateFacilityOccupancy(fac.id, 55, admin.id);
db.deleteFacility(fac.id, admin.id);

const facAudit = conn.prepare("SELECT action FROM audit_log WHERE entity_type='facility' AND entity_id=? ORDER BY id").all(fac.id);
assert('audit log: tesis create/update/delete üçü de kaydedildi', facAudit.length === 3);
assert('audit log: sıra create→update→delete', facAudit.map(r => r.action).join(',') === 'facility.create,facility.update,facility.delete');

// 2. İSPARK kapasitesi opsiyonel: verilince ispark_status satırı oluşur
const facWithIspark = db.createFacility({ kod: 'ADM-02', ad: 'İspark Test', lat: 41.0, lng: 29.0, capacity: 30, isparkCapacity: 8 }, admin.id);
assert('İSPARK: opsiyonel kapasite verilince kayıt oluştu', db.getIsparkStatus(facWithIspark.id) && db.getIsparkStatus(facWithIspark.id).capacity === 8);
const facNoIspark = db.createFacility({ kod: 'ADM-03', ad: 'İsparksız Test', lat: 41.0, lng: 29.0, capacity: 30 }, admin.id);
assert('İSPARK: verilmezse kayıt oluşmaz', db.getIsparkStatus(facNoIspark.id) === null);

// 3. Admin gözetim: sahiplik filtresi YOK (alice + bob rezervasyonlarının ikisi de görünür)
const resA = db.createReservation({ userId: alice.id, facilityId: 1, reserveDate: '2027-06-01', reserveTime: '19:00', guests: 2, cryptoSignature: 'a' });
const resB = db.createReservation({ userId: bob.id, facilityId: 1, reserveDate: '2027-06-01', reserveTime: '13:00', guests: 3, cryptoSignature: 'b' });
const allRes = db.getAllReservations();
assert('admin gözetim: iki farklı kullanıcının rezervasyonu da listede', allRes.some(r => r.id === resA.id) && allRes.some(r => r.id === resB.id));
assert('admin gözetim: facilityId filtresi çalışıyor', db.getAllReservations(1).every(r => r.facility_id === 1));
assert('admin gözetim: sahip olmayan tesis filtrelenince boş döner', db.getAllReservations(999999).length === 0);

// 4. Admin gözetim: siparişler de sahiplik-filtresiz
const menu = db.getMenu(1);
const orderA = db.createOrder({ userId: alice.id, reservationId: resA.id, paymentType: 'cash', items: [{ menuItemId: menu[0].id, quantity: 1 }], cryptoSignature: 's' });
const allOrders = db.getAllOrders();
assert('admin gözetim: başka kullanıcının siparişi görünür', allOrders.some(o => o.id === orderA.id && o.owner_username === 'alice_admin_test'));

// 5. Sipariş durum makinesi: geçersiz durum string'i de reddedilir (whitelist dışı)
let garbageBlocked = false;
try { db.updateOrderStatus(orderA.id, 'kahve_getir', admin.id); }
catch (e) { garbageBlocked = e.statusCode === 409; }
assert('durum makinesi: whitelist dışı string reddedildi (409)', garbageBlocked);

// 6. Audit log sorgusu: en yeni önce, limit uygulanıyor
const recent = db.getAuditLog(3);
assert('audit log sorgu: limit uygulanıyor', recent.length === 3);
assert('audit log sorgu: actor_username join edildi', recent.every(r => typeof r.actor_username === 'string' && r.actor_username.length > 0));
const ordered = recent.every((r, i) => i === 0 || new Date(r.created_at) <= new Date(recent[i - 1].created_at));
assert('audit log sorgu: azalan zaman sırasında', ordered);

// 7. requireAdmin yetki kuralı (server.js:48-55 ile birebir aynı koşul; middleware server.js'de
// canlı porta bağlanmadan test edilemediği için burada JWT round-trip üzerinden doğrulanır).
const adminToken = signJwt({ id: admin.id, username: admin.username, role: 'admin' });
const userToken = signJwt({ id: alice.id, username: alice.username, role: 'user' });
const isAdminAllowed = (token) => { const u = verifyJwt(token); return !!u && u.role === 'admin'; };
assert('requireAdmin: admin rolü kabul edilir', isAdminAllowed(adminToken) === true);
assert('requireAdmin: user rolü reddedilir (403 eşleniği)', isAdminAllowed(userToken) === false);
assert('requireAdmin: geçersiz token reddedilir', isAdminAllowed('kurcalanmis.token.x') === false);

console.log(`\n${passed} başarılı, ${failed} başarısız`);
process.exit(failed === 0 ? 0 : 1);
