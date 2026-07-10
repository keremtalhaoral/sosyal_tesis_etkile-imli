/**
 * test-concurrency.js - Eşzamanlılık doğruluğunun KANITI (Faz v2-03, ADR-003).
 *
 * Gerçek OS thread'leri (worker_threads), her biri aynı SQLite dosyasına AYRI bağlantı açar
 * (WAL: çok okuyucu + seri yazıcı). Üç senaryo:
 *   1) İSPARK: kapasite C, N>C eşzamanlı "yer kap" -> TAM C başarılı (atomik compare-and-set).
 *   2) Rezervasyon ATOMİK: BEGIN IMMEDIATE içinde oku+kontrol+yaz -> overbook YOK.
 *   3) Rezervasyon NAİF: txn dışı oku (araya gecikme) sonra yaz -> WRITE-SKEW / overbook.
 *
 * Çalıştırma: node backend/test-concurrency.js
 */

const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');

// ---------------------------------------------------------------------------
// WORKER: tek bir eşzamanlı işlemi yürütür
// ---------------------------------------------------------------------------
if (!isMainThread) {
  process.env.DB_PATH = workerData.dbPath;
  const { getDb, transaction } = require('./database');
  const db = require('./db');
  const conn = getDb();
  const { op, userId, facilityId, date, slot } = workerData;
  let ok = false;

  if (op === 'ispark') {
    ok = db.takeIsparkSpot(facilityId);

  } else if (op === 'atomic') {
    try {
      db.createReservation({ userId, facilityId, reserveDate: date, reserveTime: slot, guests: 1, cryptoSignature: 'c' });
      ok = true;
    } catch { ok = false; }

  } else if (op === 'naive') {
    // YANLIŞ YOL: kontrol ve yazma AYRI; araya gecikme ile yarış penceresi genişletilir.
    try {
      const cap = conn.prepare('SELECT capacity FROM facilities WHERE id = ?').get(facilityId).capacity;
      const { booked } = conn.prepare(
        "SELECT COALESCE(SUM(guests),0) AS booked FROM reservations WHERE facility_id=? AND reserve_date=? AND reserve_time=? AND status!='cancelled'"
      ).get(facilityId, date, slot);
      const gap = Date.now() + 8; while (Date.now() < gap) { /* yarış penceresi */ }
      if (booked + 1 <= cap) {
        conn.prepare(
          "INSERT OR IGNORE INTO reservations (user_id,facility_id,reserve_date,reserve_time,guests,crypto_signature) VALUES (?,?,?,?,1,'c')"
        ).run(userId, facilityId, date, slot);
        ok = true;
      }
    } catch { ok = false; }
  }

  parentPort.postMessage({ ok });
  return;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'conc-')), 'test.db');
const { getDb } = require('./database');
const conn = getDb();

let passed = 0, failed = 0;
const assert = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name} ${detail}`); }
  else { failed++; console.error(`  FAIL  ${name} ${detail}`); }
};

// Test kullanıcı havuzu (UNIQUE(user,facility,date,time) yüzünden her worker farklı kullanıcı)
const N = 40;
const uids = [];
for (let i = 0; i < N; i++) {
  const r = conn.prepare("INSERT INTO users (username, password, role) VALUES (?, 'x', 'user')").run(`conc_user_${i}`);
  uids.push(Number(r.lastInsertRowid));
}
// Temiz senaryo: 1 nolu tesis kapasitesi 10, İSPARK kapasitesi 10
conn.prepare('UPDATE facilities SET capacity = 10 WHERE id = 1').run();
conn.prepare('UPDATE ispark_status SET capacity = 10, occupied = 0 WHERE facility_id = 1').run();

const runWorkers = (op, date, slot) => Promise.all(
  Array.from({ length: N }, (_, i) => new Promise((resolve) => {
    const w = new Worker(__filename, { workerData: { dbPath: process.env.DB_PATH, op, userId: uids[i], facilityId: 1, date, slot } });
    w.on('message', (m) => resolve(m.ok));
    w.on('error', () => resolve(false));
  }))
);

(async () => {
  console.log(`Eşzamanlılık testi: ${N} paralel worker, kapasite = 10\n`);

  // 1) İSPARK: 40 eşzamanlı yer kapma -> tam 10 başarılı
  const isparkResults = await runWorkers('ispark', '2027-01-01', '19:00');
  const isparkOk = isparkResults.filter(Boolean).length;
  const isparkOccupied = conn.prepare('SELECT occupied FROM ispark_status WHERE facility_id = 1').get().occupied;
  assert('İSPARK: tam kapasite kadar (10) yer kapıldı', isparkOk === 10, `(başarılı=${isparkOk})`);
  assert('İSPARK: occupied kapasiteyi aşmadı (CHECK)', isparkOccupied === 10, `(occupied=${isparkOccupied})`);

  // 2) ATOMİK rezervasyon: 40 eşzamanlı -> overbook YOK, tam 10 başarılı
  const atomicResults = await runWorkers('atomic', '2027-02-01', '19:00');
  const atomicOk = atomicResults.filter(Boolean).length;
  const atomicBooked = conn.prepare("SELECT COALESCE(SUM(guests),0) AS b FROM reservations WHERE facility_id=1 AND reserve_date='2027-02-01' AND reserve_time='19:00'").get().b;
  assert('ATOMİK: overbook YOK (booked <= 10)', atomicBooked <= 10, `(booked=${atomicBooked})`);
  assert('ATOMİK: tam 10 rezervasyon başarılı', atomicOk === 10, `(başarılı=${atomicOk})`);

  // 3) NAİF rezervasyon: 40 eşzamanlı -> write-skew, overbook GÖSTERİLİR
  const naiveResults = await runWorkers('naive', '2027-03-01', '19:00');
  const naiveOk = naiveResults.filter(Boolean).length;
  const naiveBooked = conn.prepare("SELECT COALESCE(SUM(guests),0) AS b FROM reservations WHERE facility_id=1 AND reserve_date='2027-03-01' AND reserve_time='19:00'").get().b;
  console.log(`\n  [demo] NAİF yol sonucu: booked=${naiveBooked} (kapasite 10) — başarılı=${naiveOk}`);
  assert('NAİF: write-skew ile overbook GÖSTERİLDİ (booked > 10)', naiveBooked > 10,
    `(booked=${naiveBooked}; atomik yol bunu ${atomicBooked}'de tutuyordu)`);

  console.log(`\n${passed} başarılı, ${failed} başarısız`);
  console.log('Ders: aynı mantık; fark yalnızca oku+yaz\'ın TEK atomik transaction olması (BEGIN IMMEDIATE).');
  process.exit(failed === 0 ? 0 : 1);
})();
