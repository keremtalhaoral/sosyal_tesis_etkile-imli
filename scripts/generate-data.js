#!/usr/bin/env node
/**
 * generate-data.js - Gerçekçi + ölçeklenebilir dummy veri üreteci (Faz v2-03, ADR-003).
 *
 * Amaç (mentör isteği): veri tabanını her koşulda yönetebilmek + BÜYÜK veriyi yükleyip
 * sorgulayabilmek. Üretilen kayıtlar GEÇERLİDİR: per-slot kapasite ASLA aşılmaz.
 *
 * Kullanım:
 *   node scripts/generate-data.js              # gerçekçi taban (~1 yıl)
 *   node scripts/generate-data.js --scale=10   # ~10 yıl -> milyonlarca satır (büyük veri)
 *   node scripts/generate-data.js --reset       # önce üretilmiş kayıtları temizle
 *
 * BÜYÜK VERİ DERSİ: satırlar CHUNK'lar hâlinde tek transaction içinde yazılır (batch insert);
 * order toplamı INSERT'ten ÖNCE hesaplanır (post-UPDATE yok). Sonda benchmark + EXPLAIN QUERY PLAN.
 */

const { getDb, hashPassword, SLOTS } = require('../backend/database');

const args = process.argv.slice(2);
const scale = Math.max(1, parseInt((args.find(a => a.startsWith('--scale=')) || '').split('=')[1] || '1', 10));
const doReset = args.includes('--reset');

const CHUNK = 8000;          // batch başına yazma işlemi
const USER_POOL = 200;
const DAYS = 365 * scale;
const ORDER_RATE = 0.6;
const CANCEL_RATE = 0.08;
const HIGHCHAIR_RATE = 0.15;
const PAYMENTS = ['cash', 'card', 'online'];

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const slotPopularity = (s) =>
  (s === '13:00' || s === '19:00' || s === '20:30') ? 1.0 : (s === '11:30' || s === '14:30' || s === '17:30') ? 0.6 : 0.3;

const db = getDb();

if (doReset) {
  console.log('[gen] --reset: üretilmiş kayıtlar temizleniyor...');
  db.exec('DELETE FROM order_items; DELETE FROM orders; DELETE FROM reservations;');
  db.exec("DELETE FROM users WHERE username LIKE 'musteri\\_%' ESCAPE '\\'");
}

// 1) Sentetik müşteri havuzu (idempotent)
console.log(`[gen] ${USER_POOL} sentetik müşteri hazırlanıyor...`);
const sharedHash = hashPassword('musteri-' + Date.now());
const insertUser = db.prepare("INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, 'user')");
db.exec('BEGIN');
for (let i = 1; i <= USER_POOL; i++) insertUser.run(`musteri_${String(i).padStart(4, '0')}`, sharedHash);
db.exec('COMMIT');
const userIds = db.prepare("SELECT id FROM users WHERE username LIKE 'musteri\\_%' ESCAPE '\\'").all().map(r => r.id);

// 2) Tesisler + menüleri
const facilities = db.prepare('SELECT id, capacity FROM facilities').all();
const menuByFacility = {};
for (const f of facilities) menuByFacility[f.id] = db.prepare('SELECT id, price_minor FROM menu_items WHERE facility_id = ?').all(f.id);

const insReservation = db.prepare(`
  INSERT OR IGNORE INTO reservations
    (user_id, facility_id, reserve_date, reserve_time, guests, highchair_count, status, amount_minor, payment_type, crypto_signature)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated')`);
const insOrder = db.prepare("INSERT INTO orders (reservation_id, status, total_minor) VALUES (?, 'paid', ?)");
const insOrderItem = db.prepare('INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_minor) VALUES (?, ?, ?, ?)');

const today = new Date();
let totalRes = 0, totalOrders = 0, totalItems = 0, pending = 0;
const t0 = Date.now();

db.exec('BEGIN');
for (let d = 0; d < DAYS; d++) {
  const iso = new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10);
  const dow = new Date(today.getTime() - d * 86400000).getDay();
  const weekend = (dow === 0 || dow === 6) ? 1.5 : 1.0;

  for (const f of facilities) {
    const menu = menuByFacility[f.id];
    for (const slot of SLOTS) {
      // Makul MUTLAK doluluk hedefi (kapasiteyi aşmaz) - gerçekçi: bir slotta birkaç grup.
      const targetSeats = Math.min(f.capacity, Math.round(slotPopularity(slot) * weekend * randInt(0, 16)));
      if (targetSeats === 0) continue;
      let seats = 0;
      let k = randInt(0, USER_POOL - 1); // farklı kullanıcılar için rastgele başlangıç, adım adım
      let used = 0;
      while (seats < targetSeats && used < USER_POOL) {
        const guests = Math.min(randInt(1, 6), f.capacity - seats);
        if (guests <= 0) break;
        const uid = userIds[k % USER_POOL]; k++; used++;
        const highchair = Math.random() < HIGHCHAIR_RATE ? randInt(1, Math.min(2, guests)) : 0;
        const cancelled = Math.random() < CANCEL_RATE;

        // Sipariş toplamını INSERT'ten ÖNCE hesapla (post-UPDATE yok = hızlı)
        let items = [], total = 0;
        if (!cancelled && menu.length && Math.random() < ORDER_RATE) {
          const n = randInt(1, 4);
          for (let j = 0; j < n; j++) { const m = pick(menu); const q = randInt(1, 3); items.push([m.id, q, m.price_minor]); total += q * m.price_minor; }
        }

        const r = insReservation.run(uid, f.id, iso, slot, guests, highchair,
          cancelled ? 'cancelled' : 'confirmed', total, pick(PAYMENTS));
        if (r.changes === 0) continue; // UNIQUE çakışması -> atla
        if (!cancelled) seats += guests;
        totalRes++; pending++;

        if (items.length) {
          const orderId = Number(insOrder.run(Number(r.lastInsertRowid), total).lastInsertRowid);
          for (const [mid, q, price] of items) { insOrderItem.run(orderId, mid, q, price); totalItems++; pending++; }
          totalOrders++;
        }

        if (pending >= CHUNK) {
          db.exec('COMMIT'); db.exec('BEGIN'); pending = 0;
          process.stdout.write(`\r[gen] rezervasyon: ${totalRes}  sipariş: ${totalOrders}  kalem: ${totalItems}`);
        }
      }
    }
  }
}
db.exec('COMMIT');
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n[gen] Tamamlandı: ${totalRes} rezervasyon, ${totalOrders} sipariş, ${totalItems} kalem — ${secs}s (scale=${scale}, ${DAYS} gün)`);

// 3) BENCHMARK: aylık ciro (OLAP) + EXPLAIN QUERY PLAN (indeks kanıtı)
console.log('\n[gen] Benchmark - aylık ciro (son 6 ay):');
const b0 = Date.now();
const rows = db.prepare(`
  SELECT substr(reserve_date,1,7) AS ay, SUM(amount_minor) AS ciro, COUNT(*) AS rez
  FROM reservations WHERE status != 'cancelled' GROUP BY ay ORDER BY ay DESC LIMIT 6`).all();
console.log(`  sorgu süresi: ${Date.now() - b0}ms`);
rows.forEach(r => console.log(`   ${r.ay}: ${(r.ciro / 100).toLocaleString('tr-TR')} TL (${r.rez} rez)`));

console.log('\n[gen] Slot doluluk sorgusu EXPLAIN QUERY PLAN:');
db.prepare("EXPLAIN QUERY PLAN SELECT SUM(guests) FROM reservations WHERE facility_id=1 AND reserve_date='2026-06-01' AND reserve_time='19:00'")
  .all().forEach(p => console.log('  ', p.detail));
