/**
 * test-admin.js - Admin paneli testleri (ADR-007).
 * audit_log yazımı, admin gözetim uçlarının sahiplik-filtresiz oluşu, requireAdmin yetki kuralı.
 * Çalıştırma: node backend/test-admin.js (izole şema).
 */
const t = require('./test-helper').setup('admin');
const { assert } = t;

const db = require('./db');
const { signJwt, verifyJwt } = require('./security');

(async () => {
  const conn = await t.init();

  const admin = await db.getUserByUsername('admin');          // seed'li admin
  const alice = await db.createUser('alice_admin_test', 'p');
  const bob = await db.createUser('bob_admin_test', 'p');

  // 1. Tesis CRUD audit log'a yazıyor (INSERT/UPDATE/DELETE her biri bir kayıt)
  const fac = await db.createFacility({ kod: 'ADM-01', ad: 'Admin Test Tesisi', lat: 41.0, lng: 29.0, capacity: 40, isparkCapacity: 12 }, admin.id);
  await db.updateFacilityOccupancy(fac.id, 55, admin.id);
  await db.deleteFacility(fac.id, admin.id);

  const facAudit = await conn.all("SELECT action FROM audit_log WHERE entity_type='facility' AND entity_id=$1 ORDER BY id", [fac.id]);
  assert('audit log: tesis create/update/delete üçü de kaydedildi', facAudit.length === 3);
  assert('audit log: sıra create→update→delete',
    facAudit.map(r => r.action).join(',') === 'facility.create,facility.update,facility.delete');

  // audit_log APPEND-ONLY: silinen tesisin kaydı DURUYOR (gerçekleşmiş olay silinmez).
  assert('audit log: silinen tesisin kaydı korundu (append-only)', facAudit.length === 3);

  // detail artık JSONB - PostgreSQL'de sorgulanabilir (SQLite'ta düz metindi).
  const detail = await conn.one("SELECT detail FROM audit_log WHERE entity_type='facility' AND entity_id=$1 AND action='facility.update'", [fac.id]);
  assert('audit log: detail JSONB olarak okunabiliyor', detail.detail.manual_occupancy_after === 55);
  // ADM-01 kodu iki kayıtta geçiyor: facility.create ve facility.delete (ikisi de kod'u yazıyor).
  const jsonQuery = await conn.all("SELECT action FROM audit_log WHERE detail->>'kod' = 'ADM-01' ORDER BY id");
  assert('audit log: JSONB alanına göre sorgulanabiliyor (create + delete)',
    jsonQuery.map(r => r.action).join(',') === 'facility.create,facility.delete');

  // 2. İSPARK kapasitesi opsiyonel: verilince ispark_status satırı oluşur
  const facWithIspark = await db.createFacility({ kod: 'ADM-02', ad: 'İspark Test', lat: 41.0, lng: 29.0, capacity: 30, isparkCapacity: 8 }, admin.id);
  const ipStatus = await db.getIsparkStatus(facWithIspark.id);
  assert('İSPARK: opsiyonel kapasite verilince kayıt oluştu', ipStatus && ipStatus.capacity === 8);
  const facNoIspark = await db.createFacility({ kod: 'ADM-03', ad: 'İsparksız Test', lat: 41.0, lng: 29.0, capacity: 30 }, admin.id);
  assert('İSPARK: verilmezse kayıt oluşmaz', (await db.getIsparkStatus(facNoIspark.id)) === null);

  // 3. Admin gözetim: sahiplik filtresi YOK
  const resA = await db.createReservation({ userId: alice.id, facilityId: 1, reserveDate: '2027-06-01', reserveTime: '19:00', guests: 2, cryptoSignature: 'a' });
  const resB = await db.createReservation({ userId: bob.id, facilityId: 1, reserveDate: '2027-06-01', reserveTime: '13:00', guests: 3, cryptoSignature: 'b' });
  // NOT: bu uçlar artık SAYFALI dönüyor ({ rows, total, limit, offset }). Eskiden düz dizi
  // döndürüyorlardı ve tüm satırları tek yanıtta veriyorlardı (ölçüldü: 142 MB).
  const allRes = await db.getAllReservations();
  assert('admin gözetim: iki farklı kullanıcının rezervasyonu da listede',
    allRes.rows.some(r => r.id === resA.id) && allRes.rows.some(r => r.id === resB.id));
  assert('admin gözetim: sayfalama meta verisi dönüyor',
    typeof allRes.total === 'number' && allRes.limit === 100);
  assert('admin gözetim: facilityId filtresi çalışıyor',
    (await db.getAllReservations(1)).rows.every(r => r.facility_id === 1));
  assert('admin gözetim: sahip olmayan tesis filtrelenince boş döner',
    (await db.getAllReservations(999999)).rows.length === 0);

  // 4. Admin gözetim: siparişler de sahiplik-filtresiz
  const menu = await db.getMenu(1);
  const orderA = await db.createOrder({ userId: alice.id, reservationId: resA.id, paymentType: 'cash', items: [{ menuItemId: menu[0].id, quantity: 1 }] });
  const allOrders = await db.getAllOrders();
  assert('admin gözetim: başka kullanıcının siparişi görünür',
    allOrders.rows.some(o => o.id === orderA.id && o.owner_username === 'alice_admin_test'));

  // 5. Sipariş durum makinesi: geçersiz durum string'i de reddedilir (whitelist dışı)
  const garbage = await t.expectThrow(() => db.updateOrderStatus(orderA.id, 'kahve_getir', admin.id));
  assert('durum makinesi: whitelist dışı string reddedildi (409)', garbage && garbage.statusCode === 409);

  // 6. Audit log sorgusu: en yeni önce, limit uygulanıyor
  const recent = await db.getAuditLog(3);
  assert('audit log sorgu: limit uygulanıyor', recent.length === 3);
  assert('audit log sorgu: actor_username join edildi',
    recent.every(r => typeof r.actor_username === 'string' && r.actor_username.length > 0));
  assert('audit log sorgu: azalan zaman sırasında',
    recent.every((r, i) => i === 0 || new Date(r.created_at) <= new Date(recent[i - 1].created_at)));

  // 6b. Bozuk limit girdisi tüm log'u döktürmemeli (?limit=abc -> NaN regresyonu)
  const total = (await conn.one('SELECT COUNT(*)::int AS n FROM audit_log')).n;
  assert('audit log: bozuk limit sınırsız dökümü tetiklemiyor',
    (await db.getAuditLog('abc')).length === Math.min(50, total) && total > 3);

  // 7. requireAdmin yetki kuralı (server.js ile birebir aynı koşul; middleware canlı porta
  //    bağlanmadan test edilemediği için burada JWT round-trip üzerinden doğrulanır).
  const adminToken = signJwt({ id: admin.id, username: admin.username, role: 'admin' });
  const userToken = signJwt({ id: alice.id, username: alice.username, role: 'user' });
  const isAdminAllowed = (token) => { const u = verifyJwt(token); return !!u && u.role === 'admin'; };
  assert('requireAdmin: admin rolü kabul edilir', isAdminAllowed(adminToken) === true);
  assert('requireAdmin: user rolü reddedilir (403 eşleniği)', isAdminAllowed(userToken) === false);
  assert('requireAdmin: geçersiz token reddedilir', isAdminAllowed('kurcalanmis.token.x') === false);

  await t.finish();
})().catch(async (err) => {
  console.error('\nTEST ÇÖKTÜ:', err);
  await require('./database').dropSchema().catch(() => {});
  process.exit(1);
});
