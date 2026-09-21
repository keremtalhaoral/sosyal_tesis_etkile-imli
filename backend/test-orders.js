/**
 * test-orders.js - Sipariş akışı testleri (ADR-005 + ADR-007).
 * Fiyat snapshot, imza bütünlüğü, sahiplik, kısıtlar, durum makinesi, iptalde para geri alma.
 * Çalıştırma: node backend/test-orders.js (izole şema)
 */
const t = require('./test-helper').setup('orders');
const { assert } = t;

const db = require('./db');
const { validateOrderInput } = require('./validate');
const { signOrder } = require('./security');
const analytics = require('./analytics');

(async () => {
  const conn = await t.init();

  const user = await db.getUserByUsername('user');
  const other = await db.createUser('baskasi', 'p');
  const resv = await db.createReservation({
    userId: user.id, facilityId: 1, reserveDate: '2027-05-01', reserveTime: '19:00', guests: 4, cryptoSignature: 'r'
  });
  const menu = await db.getMenu(1);
  assert('menü: tesis 1 kalemleri döndü', menu.length >= 2);
  const [m1, m2] = menu;

  // 1. Sipariş oluştur: 2 kalem, snapshot fiyatlardan doğru toplam
  const expectTotal = m1.price_minor * 2 + m2.price_minor * 1;
  const orderItems = [{ menuItemId: m1.id, quantity: 2 }, { menuItemId: m2.id, quantity: 1 }];
  const order = await db.createOrder({ userId: user.id, reservationId: resv.id, paymentType: 'card', items: orderItems });
  assert('sipariş: toplam snapshot fiyatlardan doğru', order.total_minor === expectTotal);
  assert('sipariş: durum submitted (personel akışı bekler), 2 kalem', order.status === 'submitted' && order.item_count === 2);
  assert('sipariş: rezervasyon tutarına eklendi',
    (await conn.one('SELECT amount_minor FROM reservations WHERE id=$1', [resv.id])).amount_minor === expectTotal);

  // 1b. İMZA GERÇEK TUTARI KAPSIYOR (eskiden server.js imzayı tutar=0 ile önceden üretiyordu,
  // bu yüzden imza tutar değişse bile aynı kalıyordu - bütünlük kontrolü işlevsizdi).
  const storedSig = (await conn.one('SELECT crypto_signature FROM orders WHERE id = $1', [order.id])).crypto_signature;
  assert('imza: kaydedilen imza gerçek toplamı kapsıyor', storedSig === signOrder(user.id, resv.id, expectTotal, orderItems));
  assert('imza: tutar kurcalanırsa imza tutmuyor', storedSig !== signOrder(user.id, resv.id, expectTotal + 1, orderItems));
  assert('imza: tutar=0 ile üretilen eski imza artık eşleşmiyor', storedSig !== signOrder(user.id, resv.id, 0, orderItems));

  // 2. FİYAT SNAPSHOT: menü fiyatı değişse bile eski siparişin tutarı değişmez
  await conn.run('UPDATE menu_items SET price_minor = price_minor + 5000 WHERE id = $1', [m1.id]);
  const savedItem = await conn.one('SELECT unit_price_minor FROM order_items WHERE order_id = $1 AND menu_item_id = $2', [order.id, m1.id]);
  assert('snapshot: sipariş kalemi eski fiyatı korudu', savedItem.unit_price_minor === m1.price_minor);
  assert('snapshot: sipariş toplamı değişmedi',
    (await conn.one('SELECT total_minor FROM orders WHERE id = $1', [order.id])).total_minor === expectTotal);

  // 3. Sahiplik: başka kullanıcı bu rezervasyona sipariş veremez (403)
  const ownErr = await t.expectThrow(() => db.createOrder({
    userId: other.id, reservationId: resv.id, paymentType: 'cash', items: [{ menuItemId: m1.id, quantity: 1 }]
  }));
  assert('sahiplik: başkasının rezervasyonuna sipariş reddedildi (403)', ownErr && ownErr.statusCode === 403);

  // 4. Başka tesisin menü kalemi reddedilir (409)
  const otherFacMenu = await db.getMenu(2);
  const wrongFacErr = await t.expectThrow(() => db.createOrder({
    userId: user.id, reservationId: resv.id, paymentType: 'cash', items: [{ menuItemId: otherFacMenu[0].id, quantity: 1 }]
  }));
  assert('kısıt: başka tesisin menü kalemi reddedildi (409)', wrongFacErr && wrongFacErr.statusCode === 409);

  // 5. Doğrulama katmanı
  assert('validate: boş sepet reddi', validateOrderInput({ reservationId: 1, items: [], paymentType: 'cash' }).ok === false);
  assert('validate: quantity<=0 reddi', validateOrderInput({ reservationId: 1, items: [{ menuItemId: 1, quantity: 0 }], paymentType: 'cash' }).ok === false);
  assert('validate: geçersiz paymentType reddi', validateOrderInput({ reservationId: 1, items: [{ menuItemId: 1, quantity: 1 }], paymentType: 'bitcoin' }).ok === false);
  assert('validate: geçerli girdi kabul', validateOrderInput({ reservationId: 1, items: [{ menuItemId: 1, quantity: 2 }], paymentType: 'online' }).ok === true);

  // 6. Siparişler sahiplik kontrollü sorgulanır
  assert('sorgu: sahibi siparişleri görür', (await db.getOrdersByReservation(resv.id, user.id)).length === 1);
  assert('sorgu: başkası göremez (null)', (await db.getOrdersByReservation(resv.id, other.id)) === null);

  // 6b. Sipariş durum makinesi: submitted→served→paid izinli; submitted→paid sıçraması yasak.
  const staff = await db.createUser('personel1', 'p', 'admin');
  const jumpErr = await t.expectThrow(() => db.updateOrderStatus(order.id, 'paid', staff.id));
  assert('durum makinesi: submitted→paid sıçraması reddedildi (409)', jumpErr && jumpErr.statusCode === 409);

  assert('durum makinesi: submitted→served kabul edildi', (await db.updateOrderStatus(order.id, 'served', staff.id)).status === 'served');
  assert('durum makinesi: served→paid kabul edildi', (await db.updateOrderStatus(order.id, 'paid', staff.id)).status === 'paid');

  const auditRows = await conn.all("SELECT action, detail FROM audit_log WHERE entity_type='order' AND entity_id=$1 ORDER BY id", [order.id]);
  assert('audit log: iki geçiş de kaydedildi', auditRows.length === 2);
  assert('audit log: action=order.status_change', auditRows.every(r => r.action === 'order.status_change'));

  // 6c. İPTAL PARAYI GERİ ALIR. createOrder tutarı reservations.amount_minor'a EKLİYOR;
  // iptal bunu geri almazsa iptal edilmiş sipariş sonsuza dek ciro sayılır (tüm raporlama
  // amount_minor okur). Regresyon koruması: bu test eskiden YOKTU.
  const amountOf = async () => (await conn.one('SELECT amount_minor FROM reservations WHERE id = $1', [resv.id])).amount_minor;
  const amountBeforeCancel = await amountOf();
  const order2 = await db.createOrder({ userId: user.id, reservationId: resv.id, paymentType: 'cash', items: [{ menuItemId: m2.id, quantity: 3 }] });
  assert('iptal öncesi: yeni siparişin tutarı rezervasyona eklendi', (await amountOf()) === amountBeforeCancel + order2.total_minor);

  await db.updateOrderStatus(order2.id, 'cancelled', staff.id);
  assert('İPTAL: rezervasyon tutarı geri alındı (ciro şişmiyor)', (await amountOf()) === amountBeforeCancel);
  assert('iptal: sipariş durumu cancelled',
    (await conn.one('SELECT status FROM orders WHERE id=$1', [order2.id])).status === 'cancelled');
  const cancelAudit = await conn.one("SELECT detail FROM audit_log WHERE entity_type='order' AND entity_id=$1 ORDER BY id DESC LIMIT 1", [order2.id]);
  assert('iptal: audit kaydı geri alınan tutarı içeriyor', cancelAudit.detail.reverted_minor === order2.total_minor);

  // İptal edilen siparişin kalemleri kategori cirosuna girmemeli (aynı hata ailesi).
  const catRevenue = (await analytics.categorySales()).reduce((s, c) => s + (c.revenue_minor || 0), 0);
  assert('analytics: kategori cirosu iptal edilen siparişi saymıyor',
    catRevenue === (await analytics.kpiSummary()).revenue_minor);

  // 7. Cascade: rezervasyon silinince sipariş + kalemler gider
  await conn.run('DELETE FROM reservations WHERE id = $1', [resv.id]);
  assert('cascade: sipariş silindi', (await conn.one('SELECT COUNT(*)::int n FROM orders WHERE id=$1', [order.id])).n === 0);
  assert('cascade: kalemler silindi', (await conn.one('SELECT COUNT(*)::int n FROM order_items WHERE order_id=$1', [order.id])).n === 0);

  await t.finish();
})().catch(async (err) => {
  console.error('\nTEST ÇÖKTÜ:', err);
  await require('./database').dropSchema().catch(() => {});
  process.exit(1);
});
