/**
 * db.js - Veri Erişim Katmanı (Repository) + Mekansal Analiz
 *
 * SORUMLULUK SINIRI: Bu dosya = iş odaklı repository (tesis/rezervasyon/sipariş okuma-yazma)
 * + mekansal sorgular. Alttaki düşük seviye depolama (db()/transaction/hashPassword)
 * database.js'ten gelir; burada onun üstüne uygulama sorguları kurulur.
 *
 * MEKANSAL KATMAN ARTIK POSTGIS'TE (ADR-009). Önceden bu dosyada elle yazılmış
 * ray-casting point-in-polygon, Haversine mesafe ve JS'te sıralayarak KNN vardı; ilçe
 * geometrisi de her istekte 3.7MB'lık GeoJSON dosyasından okunuyordu. Hepsi SQL'e taşındı:
 *   ray-casting  -> ST_Contains        (GiST indeksli)
 *   Haversine    -> ST_Distance(geography)
 *   JS sort KNN  -> <-> operatörü      (indeks destekli en-yakın-komşu)
 * Kazanç yalnız hız değil DOĞRULUK: ST_Distance jeodezik hesap yapar, eski Haversine
 * yaklaşımı küçük mesafelerde acos() hassasiyet kaybına giriyordu.
 */

const { db, transaction, hashPassword, hashPasswordAsync } = require('./database');
const { signOrder } = require('./security');

// ---------------------------------------------------------------------------
// Satır -> API şekli dönüşümü (mevcut frontend sözleşmesi korunur)
// ---------------------------------------------------------------------------
const rowToFacility = (row) => ({
  id: row.id,
  kod: row.kod,
  ad: row.ad,
  adres: row.adres,
  koordinatlar: [row.lat, row.lng],
  kapasite: row.capacity,
  // dolulukOrani TÜRETİLMİŞ: o günün onaylı rezervasyonlarının koltuk toplamı / kapasite.
  // Kaynak = reservations tablosu, elle girilmiş bir alan değil.
  dolulukOrani: row.live_occupancy,
  dolulukKaynagi: {
    tarih: row.occupancy_date,
    rezerveKoltuk: row.booked_seats,
    // Adminin elle girdiği gösterge. Artık "doluluk" diye sunulmuyor; ayrı alan olarak durur
    // ki panelde "elle işaretlenen" ile "gerçekte olan" karşılaştırılabilsin.
    manuelIsaret: row.manual_occupancy
  },
  transit: {
    otobus: row.iett_info,
    vapur: row.vapur_info,
    aktarma: row.transit_transfer,
    arabayla: row.route_description
  }
});

// ---------------------------------------------------------------------------
// Okuma operasyonları
// ---------------------------------------------------------------------------
/**
 * Gerçek doluluk = o günün İPTAL EDİLMEMİŞ rezervasyonlarının misafir toplamı / kapasite.
 * LATERAL alt sorgu her tesis için bir kez koşar ve idx_reservations_slot'u kullanır.
 * 100'e sıkıştırılır (tarihsel aşırı veri grafiği patlatmasın).
 */
const FACILITY_SELECT = `
  SELECT f.*,
         $1::date AS occupancy_date,
         o.booked_seats,
         LEAST(100, ROUND(o.booked_seats * 100.0 / f.capacity))::int AS live_occupancy
  FROM facilities f
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(r.guests), 0)::int AS booked_seats
    FROM reservations r
    WHERE r.facility_id = f.id AND r.reserve_date = $1::date AND r.status <> 'cancelled'
  ) o ON TRUE
`;

const today = () => new Date().toISOString().slice(0, 10);

const getFacilities = async (onDate = today()) =>
  (await db().all(`${FACILITY_SELECT} ORDER BY f.id`, [onDate])).map(rowToFacility);

const getFacilityById = async (id, onDate = today()) => {
  const row = await db().one(`${FACILITY_SELECT} WHERE f.id = $2`, [onDate, id]);
  return row ? rowToFacility(row) : null;
};

/**
 * PostGIS spatial join: ilçe sınırları × tesis noktaları + demografi.
 * Eskiden bu, her istekte 39 ilçe × 30 tesis JS döngüsüydü ve 3.7MB GeoJSON'u
 * bellekte tutuyordu. Artık tek sorgu; geometri ST_AsGeoJSON ile döner.
 *
 * Alarm eşikleri bilinçli olarak SQL'de DEĞİL: bunlar politika kararı (kaç tesis "yeterli"),
 * veri sorusu değil. Değişince migration gerekmesin diye uygulama katmanında kalıyorlar.
 */
const getProcessedDistricts = async () => {
  const rows = await db().all(`
    SELECT d.name,
           d.population,
           ST_AsGeoJSON(d.geom)::json AS geometry,
           COUNT(f.id)::int AS facility_count,
           COALESCE(ARRAY_AGG(f.id) FILTER (WHERE f.id IS NOT NULL), '{}') AS facility_ids
    FROM districts d
    LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
    WHERE d.geom IS NOT NULL
    GROUP BY d.id, d.name, d.population, d.geom
    ORDER BY d.name
  `);

  const features = rows.map((row) => {
    const population = row.population || 150000;
    const facilitiesPer100k = (row.facility_count * 100000) / population;

    let alarmLevel = 'GREEN';
    let alarmReason = 'Yeterli sosyal tesis yoğunluğu';
    if (facilitiesPer100k < 0.45 && population > 250000) {
      alarmLevel = 'RED';
      alarmReason = 'Yüksek nüfus - Ciddi tesis açığı (Kırmızı Alarm)';
    } else if (facilitiesPer100k < 1.0) {
      alarmLevel = 'AMBER';
      alarmReason = 'Geliştirilmesi gereken tesis oranı';
    }

    return {
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        name: row.name,
        population,
        facilityCount: row.facility_count,
        facilitiesPer100k: parseFloat(facilitiesPer100k.toFixed(2)),
        alarmLevel,
        alarmReason,
        facilityIds: row.facility_ids
      }
    };
  });

  return { type: 'FeatureCollection', features };
};

/**
 * KNN yakınlık analizi - PostGIS <-> operatörü idx_facilities_geog GiST indeksini kullanır:
 * tüm tesisleri gezip JS'te sıralamak yerine indeksten doğrudan en yakın N'i çeker.
 *
 * ::geography ŞART: geometry <-> DERECE cinsinden düzlemsel mesafe verir; 41°N'de bir boylam
 * derecesi bir enlem derecesinden kısa olduğu için derece sıralaması metre sıralamasından
 * FARKLI çıkabiliyor (ölçüldü: geometry sıralamasında 2302m'lik tesis 2308m'likten sonra
 * geliyordu). geography hem sıralamayı hem gösterilen mesafeyi metre cinsinden doğru yapar.
 */
const getClosestFacilities = async (userLat, userLng, limit = 3) => {
  const lat = parseFloat(userLat);
  const lng = parseFloat(userLng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return [];

  const rows = await db().all(`
    ${FACILITY_SELECT}
    WHERE f.geom IS NOT NULL
    ORDER BY f.geom::geography <-> ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
    LIMIT $4
  `, [today(), lat, lng, Math.max(1, Math.min(50, Number(limit) || 3))]);

  const distances = await db().all(`
    SELECT f.id,
           ROUND(ST_Distance(f.geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography)::numeric, 1) AS distance
    FROM facilities f WHERE f.id = ANY($3::int[])
  `, [lat, lng, rows.map((r) => r.id)]);

  const distanceById = Object.fromEntries(distances.map((d) => [d.id, Number(d.distance)]));
  return rows.map((r) => ({ ...rowToFacility(r), distance: distanceById[r.id] }));
};

// ---------------------------------------------------------------------------
// Audit log (ADR-007) - APPEND-ONLY olay kaydı. Yalnız INSERT edilir; mutasyonla AYNI
// transaction içinde çağrılır ki ikisi birlikte commit/rollback olsun (DDIA Böl. 7 + 11).
// ---------------------------------------------------------------------------
const logAudit = (tx, actorUserId, action, entityType, entityId, detail) =>
  tx.run(
    'INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5)',
    [actorUserId, action, entityType, entityId, detail ? JSON.stringify(detail) : null]
  );

// limit sayı DEĞİLSE (örn. ?limit=abc) varsayılana düş, sonra aralığa sıkıştır.
const getAuditLog = (limit = 50) => {
  const n = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 50;
  return db().all(`
    SELECT a.*, u.username AS actor_username
    FROM audit_log a JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT $1
  `, [Math.max(1, Math.min(200, n))]);
};

// ---------------------------------------------------------------------------
// Yazma operasyonları
// ---------------------------------------------------------------------------
// NOT: dönüş değeri transaction COMMIT OLDUKTAN SONRA okunur.
// SQLite'ta tek bağlantı olduğu için transaction içinden okumak çalışıyordu; PostgreSQL'de
// havuzdaki BAŞKA bir bağlantı henüz commit edilmemiş satırı GÖREMEZ (okuma null dönerdi).
const createFacility = async (input, actorUserId) => {
  const facilityId = await createFacilityTx(input, actorUserId);
  return getFacilityById(facilityId);
};

const createFacilityTx = ({ kod, ad, adres, lat, lng, capacity, occupancy, iett_info, vapur_info, transit_transfer, route_description, isparkCapacity }, actorUserId) =>
  transaction(async (tx) => {
    const row = await tx.one(`
      INSERT INTO facilities (kod, ad, adres, lat, lng, capacity, manual_occupancy, iett_info, vapur_info, transit_transfer, route_description)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
    `, [
      kod, ad, adres || null, lat, lng, capacity, occupancy || 0,
      iett_info || 'Mevcut Değil', vapur_info || 'Mevcut Değil',
      transit_transfer || 'Mevcut Değil', route_description || 'Mevcut Değil'
    ]);
    const facilityId = row.id;

    // İSPARK kapasitesi opsiyonel: verilmezse otopark kaydı hiç oluşturulmaz.
    if (Number.isInteger(isparkCapacity) && isparkCapacity > 0) {
      await tx.run('INSERT INTO ispark_status (facility_id, capacity, occupied) VALUES ($1,$2,0)', [facilityId, isparkCapacity]);
    }

    await logAudit(tx, actorUserId, 'facility.create', 'facility', facilityId, { kod, ad, isparkCapacity: isparkCapacity || null });
    return facilityId;
  });

// Adminin ELLE girdiği göstergeyi günceller (gerçek doluluk değil - o rezervasyonlardan
// türetilir ve yazılamaz). Bu yüzden audit alanları da 'manual' der.
const updateFacilityOccupancy = async (id, manualOccupancy, actorUserId) => {
  const ok = await transaction(async (tx) => {
    const before = await tx.one('SELECT manual_occupancy FROM facilities WHERE id = $1', [id]);
    if (!before) return false;
    const changed = await tx.run(
      'UPDATE facilities SET manual_occupancy = $1, updated_at = now() WHERE id = $2',
      [manualOccupancy, id]
    );
    if (changed === 0) return false;
    await logAudit(tx, actorUserId, 'facility.update', 'facility', id, {
      manual_occupancy_before: before.manual_occupancy, manual_occupancy_after: manualOccupancy
    });
    return true;
  });
  // Okuma commit sonrası (yukarıdaki createFacility notuyla aynı sebep).
  return ok ? getFacilityById(id) : null;
};

const deleteFacility = (id, actorUserId) =>
  transaction(async (tx) => {
    const facility = await tx.one('SELECT kod, ad FROM facilities WHERE id = $1', [id]);
    if (!facility) return false;
    // Rezervasyonlar ON DELETE CASCADE ile otomatik temizlenir (referans bütünlüğü DB'de).
    const changes = await tx.run('DELETE FROM facilities WHERE id = $1', [id]);
    if (changes === 0) return false;
    await logAudit(tx, actorUserId, 'facility.delete', 'facility', id, { kod: facility.kod, ad: facility.ad });
    return true;
  });

const getUserByUsername = (username) =>
  db().one('SELECT * FROM users WHERE username = $1', [username]);

const insertUserRow = async (username, passwordHash, role) => {
  const row = await db().one(
    'INSERT INTO users (username, password, role) VALUES ($1,$2,$3) RETURNING id',
    [username, passwordHash, role]
  );
  return { id: row.id, username, role };
};

// Senkron hash: testler ve CLI scriptleri için (bloklaması sorun değil).
const createUser = async (username, passwordRaw, role = 'user') =>
  insertUserRow(username, hashPassword(passwordRaw), role);

// HTTP register yolu: hash'i thread pool'da üretir → event loop bloke olmaz.
const createUserAsync = async (username, passwordRaw, role = 'user') =>
  insertUserRow(username, await hashPasswordAsync(passwordRaw), role);

/**
 * Rezervasyon oluşturma - PER-SLOT kapasite muhasebesi (ADR-003).
 *
 * Aynı (tesis, tarih, slot) için onaylı rezervasyonların misafir TOPLAMI + yeni misafir
 * ≤ tesis kapasitesi olmalı. Okuma+kontrol+yazma TEK transaction içindedir.
 *
 * PostgreSQL'de bu YETMEZ: READ COMMITTED'da iki eşzamanlı işlem aynı toplamı okuyup
 * ikisi de yazabilir (write skew, phantom). transaction() varsayılan olarak SERIALIZABLE
 * kullanır ve 40001'de yeniden dener - koruma orada. test-concurrency.js ikisini de ölçer:
 * READ COMMITTED overbook EDER, SERIALIZABLE etmez.
 *
 * facilities.manual_occupancy booking'in kaynağı DEĞİL; yalnız elle girilen bir işarettir.
 */
const createReservation = ({ userId, facilityId, reserveDate, reserveTime, guests, highchairCount = 0, cryptoSignature }) =>
  transaction(async (tx) => {
    const facility = await tx.one('SELECT capacity FROM facilities WHERE id = $1', [facilityId]);
    if (!facility) {
      const err = new Error('Tesis bulunamadı.');
      err.statusCode = 404;
      throw err;
    }

    const { booked } = await tx.one(`
      SELECT COALESCE(SUM(guests), 0)::int AS booked FROM reservations
      WHERE facility_id = $1 AND reserve_date = $2::date AND reserve_time = $3::time AND status <> 'cancelled'
    `, [facilityId, reserveDate, reserveTime]);

    if (booked + guests > facility.capacity) {
      const err = new Error(`Bu slot için yeterli yer yok. Kalan: ${facility.capacity - booked}, istenen: ${guests}.`);
      err.statusCode = 409;
      throw err;
    }

    const row = await tx.one(`
      INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, highchair_count, crypto_signature)
      VALUES ($1,$2,$3::date,$4::time,$5,$6,$7) RETURNING id
    `, [userId, facilityId, reserveDate, reserveTime, guests, highchairCount, cryptoSignature]);

    const bookedAfter = booked + guests;
    return { id: row.id, booked: bookedAfter, remaining: facility.capacity - bookedAfter };
  });

// --- İSPARK: bağımsız bookable kaynak (atomik compare-and-set) --------------
const getIsparkStatus = (facilityId) =>
  db().one(
    'SELECT facility_id, capacity, occupied, capacity - occupied AS free FROM ispark_status WHERE facility_id = $1',
    [facilityId]
  );

/**
 * Yer kapma - atomik compare-and-set. Koşul UPDATE'in WHERE'ine gömülüdür:
 * "occupied < capacity" iken +1. PostgreSQL tek statement'ı satır kilidiyle atomik yürütür;
 * N eşzamanlı çağrıdan tam (capacity) tanesi başarılı olur (lost update imkansız).
 * Burada write skew YOK - çakışma VAR OLAN tek satır üzerinde, bu yüzden SERIALIZABLE
 * gerekmez; satır kilidi yeterlidir (ADR-003 / ADR-009).
 */
const takeIsparkSpot = async (facilityId) =>
  (await db().run(
    'UPDATE ispark_status SET occupied = occupied + 1, updated_at = now() WHERE facility_id = $1 AND occupied < capacity',
    [facilityId]
  )) === 1;

const releaseIsparkSpot = async (facilityId) =>
  (await db().run(
    'UPDATE ispark_status SET occupied = occupied - 1, updated_at = now() WHERE facility_id = $1 AND occupied > 0',
    [facilityId]
  )) === 1;

const getReservationsByUserId = (userId) =>
  db().all(`
    SELECT r.*, f.ad AS facility_name
    FROM reservations r
    JOIN facilities f ON f.id = r.facility_id
    WHERE r.user_id = $1
    ORDER BY r.reserve_date, r.reserve_time
  `, [userId]);

// --- Menü + Sipariş ---------------------------------------------------------
const getMenu = (facilityId) =>
  db().all(
    'SELECT id, facility_id, name, category, price_minor FROM menu_items WHERE facility_id = $1 AND is_available ORDER BY category, name',
    [facilityId]
  );

/**
 * Sipariş oluşturma - TEK atomik transaction (DDIA Böl. 7).
 * - Rezervasyon kullanıcıya ait mi? (sahiplik)
 * - Her kalem AYNI tesisin menüsünden mi?
 * - Fiyat menu_items'tan SNAPSHOT'lanır (captured vs derived, Böl. 11).
 * - total sunucuda hesaplanır (istemciye güvenilmez).
 * - İMZA BURADA üretilir: kapsaması gereken tutar ancak fiyatlar okunduktan sonra bilinir.
 */
const createOrder = ({ userId, reservationId, items, paymentType }) =>
  transaction(async (tx) => {
    const reservation = await tx.one('SELECT id, user_id, facility_id FROM reservations WHERE id = $1', [reservationId]);
    if (!reservation) { const e = new Error('Rezervasyon bulunamadı.'); e.statusCode = 404; throw e; }
    if (reservation.user_id !== userId) { const e = new Error('Bu rezervasyon size ait değil.'); e.statusCode = 403; throw e; }

    const menu = {};
    for (const m of await tx.all('SELECT id, price_minor FROM menu_items WHERE facility_id = $1 AND is_available', [reservation.facility_id])) {
      menu[m.id] = m.price_minor;
    }

    let total = 0;
    const resolved = [];
    for (const it of items) {
      const price = menu[it.menuItemId];
      if (price === undefined) { const e = new Error(`Menü kalemi bu tesiste yok veya mevcut değil: ${it.menuItemId}`); e.statusCode = 409; throw e; }
      resolved.push({ menuItemId: it.menuItemId, quantity: it.quantity, unitPrice: price });
      total += price * it.quantity;
    }

    // İmza GERÇEK toplamı kapsıyor: tutar kurcalanırsa imza tutmaz.
    const signature = signOrder(userId, reservationId, total, items);

    const orderRow = await tx.one(
      "INSERT INTO orders (reservation_id, status, total_minor, crypto_signature, payment_type) VALUES ($1,'submitted',$2,$3,$4) RETURNING id",
      [reservationId, total, signature, paymentType]
    );
    const orderId = orderRow.id;

    for (const r of resolved) {
      await tx.run('INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_minor) VALUES ($1,$2,$3,$4)',
        [orderId, r.menuItemId, r.quantity, r.unitPrice]);
    }

    // Rezervasyon tutarına siparişi ekle (kümülatif harcama)
    await tx.run('UPDATE reservations SET amount_minor = amount_minor + $1 WHERE id = $2', [total, reservationId]);

    return { id: orderId, total_minor: total, status: 'submitted', item_count: resolved.length, signature };
  });

const getOrdersByReservation = async (reservationId, userId) => {
  const owns = await db().one('SELECT user_id FROM reservations WHERE id = $1', [reservationId]);
  if (!owns || owns.user_id !== userId) return null; // sahiplik yoksa null
  const orders = await db().all('SELECT * FROM orders WHERE reservation_id = $1 ORDER BY created_at DESC', [reservationId]);
  for (const o of orders) {
    o.items = await db().all(`
      SELECT oi.quantity, oi.unit_price_minor, m.name, m.category
      FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id WHERE oi.order_id = $1
    `, [o.id]);
  }
  return orders;
};

// --- Sipariş durum makinesi (ADR-007) ---------------------------------------
// Yalnız bu geçişlere izin verilir: geçersiz sıçrama yasak (örn. submitted'dan doğrudan
// paid'e atlanamaz - served aşaması atlanamaz).
const ORDER_TRANSITIONS = {
  submitted: ['served', 'cancelled'],
  served: ['paid', 'cancelled']
};

const updateOrderStatus = (orderId, newStatus, actorUserId) =>
  transaction(async (tx) => {
    const order = await tx.one('SELECT id, status, reservation_id, total_minor FROM orders WHERE id = $1', [orderId]);
    if (!order) { const e = new Error('Sipariş bulunamadı.'); e.statusCode = 404; throw e; }
    const allowed = ORDER_TRANSITIONS[order.status] || [];
    if (!allowed.includes(newStatus)) {
      const e = new Error(`Geçersiz durum geçişi: '${order.status}' → '${newStatus}'.`);
      e.statusCode = 409;
      throw e;
    }
    await tx.run('UPDATE orders SET status = $1 WHERE id = $2', [newStatus, orderId]);

    // PARA GERİ ALMA: createOrder tutarı reservations.amount_minor'a EKLİYOR. İptal bunu geri
    // almazsa iptal edilmiş sipariş sonsuza dek ciro sayılır (tüm raporlama amount_minor okur).
    // Ekleme ile çıkarma AYNI transaction'da olduğu için birlikte commit/rollback olur;
    // amount_minor >= 0 CHECK'i son savunma hattı olarak durur.
    if (newStatus === 'cancelled' && order.total_minor > 0) {
      await tx.run('UPDATE reservations SET amount_minor = amount_minor - $1 WHERE id = $2',
        [order.total_minor, order.reservation_id]);
    }

    await logAudit(tx, actorUserId, 'order.status_change', 'order', orderId, {
      from: order.status,
      to: newStatus,
      ...(newStatus === 'cancelled' ? { reverted_minor: order.total_minor } : {})
    });
    return { id: orderId, status: newStatus };
  });

// --- Admin gözetim (requireAdmin uçlarınca kullanılır; sahiplik filtresi YOK) -
const getAllReservations = (facilityId) =>
  db().all(`
    SELECT r.*, f.ad AS facility_name, u.username AS owner_username
    FROM reservations r
    JOIN facilities f ON f.id = r.facility_id
    JOIN users u ON u.id = r.user_id
    WHERE ($1::int IS NULL OR r.facility_id = $1::int)
    ORDER BY r.reserve_date DESC, r.reserve_time DESC
  `, [facilityId ?? null]);

const getAllOrders = (facilityId) =>
  db().all(`
    SELECT o.*, r.facility_id, f.ad AS facility_name, u.username AS owner_username
    FROM orders o
    JOIN reservations r ON r.id = o.reservation_id
    JOIN facilities f ON f.id = r.facility_id
    JOIN users u ON u.id = r.user_id
    WHERE ($1::int IS NULL OR r.facility_id = $1::int)
    ORDER BY o.created_at DESC
  `, [facilityId ?? null]);

module.exports = {
  getFacilities,
  getFacilityById,
  getDistricts: getProcessedDistricts,
  getClosestFacilities,
  createFacility,
  updateFacilityOccupancy,
  deleteFacility,
  getUserByUsername,
  createUser,
  createUserAsync,
  createReservation,
  getReservationsByUserId,
  getIsparkStatus,
  takeIsparkSpot,
  releaseIsparkSpot,
  getMenu,
  createOrder,
  getOrdersByReservation,
  updateOrderStatus,
  getAllReservations,
  getAllOrders,
  getAuditLog
};
