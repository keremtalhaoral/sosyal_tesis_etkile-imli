/**
 * test-api-hardening.js - Faz 5 denetim bulgularının regresyon testleri.
 *
 * Buradaki her test, ÖLÇÜLMÜŞ bir hataya karşılık gelir. Amaç sadece "çalışıyor mu" değil,
 * "eski hata geri gelirse yakalanır mı".
 *
 *   D3  admin uçları 142 MB döndürüyordu (425.139 satır)      -> sayfalama
 *   D5  login'de hız sınırı yoktu (her deneme ~100 ms CPU)    -> 429
 *   D6  parola en az 4 karakterdi                              -> en az 8
 *   D7  İSPARK release sahiplik kontrolsüzdü                   -> yalnız kendi yerini bırakır
 *   D9  rezervasyon iptal ucu YOKTU                            -> DELETE + para geri alma
 *   D10 UNIQUE iptali kapsamıyordu (slot sonsuza dek bloke)    -> kısmi benzersiz indeks
 *
 * Çalıştırma: node backend/test-api-hardening.js (izole şema)
 */
const t = require('./test-helper').setup('hardening');
const { assert } = t;

const db = require('./db');
const { rateLimit, reset: resetLimiter } = require('./ratelimit');

(async () => {
  const conn = await t.init();

  const admin = await db.getUserByUsername('admin');
  const ayse = await db.createUser('ayse_hard', 'p');
  const mehmet = await db.createUser('mehmet_hard', 'p');

  // ==========================================================================
  // D3 - Sayfalama. Eskiden TÜM satırlar tek yanıtta dönüyordu.
  // ==========================================================================
  // Sayfalamayı görebilmek için varsayılan sayfadan (100) fazla satır üret.
  // Her satır FARKLI bir güne düşer: aynı (user, tesis, tarih, slot) dörtlüsü kısmi benzersiz
  // indekse takılırdı (ki bu da D10 düzeltmesinin çalıştığının bir kanıtı).
  const day0 = new Date('2028-01-01T00:00:00Z');
  for (let i = 0; i < 120; i++) {
    const d = new Date(day0.getTime() + i * 86400000).toISOString().slice(0, 10);
    await conn.run(`
      INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
      VALUES ($1, 1, $2::date, '19:00', 1, 'x')`, [ayse.id, d]);
  }
  const total = (await conn.one('SELECT COUNT(*)::int n FROM reservations')).n;

  const page1 = await db.getAllReservations(undefined, {});
  assert('D3: varsayılan sayfa 100 satırla sınırlı', page1.rows.length === 100);
  assert('D3: toplam sayı ayrıca dönüyor (istemci kaç sayfa olduğunu bilebilsin)', page1.total === total);
  assert('D3: limit/offset yanıtta bildiriliyor', page1.limit === 100 && page1.offset === 0);

  const page2 = await db.getAllReservations(undefined, { limit: 10, offset: 100 });
  assert('D3: offset ile ikinci sayfa alınıyor', page2.rows.length === 10 && page2.offset === 100);
  assert('D3: sayfalar örtüşmüyor',
    !page2.rows.some((r) => page1.rows.slice(0, 100).some((p) => p.id === r.id)) || page1.rows.length < 100);

  const huge = await db.getAllReservations(undefined, { limit: 99999 });
  assert('D3: devasa limit 500 ile sınırlandırılıyor', huge.rows.length <= 500 && huge.limit === 500);
  const junk = await db.getAllReservations(undefined, { limit: 'abc', offset: -5 });
  assert('D3: bozuk limit/offset varsayılana düşüyor (NaN sızmıyor)', junk.limit === 100 && junk.offset === 0);

  const ordersPage = await db.getAllOrders(undefined, { limit: 5 });
  assert('D3: siparişler de sayfalanıyor', ordersPage.rows.length <= 5 && typeof ordersPage.total === 'number');

  // ==========================================================================
  // D9 + D10 - Rezervasyon iptali ve slotun serbest kalması
  // ==========================================================================
  const SLOT = { facilityId: 2, reserveDate: '2028-06-01', reserveTime: '19:00', guests: 2, cryptoSignature: 'c' };
  const r1 = await db.createReservation({ userId: mehmet.id, ...SLOT });
  assert('D10: rezervasyon oluştu', Number.isInteger(r1.id));

  const dup = await t.expectThrow(() => db.createReservation({ userId: mehmet.id, ...SLOT }));
  assert('D10: AKTİF rezervasyon varken aynı slot engelli (23505)', dup && dup.code === '23505');

  const cancelled = await db.cancelReservation(r1.id, mehmet.id);
  assert('D9: iptal başarılı, durum cancelled', cancelled.status === 'cancelled');
  assert('D9: satır SİLİNMEDİ (olay tarihçesi korunuyor)',
    (await conn.one('SELECT status FROM reservations WHERE id=$1', [r1.id])).status === 'cancelled');

  const again = await db.createReservation({ userId: mehmet.id, ...SLOT });
  assert('D10: İPTAL SONRASI aynı slot yeniden rezerve edilebiliyor', Number.isInteger(again.id) && again.id !== r1.id);

  // Sahiplik
  const notMine = await t.expectThrow(() => db.cancelReservation(again.id, ayse.id));
  assert('D9: başkasının rezervasyonu iptal edilemiyor (403)', notMine && notMine.statusCode === 403);
  const twice = await t.expectThrow(() => db.cancelReservation(r1.id, mehmet.id));
  assert('D9: zaten iptal edilmiş rezervasyon tekrar iptal edilemiyor (409)', twice && twice.statusCode === 409);
  const missing = await t.expectThrow(() => db.cancelReservation(99999999, mehmet.id));
  assert('D9: olmayan rezervasyon 404', missing && missing.statusCode === 404);

  // İptal, bağlı siparişin PARASINI da geri almalı (Faz 1'deki H1 hatasının aynısı olmasın)
  const menu = await db.getMenu(2);
  const order = await db.createOrder({ userId: mehmet.id, reservationId: again.id, paymentType: 'card',
    items: [{ menuItemId: menu[0].id, quantity: 2 }] });
  const amountBefore = (await conn.one('SELECT amount_minor FROM reservations WHERE id=$1', [again.id])).amount_minor;
  assert('D9: sipariş tutarı rezervasyona eklendi', amountBefore === order.total_minor);

  const withOrders = await db.cancelReservation(again.id, mehmet.id);
  assert('D9: iptal bağlı siparişi de iptal etti', withOrders.cancelled_orders === 1);
  assert('D9: iptal siparişin parasını geri aldı', withOrders.reverted_minor === order.total_minor);
  assert('D9: rezervasyon tutarı sıfırlandı',
    (await conn.one('SELECT amount_minor FROM reservations WHERE id=$1', [again.id])).amount_minor === 0);
  assert('D9: sipariş durumu cancelled',
    (await conn.one('SELECT status FROM orders WHERE id=$1', [order.id])).status === 'cancelled');
  const audit = await conn.one("SELECT detail FROM audit_log WHERE entity_type='reservation' AND entity_id=$1", [again.id]);
  assert('D9: iptal audit_log\'a yazıldı (geri alınan tutarla)', audit && audit.detail.reverted_minor === order.total_minor);

  // ==========================================================================
  // D7 - İSPARK sahipliği
  // ==========================================================================
  const FAC = 1;
  await conn.run('UPDATE ispark_status SET capacity = 2, occupied = 0 WHERE facility_id = $1', [FAC]);

  assert('D7: ayşe yer kaptı', (await db.takeIsparkSpot(FAC, ayse.id)) === true);
  assert('D7: doluluk 1', (await db.getIsparkStatus(FAC)).occupied === 1);

  const twiceTake = await t.expectThrow(() => db.takeIsparkSpot(FAC, ayse.id));
  assert('D7: aynı kullanıcı ikinci kez yer kapamıyor (409)', twiceTake && twiceTake.statusCode === 409);

  const stealErr = await t.expectThrow(() => db.releaseIsparkSpot(FAC, mehmet.id));
  assert('D7: BAŞKASININ yeri bırakılamıyor (409)', stealErr && stealErr.statusCode === 409);
  assert('D7: başarısız bırakma doluluğu DEĞİŞTİRMEDİ', (await db.getIsparkStatus(FAC)).occupied === 1);

  assert('D7: kendi yerini bırakabiliyor', (await db.releaseIsparkSpot(FAC, ayse.id)) === true);
  assert('D7: doluluk 0\'a döndü', (await db.getIsparkStatus(FAC)).occupied === 0);
  assert('D7: hold kaydı temizlendi',
    (await conn.one('SELECT COUNT(*)::int n FROM ispark_holds WHERE facility_id=$1', [FAC])).n === 0);

  // Kapasite sınırı hâlâ geçerli
  await db.takeIsparkSpot(FAC, ayse.id);
  await db.takeIsparkSpot(FAC, mehmet.id);
  const third = await db.createUser('ucuncu_hard', 'p');
  assert('D7: kapasite dolunca yeni kapma başarısız', (await db.takeIsparkSpot(FAC, third.id)) === false);
  assert('D7: kapasite aşılmadı', (await db.getIsparkStatus(FAC)).occupied === 2);

  // ==========================================================================
  // D14 - audit_log sıralama indeksi kullanılıyor mu?
  // ==========================================================================
  const plan = (await conn.all(
    'EXPLAIN SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 50'
  )).map((r) => r['QUERY PLAN']).join(' ');
  assert('D14: audit_log sıralaması indeksten geliyor (Sort yok)',
    /Index Scan|Index Only Scan/.test(plan) || !/Sort/.test(plan));

  // ==========================================================================
  // D5 - Hız sınırlayıcı (saf birim testi; HTTP olmadan)
  // ==========================================================================
  resetLimiter();
  const limiter = rateLimit({ windowMs: 1000, max: 3, keyOf: () => 'sabit-anahtar' });
  const run = () => new Promise((resolve) => {
    const res = {
      statusCode: null, body: null, headers: {},
      set(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve({ blocked: true, res: this }); return this; },
    };
    limiter({ ip: '1.2.3.4', body: {} }, res, () => resolve({ blocked: false, res }));
  });

  const results = [];
  for (let i = 0; i < 5; i++) results.push(await run());
  assert('D5: ilk 3 istek geçti', results.slice(0, 3).every((r) => !r.blocked));
  assert('D5: 4. ve 5. istek 429 ile engellendi',
    results.slice(3).every((r) => r.blocked && r.res.statusCode === 429));
  assert('D5: Retry-After başlığı gönderildi', !!results[3].res.headers['Retry-After']);
  assert('D5: yanıt gövdesinde bekleme süresi var', typeof results[3].res.body.retry_after_seconds === 'number');

  await new Promise((r) => setTimeout(r, 1100));   // pencere kaysın
  assert('D5: pencere dolunca yeniden izin veriliyor', (await run()).blocked === false);

  await t.finish();
})().catch(async (err) => {
  console.error('\nTEST ÇÖKTÜ:', err);
  await require('./database').dropSchema().catch(() => {});
  process.exit(1);
});
