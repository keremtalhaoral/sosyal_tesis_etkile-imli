/**
 * test-orders.js - Sipariş akışı testleri (Faz v2-05).
 * Fiyat snapshot, sahiplik, kısıtlar, cascade, tutar hesabı. Çalıştırma: node backend/test-orders.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orders-')), 'test.db');

const db = require('./db');
const { getDb } = require('./database');
const { validateOrderInput } = require('./validate');

let passed = 0, failed = 0;
const assert = (name, cond) => { if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.error(`  FAIL  ${name}`); } };

const conn = getDb();
const user = db.getUserByUsername('user');           // id 2
const other = db.createUser('baskasi', 'p');         // farklı kullanıcı
// user için tesis 1'de rezervasyon
const resv = db.createReservation({ userId: user.id, facilityId: 1, reserveDate: '2027-05-01', reserveTime: '19:00', guests: 4, cryptoSignature: 'r' });
const menu = db.getMenu(1);
assert('menü: tesis 1 kalemleri döndü', menu.length >= 2);
const [m1, m2] = menu;

// 1. Sipariş oluştur: 2 kalem, snapshot fiyatlardan doğru toplam
const expectTotal = m1.price_minor * 2 + m2.price_minor * 1;
const order = db.createOrder({ userId: user.id, reservationId: resv.id, paymentType: 'card',
  items: [{ menuItemId: m1.id, quantity: 2 }, { menuItemId: m2.id, quantity: 1 }], cryptoSignature: 's' });
assert('sipariş: toplam snapshot fiyatlardan doğru', order.total_minor === expectTotal);
assert('sipariş: durum paid, 2 kalem', order.status === 'paid' && order.item_count === 2);
assert('sipariş: rezervasyon tutarına eklendi', db.getFacilityById(1) && conn.prepare('SELECT amount_minor FROM reservations WHERE id=?').get(resv.id).amount_minor === expectTotal);

// 2. FİYAT SNAPSHOT: menü fiyatı değişse bile eski siparişin tutarı değişmez
conn.prepare('UPDATE menu_items SET price_minor = price_minor + 5000 WHERE id = ?').run(m1.id);
const savedItem = conn.prepare('SELECT unit_price_minor FROM order_items WHERE order_id = ? AND menu_item_id = ?').get(order.id, m1.id);
assert('snapshot: sipariş kalemi eski fiyatı korudu', savedItem.unit_price_minor === m1.price_minor);
const orderRow = conn.prepare('SELECT total_minor FROM orders WHERE id = ?').get(order.id);
assert('snapshot: sipariş toplamı değişmedi', orderRow.total_minor === expectTotal);

// 3. Sahiplik: başka kullanıcı bu rezervasyona sipariş veremez (403)
let ownBlocked = false;
try { db.createOrder({ userId: other.id, reservationId: resv.id, paymentType: 'cash', items: [{ menuItemId: m1.id, quantity: 1 }], cryptoSignature: 's' }); }
catch (e) { ownBlocked = e.statusCode === 403; }
assert('sahiplik: başkasının rezervasyonuna sipariş reddedildi (403)', ownBlocked);

// 4. Başka tesisin menü kalemi reddedilir (409)
const otherFacMenu = db.getMenu(2);
let wrongFacBlocked = false;
try { db.createOrder({ userId: user.id, reservationId: resv.id, paymentType: 'cash', items: [{ menuItemId: otherFacMenu[0].id, quantity: 1 }], cryptoSignature: 's' }); }
catch (e) { wrongFacBlocked = e.statusCode === 409; }
assert('kısıt: başka tesisin menü kalemi reddedildi (409)', wrongFacBlocked);

// 5. Doğrulama: boş sepet + geçersiz adet
assert('validate: boş sepet reddi', validateOrderInput({ reservationId: 1, items: [], paymentType: 'cash' }).ok === false);
assert('validate: quantity<=0 reddi', validateOrderInput({ reservationId: 1, items: [{ menuItemId: 1, quantity: 0 }], paymentType: 'cash' }).ok === false);
assert('validate: geçersiz paymentType reddi', validateOrderInput({ reservationId: 1, items: [{ menuItemId: 1, quantity: 1 }], paymentType: 'bitcoin' }).ok === false);
assert('validate: geçerli girdi kabul', validateOrderInput({ reservationId: 1, items: [{ menuItemId: 1, quantity: 2 }], paymentType: 'online' }).ok === true);

// 6. Siparişler sahiplik kontrollü sorgulanır
assert('sorgu: sahibi siparişleri görür', db.getOrdersByReservation(resv.id, user.id).length === 1);
assert('sorgu: başkası göremez (null)', db.getOrdersByReservation(resv.id, other.id) === null);

// 7. Cascade: rezervasyon silinince sipariş + kalemler gider
conn.prepare('DELETE FROM reservations WHERE id = ?').run(resv.id);
assert('cascade: sipariş silindi', conn.prepare('SELECT COUNT(*) n FROM orders WHERE id=?').get(order.id).n === 0);
assert('cascade: kalemler silindi', conn.prepare('SELECT COUNT(*) n FROM order_items WHERE order_id=?').get(order.id).n === 0);

console.log(`\n${passed} başarılı, ${failed} başarısız`);
process.exit(failed === 0 ? 0 : 1);
