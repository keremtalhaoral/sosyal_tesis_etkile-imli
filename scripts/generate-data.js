#!/usr/bin/env node
/**
 * generate-data.js - Gerçekçi + ölçeklenebilir dummy veri üreteci (ADR-003).
 *
 * Amaç: veri tabanını her koşulda yönetebilmek + BÜYÜK veriyi yükleyip sorgulayabilmek.
 * Üretilen kayıtlar GEÇERLİDİR: per-slot kapasite ASLA aşılmaz - ve bu bir yorum değil,
 * sonda SQL ile DOĞRULANAN bir iddiadır (aşağıdaki invariant kontrolü).
 *
 * Kullanım:
 *   node scripts/generate-data.js              # gerçekçi taban (~1 yıl)
 *   node scripts/generate-data.js --scale=10   # ~10 yıl -> milyonlarca satır (büyük veri)
 *   node scripts/generate-data.js --reset      # önce üretilmiş kayıtları temizle
 *
 * BÜYÜK VERİ DERSİ: satırlar ÇOK SATIRLI INSERT'lerle toplu yazılır (satır başına bir
 * round-trip yerine chunk başına bir round-trip - PostgreSQL'de ağ gidiş-dönüşü baskın
 * maliyettir). Sipariş toplamı INSERT'ten ÖNCE hesaplanır (post-UPDATE yok).
 * Sonda benchmark + EXPLAIN ANALYZE (indeks kanıtı).
 */

const { db, init, close, transaction } = require('../backend/database');
const analytics = require('../backend/analytics');

const args = process.argv.slice(2);
const scale = Math.max(1, parseInt((args.find(a => a.startsWith('--scale=')) || '').split('=')[1] || '1', 10));
const doReset = args.includes('--reset');

const CHUNK = 2000;          // batch başına rezervasyon satırı
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

/** Çok satırlı INSERT için ($1,$2,$3),($4,$5,$6),... üretir. */
const placeholders = (rows, cols) =>
  rows.map((_, i) => `(${Array.from({ length: cols }, (_, j) => `$${i * cols + j + 1}`).join(',')})`).join(',');

(async () => {
  await init();
  const conn = db();

  if (doReset) {
    console.log('[gen] --reset: üretilmiş kayıtlar temizleniyor...');
    // order_items/orders reservations'a CASCADE bağlı; tek DELETE yeter ama açık olalım.
    await conn.run('DELETE FROM order_items');
    await conn.run('DELETE FROM orders');
    await conn.run('DELETE FROM reservations');
    await conn.run("DELETE FROM users WHERE username LIKE 'musteri\\_%'");
  }

  // 1) Sentetik müşteri havuzu (idempotent).
  //
  // HASH ÇEŞİTLİLİĞİ ÖNEMLİ: eskiden 200 kullanıcının HEPSİ tek bir hash'i paylaşıyordu
  // (hız için). Ama DBeaver'da `users` tablosu açıldığında mentör 200 ÖZDEŞ satır görüyor -
  // tam da "her kullanıcıya ayrı rastgele salt" anlatısının yanında. Doğru olan bir şeyi
  // yanlış gösteren veri, yanlış veri kadar zararlı.
  //
  // 200 kez 600k iterasyon PBKDF2 koşturmak ~20 saniye sürerdi; bunun yerine küçük bir
  // havuz (20 farklı hash) üretip döndürüyoruz: tablo gerçekçi görünüyor, üretim hızlı kalıyor.
  console.log(`[gen] ${USER_POOL} sentetik müşteri hazırlanıyor...`);
  const { hashPassword } = require('../backend/database');
  const HASH_POOL = 20;
  const hashes = Array.from({ length: HASH_POOL }, (_, i) => hashPassword(`musteri-${Date.now()}-${i}`));
  const userRows = Array.from({ length: USER_POOL }, (_, i) => [`musteri_${String(i + 1).padStart(4, '0')}`, hashes[i % HASH_POOL]]);
  await conn.run(
    `INSERT INTO users (username, password, role) VALUES ${placeholders(userRows, 2).replace(/\$(\d+)\)/g, '$$$1,\'user\')')} ON CONFLICT (username) DO NOTHING`,
    userRows.flat()
  );
  const userIds = (await conn.all("SELECT id FROM users WHERE username LIKE 'musteri\\_%' ORDER BY id")).map(r => r.id);

  // 2) Tesisler + menüleri + slotlar
  const facilities = await conn.all('SELECT id, capacity FROM facilities ORDER BY id');
  const SLOTS = require('../backend/database').SLOTS;
  const menuByFacility = {};
  for (const f of facilities) {
    menuByFacility[f.id] = await conn.all('SELECT id, price_minor FROM menu_items WHERE facility_id = $1', [f.id]);
  }

  // Bu script createReservation()'ı BYPASS edip toplu INSERT kullanıyor (hız için).
  // Dolayısıyla per-slot kapasite invariant'ını KENDİSİ korumak zorunda: DB'de o slotta
  // zaten duran koltukları okumadan yazarsa, --reset olmadan ikinci koşuda kapasite aşılır.
  const existing = new Map();
  for (const row of await conn.all(`
    SELECT facility_id, to_char(reserve_date,'YYYY-MM-DD') AS d, to_char(reserve_time,'HH24:MI') AS s, SUM(guests)::int AS seats
    FROM reservations WHERE status <> 'cancelled'
    GROUP BY facility_id, reserve_date, reserve_time
  `)) {
    existing.set(`${row.facility_id}|${row.d}|${row.s}`, row.seats);
  }
  if (existing.size) console.log(`[gen] Mevcut ${existing.size} dolu slot okundu (kapasite bunların ÜSTÜNE eklenmeyecek).`);

  const today = new Date();
  let totalRes = 0, totalOrders = 0, totalItems = 0;
  const t0 = Date.now();
  let batch = [];

  /** Bir chunk rezervasyonu + bağlı siparişlerini tek transaction'da yazar. */
  const flush = async () => {
    if (!batch.length) return;
    await transaction(async (tx) => {
      const cols = 10;
      const values = batch.flatMap(b => [b.uid, b.fid, b.date, b.slot, b.guests, b.highchair, b.status, b.total, b.payment, 'generated']);
      // ON CONFLICT DO NOTHING + RETURNING: yalnız GERÇEKTEN eklenen satırlar döner.
      // Böylece UNIQUE çakışmasına takılanlara sipariş yazmaya kalkmayız.
      const inserted = await tx.all(`
        INSERT INTO reservations
          (user_id, facility_id, reserve_date, reserve_time, guests, highchair_count, status, amount_minor, payment_type, crypto_signature)
        VALUES ${placeholders(batch, cols)}
        ON CONFLICT (user_id, facility_id, reserve_date, reserve_time) DO NOTHING
        RETURNING id, user_id, facility_id, to_char(reserve_date,'YYYY-MM-DD') AS d, to_char(reserve_time,'HH24:MI') AS s
      `, values);
      totalRes += inserted.length;

      // Eklenen satırları adaylarla eşle (anahtar = UNIQUE kısıtının kendisi) ve sipariş yaz.
      const byKey = new Map(batch.map(b => [`${b.uid}|${b.fid}|${b.date}|${b.slot}`, b]));
      const withOrders = inserted
        .map(r => ({ resId: r.id, cand: byKey.get(`${r.user_id}|${r.facility_id}|${r.d}|${r.s}`) }))
        .filter(x => x.cand && x.cand.items.length);

      if (withOrders.length) {
        const orderIds = await tx.all(`
          INSERT INTO orders (reservation_id, status, total_minor)
          VALUES ${withOrders.map((_, i) => `($${i * 2 + 1}, 'paid', $${i * 2 + 2})`).join(',')}
          RETURNING id
        `, withOrders.flatMap(x => [x.resId, x.cand.total]));
        totalOrders += orderIds.length;

        const itemRows = [];
        orderIds.forEach((o, i) => {
          for (const [mid, q, price] of withOrders[i].cand.items) itemRows.push([o.id, mid, q, price]);
        });
        if (itemRows.length) {
          await tx.run(
            `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_minor) VALUES ${placeholders(itemRows, 4)}`,
            itemRows.flat()
          );
          totalItems += itemRows.length;
        }
      }
    }, { isolation: 'READ COMMITTED' });  // toplu yükleme; eşzamanlı yazıcı yok
    batch = [];
    process.stdout.write(`\r[gen] rezervasyon: ${totalRes}  sipariş: ${totalOrders}  kalem: ${totalItems}   `);
  };

  for (let d = 0; d < DAYS; d++) {
    const dt = new Date(today.getTime() - d * 86400000);
    const iso = dt.toISOString().slice(0, 10);
    const weekend = (dt.getDay() === 0 || dt.getDay() === 6) ? 1.5 : 1.0;

    for (const f of facilities) {
      const menu = menuByFacility[f.id];
      for (const slot of SLOTS) {
        const key = `${f.id}|${iso}|${slot}`;
        let seats = existing.get(key) || 0;
        if (seats >= f.capacity) continue;

        const targetSeats = Math.min(f.capacity, seats + Math.round(slotPopularity(slot) * weekend * randInt(0, 16)));
        if (targetSeats <= seats) continue;

        let k = randInt(0, USER_POOL - 1);
        let used = 0;
        while (seats < targetSeats && used < USER_POOL) {
          const guests = Math.min(randInt(1, 6), targetSeats - seats);
          if (guests <= 0) break;
          const uid = userIds[k % USER_POOL]; k++; used++;
          const cancelled = Math.random() < CANCEL_RATE;

          // Sipariş toplamını INSERT'ten ÖNCE hesapla (post-UPDATE yok = hızlı)
          const items = []; let total = 0;
          if (!cancelled && menu.length && Math.random() < ORDER_RATE) {
            for (let j = 0, n = randInt(1, 4); j < n; j++) {
              const m = pick(menu); const q = randInt(1, 3);
              items.push([m.id, q, m.price_minor]); total += q * m.price_minor;
            }
          }

          batch.push({
            uid, fid: f.id, date: iso, slot, guests,
            highchair: Math.random() < HIGHCHAIR_RATE ? randInt(1, Math.min(2, guests)) : 0,
            status: cancelled ? 'cancelled' : 'confirmed',
            total, payment: pick(PAYMENTS), items
          });

          if (!cancelled) seats += guests;
          if (batch.length >= CHUNK) await flush();
        }
        existing.set(key, seats);
      }
    }
  }
  await flush();

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[gen] Tamamlandı: ${totalRes} rezervasyon, ${totalOrders} sipariş, ${totalItems} kalem — ${secs}s (scale=${scale}, ${DAYS} gün)`);

  // 3) BENCHMARK: aylık ciro (OLAP) + EXPLAIN (indeks kanıtı)
  console.log('\n[gen] Benchmark - aylık ciro (son 6 ay):');
  const b0 = Date.now();
  const rows = await conn.all(`
    SELECT to_char(reserve_date,'YYYY-MM') AS ay, SUM(amount_minor)::bigint AS ciro, COUNT(*)::int AS rez
    FROM reservations WHERE status <> 'cancelled' GROUP BY ay ORDER BY ay DESC LIMIT 6`);
  console.log(`  sorgu süresi: ${Date.now() - b0}ms`);
  rows.forEach(r => console.log(`   ${r.ay}: ${(Number(r.ciro) / 100).toLocaleString('tr-TR')} TL (${r.rez} rez)`));

  console.log('\n[gen] Slot doluluk sorgusu EXPLAIN (idx_reservations_slot kullanılmalı):');
  const plan = await conn.all(`
    EXPLAIN ANALYZE SELECT SUM(guests) FROM reservations
    WHERE facility_id=1 AND reserve_date='2026-06-01' AND reserve_time='19:00'`);
  plan.slice(0, 4).forEach(p => console.log('  ', p['QUERY PLAN']));

  // 4) INVARIANT DOĞRULAMASI: baştaki "kapasite ASLA aşılmaz" iddiası ölçülen bir gerçek olmalı.
  const overbooked = await conn.all(`
    SELECT r.facility_id, r.reserve_date, r.reserve_time, SUM(r.guests)::int AS seats, f.capacity
    FROM reservations r JOIN facilities f ON f.id = r.facility_id
    WHERE r.status <> 'cancelled'
    GROUP BY r.facility_id, r.reserve_date, r.reserve_time, f.capacity
    HAVING SUM(r.guests) > f.capacity`);
  if (overbooked.length) {
    console.error(`\n[gen] HATA: ${overbooked.length} slot kapasiteyi aşıyor! İlk örnek:`, overbooked[0]);
    process.exitCode = 1;
  } else {
    console.log('\n[gen] Invariant OK: hiçbir (tesis, tarih, slot) kapasiteyi aşmıyor.');
  }

  // 5) Rollup'ı tazele: daily_stats türetilmiş veridir, kaynak değişince yeniden kurulmalı.
  console.log(`[gen] daily_stats rollup yeniden kuruldu: ${await analytics.rebuildDailyStats()} satır.`);

  await close();
})().catch(async (err) => {
  console.error('\n[gen] HATA:', err.message);
  await close().catch(() => {});
  process.exit(1);
});
