/**
 * test-concurrency.js - Eşzamanlılık doğruluğunun KANITI (ADR-003 + ADR-009).
 *
 * PostgreSQL'e geçişin en kritik noktası burada ölçülür. SQLite'ta `BEGIN IMMEDIATE` TÜM
 * yazıcıları serileştirdiği için "oku → kontrol et → yaz" dizisi bedava güvenliydi.
 * PostgreSQL ÇOK YAZICILIDIR: aynı kod, varsayılan READ COMMITTED altında artık güvenli
 * DEĞİL. İki işlem aynı SUM(guests)'i okuyup ikisi de yazabilir — kimse kimsenin satırını
 * ezmez (lost update yok), ama BİRLİKTE kapasite invariant'ını kırarlar. Buna WRITE SKEW
 * denir (DDIA Böl. 7.2.3) ve çakışma HENÜZ VAR OLMAYAN satırlar üzerinde olduğu için
 * (phantom) satır kilidi de çözmez.
 *
 * Gerçek OS thread'leri (worker_threads), her biri havuzdan AYRI bağlantı açar. Dört senaryo:
 *   1) İSPARK: kapasite C, N>C eşzamanlı "yer kap" -> TAM C başarılı (atomik compare-and-set).
 *   2) READ COMMITTED rezervasyon -> OVERBOOK OLUR (tehlike gösterilir).
 *   3) SERIALIZABLE rezervasyon (üretimdeki yol) -> overbook YOK.
 *   4) Naif yol (transaction dışı oku, sonra yaz) -> overbook OLUR.
 *
 * Çalıştırma: node backend/test-concurrency.js
 */

const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');

// ---------------------------------------------------------------------------
// WORKER: tek bir eşzamanlı işlemi yürütür
// ---------------------------------------------------------------------------
if (!isMainThread) {
  process.env.PG_SCHEMA = workerData.schema;
  const { db: pgdb, transaction, close } = require('./database');
  const db = require('./db');
  const { op, userId, facilityId, date, slot, startAt } = workerData;

  // BARİYER: tüm worker'lar aynı duvar-saati anında başlar. Olmazsa worker açılış gecikmeleri
  // (havuz kurulumu, bağlantı el sıkışması) okumaları birbirinden ayırır ve yarış hiç oluşmaz;
  // test "bazen overbook eder" diye kararsızlaşırdı. Bariyerle çakışma her koşuda garanti.
  const waitForBarrier = () => new Promise((r) => setTimeout(r, Math.max(0, startAt - Date.now())));

  (async () => {
    let ok = false;
    try {
      await waitForBarrier();
      if (op === 'ispark') {
        ok = await db.takeIsparkSpot(facilityId);

      } else if (op === 'serializable') {
        // ÜRETİMDEKİ YOL: transaction() varsayılanı SERIALIZABLE + 40001'de retry.
        await db.createReservation({ userId, facilityId, reserveDate: date, reserveTime: slot, guests: 1, cryptoSignature: 'c' });
        ok = true;

      } else if (op === 'read-committed') {
        // AYNI MANTIK, YALNIZ İZOLASYON DÜŞÜK. Farkın izolasyondan geldiğini kanıtlar.
        await transaction(async (tx) => {
          const { capacity } = await tx.one('SELECT capacity FROM facilities WHERE id = $1', [facilityId]);
          const { booked } = await tx.one(
            "SELECT COALESCE(SUM(guests),0)::int AS booked FROM reservations WHERE facility_id=$1 AND reserve_date=$2::date AND reserve_time=$3::time AND status<>'cancelled'",
            [facilityId, date, slot]
          );
          await new Promise((r) => setTimeout(r, 20)); // yarış penceresini genişlet
          if (booked + 1 > capacity) throw new Error('dolu');
          await tx.run(
            "INSERT INTO reservations (user_id,facility_id,reserve_date,reserve_time,guests,crypto_signature) VALUES ($1,$2,$3::date,$4::time,1,'c')",
            [userId, facilityId, date, slot]
          );
        }, { isolation: 'READ COMMITTED', retries: 1 });
        ok = true;

      } else if (op === 'naive') {
        // EN YANLIŞ YOL: kontrol ve yazma AYRI transaction'larda (hiç koruma yok).
        const { capacity } = await pgdb().one('SELECT capacity FROM facilities WHERE id = $1', [facilityId]);
        const { booked } = await pgdb().one(
          "SELECT COALESCE(SUM(guests),0)::int AS booked FROM reservations WHERE facility_id=$1 AND reserve_date=$2::date AND reserve_time=$3::time AND status<>'cancelled'",
          [facilityId, date, slot]
        );
        await new Promise((r) => setTimeout(r, 20));
        if (booked + 1 <= capacity) {
          await pgdb().run(
            "INSERT INTO reservations (user_id,facility_id,reserve_date,reserve_time,guests,crypto_signature) VALUES ($1,$2,$3::date,$4::time,1,'c')",
            [userId, facilityId, date, slot]
          );
          ok = true;
        }
      }
    } catch { ok = false; }
    await close().catch(() => {});
    parentPort.postMessage({ ok });
  })();
  return;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
const t = require('./test-helper').setup('conc');
const { assert } = t;

const N = 40;          // eşzamanlı worker
const CAPACITY = 10;   // hem tesis hem İSPARK kapasitesi

(async () => {
  const conn = await t.init();

  // Test kullanıcı havuzu (UNIQUE(user,facility,date,time) yüzünden her worker farklı kullanıcı)
  const uids = [];
  for (let i = 0; i < N; i++) {
    const r = await conn.one("INSERT INTO users (username, password, role) VALUES ($1,'x','user') RETURNING id", [`conc_user_${i}`]);
    uids.push(r.id);
  }
  await conn.run('UPDATE facilities SET capacity = $1 WHERE id = 1', [CAPACITY]);
  await conn.run('UPDATE ispark_status SET capacity = $1, occupied = 0 WHERE facility_id = 1', [CAPACITY]);

  // Bariyer anı: 40 worker'ın açılıp bağlanması için cömert pay (bkz. waitForBarrier notu).
  const runWorkers = (op, date, slot) => {
    const startAt = Date.now() + 2000;
    return Promise.all(
      Array.from({ length: N }, (_, i) => new Promise((resolve) => {
        const w = new Worker(__filename, { workerData: { schema: t.schema, op, userId: uids[i], facilityId: 1, date, slot, startAt } });
        w.on('message', (m) => resolve(m.ok));
        w.on('error', () => resolve(false));
      }))
    );
  };

  const bookedOn = async (date) => (await conn.one(
    "SELECT COALESCE(SUM(guests),0)::int AS b FROM reservations WHERE facility_id=1 AND reserve_date=$1::date AND reserve_time='19:00'", [date]
  )).b;

  console.log(`Eşzamanlılık testi: ${N} paralel worker, kapasite = ${CAPACITY}\n`);

  // 1) İSPARK: tek satır üzerinde compare-and-set. Burada write skew YOK (çakışma var olan
  //    bir satırda), bu yüzden satır kilidi yeterli - SERIALIZABLE gerekmez.
  const isparkOk = (await runWorkers('ispark', '2027-01-01', '19:00')).filter(Boolean).length;
  const isparkOccupied = (await conn.one('SELECT occupied FROM ispark_status WHERE facility_id = 1')).occupied;
  assert(`İSPARK: tam kapasite kadar (${CAPACITY}) yer kapıldı (başarılı=${isparkOk})`, isparkOk === CAPACITY);
  assert(`İSPARK: occupied kapasiteyi aşmadı (occupied=${isparkOccupied})`, isparkOccupied === CAPACITY);

  // 2) READ COMMITTED: TEHLİKEYİ GÖSTERİR. Aynı kod, düşük izolasyon -> overbook.
  const rcOk = (await runWorkers('read-committed', '2027-02-01', '19:00')).filter(Boolean).length;
  const rcBooked = await bookedOn('2027-02-01');
  console.log(`\n  [demo] READ COMMITTED: booked=${rcBooked} (kapasite ${CAPACITY}), başarılı=${rcOk}`);
  assert(`READ COMMITTED: write-skew ile OVERBOOK gösterildi (booked=${rcBooked} > ${CAPACITY})`, rcBooked > CAPACITY);

  // 3) SERIALIZABLE: ÜRETİMDEKİ YOL. Aynı mantık, doğru izolasyon -> overbook YOK.
  const serOk = (await runWorkers('serializable', '2027-04-01', '19:00')).filter(Boolean).length;
  const serBooked = await bookedOn('2027-04-01');
  console.log(`  [demo] SERIALIZABLE : booked=${serBooked} (kapasite ${CAPACITY}), başarılı=${serOk}`);
  assert(`SERIALIZABLE: overbook YOK (booked=${serBooked} <= ${CAPACITY})`, serBooked <= CAPACITY);
  assert(`SERIALIZABLE: tam ${CAPACITY} rezervasyon başarılı (başarılı=${serOk})`, serOk === CAPACITY);
  assert('SERIALIZABLE, READ COMMITTED\'dan KESİN olarak daha güvenli', serBooked < rcBooked);

  // 4) NAİF (transaction dışı oku, sonra yaz): hiçbir izolasyon seviyesi kurtaramaz.
  const naiveOk = (await runWorkers('naive', '2027-03-01', '19:00')).filter(Boolean).length;
  const naiveBooked = await bookedOn('2027-03-01');
  console.log(`  [demo] NAİF (txn yok): booked=${naiveBooked} (kapasite ${CAPACITY}), başarılı=${naiveOk}`);
  assert(`NAİF: overbook gösterildi (booked=${naiveBooked} > ${CAPACITY})`, naiveBooked > CAPACITY);

  console.log('\nDers: PostgreSQL\'de aynı kod, izolasyona göre DOĞRU ya da YANLIŞ çalışıyor.');
  console.log('SQLite bunu BEGIN IMMEDIATE ile herkesi serileştirerek gizliyordu; PostgreSQL');
  console.log('çok yazıcı olduğu için koruma artık AÇIKÇA seçilmek zorunda (SERIALIZABLE + retry).');

  await t.finish();
})().catch(async (err) => {
  console.error('\nTEST ÇÖKTÜ:', err);
  await require('./database').dropSchema().catch(() => {});
  process.exit(1);
});
