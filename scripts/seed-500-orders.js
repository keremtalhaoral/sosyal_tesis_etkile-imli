#!/usr/bin/env node
/**
 * seed-500-orders.js
 *
 * Gerçekçi test ve analitik gösterim için ~500 adet sipariş ve rezervasyon üretir.
 * 30 sosyal tesise, farklı gün ve saat slotlarına, farklı menü kategorilerine ve
 * ödeme tiplerine dağıtır.
 *
 * Çalıştırma:
 *   PGPORT=5433 node scripts/seed-500-orders.js
 */

const { db, init, close, transaction, SLOTS, hashPassword } = require('../backend/database');
const analytics = require('../backend/analytics');
const events = require('../backend/events');

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

(async () => {
  await init();
  const conn = db();

  console.log('[seed] ~500 gerçekçi sipariş ve rezervasyon üretimi başlatılıyor...');

  // 1. Tesisleri ve menülerini al
  const facilities = await conn.all('SELECT id, ad, capacity FROM facilities ORDER BY id');
  const allMenuItems = await conn.all('SELECT id, facility_id, name, category, price_minor FROM menu_items WHERE is_available = true');
  
  const menuByFacility = {};
  for (const item of allMenuItems) {
    if (!menuByFacility[item.facility_id]) menuByFacility[item.facility_id] = [];
    menuByFacility[item.facility_id].push(item);
  }

  // 2. Sentetik kullanıcılar (eğer yoksa 50 adet müşteri)
  const USER_COUNT = 50;
  const userRows = [];
  const defaultHash = hashPassword('Parola2026!');
  for (let i = 1; i <= USER_COUNT; i++) {
    const uname = `ziyaretci_${String(i).padStart(3, '0')}`;
    userRows.push([uname, defaultHash, 'user']);
  }

  for (const [u, p, r] of userRows) {
    await conn.run(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
      [u, p, r]
    );
  }
  const users = await conn.all("SELECT id FROM users WHERE username LIKE 'ziyaretci_%' ORDER BY id");
  const userIds = users.map(u => u.id);

  // 3. 500 adet sipariş planla (son 45 gün içine yayılmış)
  const TARGET_ORDERS = 500;
  const now = new Date();
  const payments = ['card', 'card', 'card', 'cash', 'online']; // %60 card, %20 cash, %20 online

  let createdReservations = 0;
  let createdOrders = 0;
  let createdItems = 0;
  let totalRevenueMinor = 0;

  // Çakışmaları önlemek için slot takip haritası: `uid|fid|date|slot`
  const usedSlots = new Set();

  await transaction(async (tx) => {
    let orderIndex = 0;
    let attempts = 0;

    while (createdOrders < TARGET_ORDERS && attempts < 2000) {
      attempts++;
      const facility = pick(facilities);
      const menu = menuByFacility[facility.id] || [];
      if (!menu.length) continue;

      // Son 45 gün içinde rastgele bir tarih
      const dayOffset = randInt(0, 45);
      const resDate = new Date(now.getTime() - dayOffset * 86400000);
      const dateStr = resDate.toISOString().slice(0, 10);
      const slot = pick(SLOTS);
      const userId = pick(userIds);

      const slotKey = `${userId}|${facility.id}|${dateStr}|${slot}`;
      if (usedSlots.has(slotKey)) continue;
      usedSlots.add(slotKey);

      // İptal oranı ~%6
      const isCancelled = Math.random() < 0.06;
      const guests = randInt(1, 5);
      const highchair = Math.random() < 0.20 ? randInt(1, Math.min(2, guests)) : 0;
      const paymentType = pick(payments);

      // Menüden 1 ila 4 farklı ürün seç
      const itemCount = randInt(1, 4);
      const selectedItems = [];
      let orderTotalMinor = 0;

      for (let j = 0; j < itemCount; j++) {
        const item = pick(menu);
        const qty = randInt(1, 3);
        selectedItems.push({
          menu_item_id: item.id,
          quantity: qty,
          unit_price_minor: item.price_minor
        });
        orderTotalMinor += qty * item.price_minor;
      }

      // Rezervasyonu oluştur
      const resStatus = isCancelled ? 'cancelled' : 'confirmed';
      const resRes = await tx.one(`
        INSERT INTO reservations 
          (user_id, facility_id, reserve_date, reserve_time, guests, highchair_count, status, amount_minor, payment_type, crypto_signature)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id, facility_id, reserve_date, reserve_time) WHERE status <> 'cancelled' DO NOTHING
        RETURNING id
      `, [
        userId, facility.id, dateStr, slot, guests, highchair, resStatus,
        isCancelled ? 0 : orderTotalMinor, paymentType, 'seed_sample_sig'
      ]);

      if (!resRes) continue;
      createdReservations++;

      // Siparişi oluştur
      const orderStatus = isCancelled ? 'cancelled' : 'paid';
      const orderRes = await tx.one(`
        INSERT INTO orders (reservation_id, status, total_minor, payment_type, crypto_signature, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        resRes.id, orderStatus, orderTotalMinor, paymentType, 'seed_sample_order_sig', resDate.toISOString()
      ]);

      createdOrders++;
      if (!isCancelled) {
        totalRevenueMinor += orderTotalMinor;
      }

      // Kalemleri ekle
      for (const it of selectedItems) {
        await tx.run(`
          INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_minor)
          VALUES ($1, $2, $3, $4)
        `, [orderRes.id, it.menu_item_id, it.quantity, it.unit_price_minor]);
        createdItems++;
      }
    }
  }, { isolation: 'READ COMMITTED' });

  console.log(`[seed] Başarıyla oluşturuldu:`);
  console.log(`  - Rezervasyon: ${createdReservations}`);
  console.log(`  - Sipariş: ${createdOrders}`);
  console.log(`  - Sipariş Kalemi: ${createdItems}`);
  console.log(`  - Toplam Ciro: ${(totalRevenueMinor / 100).toLocaleString('tr-TR')} ₺`);

  // 4. Rollup tablosunu güncelle (daily_stats)
  console.log('[seed] daily_stats rollup tablosu yeniden oluşturuluyor...');
  const statsRows = await analytics.rebuildDailyStats();
  console.log(`[seed] daily_stats güncellendi: ${statsRows} günlük özet satırı.`);

  // 5. SSE canlı abonelerine sinyal ver
  events.publish('change');
  console.log('[seed] SSE canlı bildirim tetiklendi.');

  await close();
  console.log('[seed] İşlem tamamlandı!');
})().catch(async (err) => {
  console.error('[seed] HATA:', err);
  await close().catch(() => {});
  process.exit(1);
});
