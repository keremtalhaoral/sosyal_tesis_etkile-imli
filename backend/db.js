/**
 * db.js - Veri Erişim Katmanı (Repository) + Mekansal Analiz
 *
 * Bu modül artık veriyi kod içinde saklamaz: tüm okuma/yazma merkezi SQLite veritabanına
 * (data/app.db, bkz. database.js ve DATABASE.md) gider. Mekansal fonksiyonlar (ray-casting
 * point-in-polygon, Haversine mesafe, KNN) korunmuştur; PostGIS'e geçişte bunlar
 * ST_Contains / ST_Distance / <-> operatörlerine birebir çevrilebilir.
 */

const fs = require('fs');
const path = require('path');
const { getDb, transaction, hashPassword } = require('./database');

// ---------------------------------------------------------------------------
// GeoJSON ilçe sınırları (statik referans verisi - salt okunur, DB'ye taşınmadı
// çünkü 3.7MB'lık geometri blob'u SQLite'ta sorgulanamıyor; PostGIS'te geometry
// kolonu olur. Nüfus gibi *değişebilen* demografik veri ise DB'dedir.)
// ---------------------------------------------------------------------------
let districtsGeoJSON = null;
try {
  const filePath = path.join(__dirname, 'data', 'istanbul-districts.geojson');
  districtsGeoJSON = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (error) {
  console.error('Critical Error: istanbul-districts.geojson yüklenemedi. Boş koleksiyonla devam ediliyor.', error);
  districtsGeoJSON = { type: 'FeatureCollection', features: [] };
}

// ---------------------------------------------------------------------------
// Mekansal yardımcılar
// ---------------------------------------------------------------------------
const pointInPolygonRing = (lng, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const pointInPolygon = (lng, lat, geometry) => {
  if (!geometry || !geometry.coordinates) return false;
  if (geometry.type === 'Polygon') {
    return pointInPolygonRing(lng, lat, geometry.coordinates[0]);
  } else if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(polygon => pointInPolygonRing(lng, lat, polygon[0]));
  }
  return false;
};

const calculateGeodesicDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const dist = Math.acos(Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(deltaLambda)) * R;
  return isNaN(dist) ? 0 : dist;
};

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
  dolulukOrani: row.occupancy,
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
const getFacilities = () =>
  getDb().prepare('SELECT * FROM facilities ORDER BY id').all().map(rowToFacility);

const getFacilityById = (id) => {
  const row = getDb().prepare('SELECT * FROM facilities WHERE id = ?').get(id);
  return row ? rowToFacility(row) : null;
};

const getDistrictPopulations = () => {
  const map = {};
  for (const row of getDb().prepare('SELECT name, population FROM districts').all()) {
    map[row.name] = row.population;
  }
  return map;
};

/**
 * Simüle edilmiş PostGIS spatial join: ilçe sınırları x tesis noktaları + demografi.
 * SQL karşılığı:
 *   SELECT d.name, COUNT(f.id), d.population
 *   FROM districts d LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
 *   GROUP BY d.id;
 */
const getProcessedDistricts = () => {
  if (!districtsGeoJSON || !districtsGeoJSON.features) return districtsGeoJSON;

  const populations = getDistrictPopulations();
  const facilities = getFacilities();

  const features = districtsGeoJSON.features.map(feature => {
    const districtName = feature.properties.name;
    const population = populations[districtName] || 150000;

    const insideFacilities = facilities.filter(fac => {
      const [facLat, facLng] = fac.koordinatlar;
      return pointInPolygon(facLng, facLat, feature.geometry);
    });

    const facilityCount = insideFacilities.length;
    const facilitiesPer100k = (facilityCount * 100000) / population;

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
      ...feature,
      properties: {
        ...feature.properties,
        population,
        facilityCount,
        facilitiesPer100k: parseFloat(facilitiesPer100k.toFixed(2)),
        alarmLevel,
        alarmReason,
        facilityIds: insideFacilities.map(f => f.id)
      }
    };
  });

  return { type: 'FeatureCollection', features };
};

/**
 * KNN yakınlık analizi. SQL karşılığı:
 *   SELECT id, ad, ST_Distance(geom, ST_MakePoint(lon, lat)) AS dist
 *   FROM facilities ORDER BY geom <-> ST_MakePoint(lon, lat) LIMIT 3;
 */
const getClosestFacilities = (userLat, userLng, limit = 3) => {
  const lat = parseFloat(userLat);
  const lng = parseFloat(userLng);
  if (isNaN(lat) || isNaN(lng)) return [];

  return getFacilities()
    .map(facility => {
      const [facLat, facLng] = facility.koordinatlar;
      return {
        ...facility,
        distance: parseFloat(calculateGeodesicDistance(lat, lng, facLat, facLng).toFixed(1))
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
};

// ---------------------------------------------------------------------------
// Audit log (Faz v2-07, ADR-007) - APPEND-ONLY olay kaydı. Yalnız INSERT edilir;
// mutasyonla AYNI transaction içinde çağrılır ki ikisi birlikte commit/rollback olsun
// (DDIA Böl. 7 atomiklik + Böl. 11: gerçekleşmiş bir olay hiç yazılmamış gibi kalmamalı).
// ---------------------------------------------------------------------------
const logAudit = (conn, actorUserId, action, entityType, entityId, detail) => {
  conn.prepare(
    'INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(actorUserId, action, entityType, entityId, detail ? JSON.stringify(detail) : null);
};

const getAuditLog = (limit = 50) =>
  getDb().prepare(`
    SELECT a.*, u.username AS actor_username
    FROM audit_log a JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(200, limit)));

// ---------------------------------------------------------------------------
// Yazma operasyonları - "yeni veriler" artık kalıcı olarak tek yerde tutulur.
// ---------------------------------------------------------------------------
const createFacility = ({ kod, ad, adres, lat, lng, capacity, occupancy, iett_info, vapur_info, transit_transfer, route_description, isparkCapacity }, actorUserId) =>
  transaction((conn) => {
    const result = conn.prepare(`
      INSERT INTO facilities (kod, ad, adres, lat, lng, capacity, occupancy, iett_info, vapur_info, transit_transfer, route_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      kod, ad, adres || null, lat, lng, capacity, occupancy || 0,
      iett_info || 'Mevcut Değil', vapur_info || 'Mevcut Değil',
      transit_transfer || 'Mevcut Değil', route_description || 'Mevcut Değil'
    );
    const facilityId = Number(result.lastInsertRowid);

    // İSPARK kapasitesi opsiyonel (ADR-003 gap kapanışı, Karar: v2-07 sorusu). Verilmezse
    // otopark kaydı hiç oluşturulmaz (mevcut 'Mevcut Değil' desenine uyumlu).
    if (Number.isInteger(isparkCapacity) && isparkCapacity > 0) {
      conn.prepare('INSERT INTO ispark_status (facility_id, capacity, occupied) VALUES (?, ?, 0)').run(facilityId, isparkCapacity);
    }

    logAudit(conn, actorUserId, 'facility.create', 'facility', facilityId, { kod, ad, isparkCapacity: isparkCapacity || null });
    return getFacilityById(facilityId);
  });

const updateFacilityOccupancy = (id, occupancy, actorUserId) =>
  transaction((conn) => {
    const before = conn.prepare('SELECT occupancy FROM facilities WHERE id = ?').get(id);
    if (!before) return null;
    const result = conn.prepare(
      "UPDATE facilities SET occupancy = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(occupancy, id);
    if (result.changes === 0) return null;
    logAudit(conn, actorUserId, 'facility.update', 'facility', id, { occupancy_before: before.occupancy, occupancy_after: occupancy });
    return getFacilityById(id);
  });

const deleteFacility = (id, actorUserId) =>
  transaction((conn) => {
    const facility = conn.prepare('SELECT kod, ad FROM facilities WHERE id = ?').get(id);
    if (!facility) return false;
    // Rezervasyonlar ON DELETE CASCADE ile otomatik temizlenir (referans bütünlüğü DB'de).
    const changes = conn.prepare('DELETE FROM facilities WHERE id = ?').run(id).changes;
    if (changes === 0) return false;
    logAudit(conn, actorUserId, 'facility.delete', 'facility', id, { kod: facility.kod, ad: facility.ad });
    return true;
  });

const getUserByUsername = (username) =>
  getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) || null;

const createUser = (username, passwordRaw, role = 'user') => {
  const result = getDb().prepare(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?)'
  ).run(username, hashPassword(passwordRaw), role);
  return { id: Number(result.lastInsertRowid), username, role };
};

/**
 * Rezervasyon oluşturma - PER-SLOT kapasite muhasebesi (Faz v2-03, ADR-003).
 *
 * Kapasite kararı artık kaba global yüzde DEĞİL: aynı (tesis, tarih, slot) için onaylı
 * rezervasyonların misafir TOPLAMI + yeni misafir ≤ tesis kapasitesi olmalı. Okuma+kontrol+
 * yazma TEK atomik transaction (BEGIN IMMEDIATE) içindedir → iki eşzamanlı rezervasyon
 * son yeri paylaşamaz (WRITE-SKEW'e kapalı). Naif yol (txn dışı oku, sonra yaz) overbook
 * ederdi; test-concurrency.js bunu kanıtlar.
 *
 * facilities.occupancy artık yalnız görüntüleme metriğidir (derived), booking'in kaynağı DEĞİL.
 */
const createReservation = ({ userId, facilityId, reserveDate, reserveTime, guests, highchairCount = 0, cryptoSignature }) =>
  transaction((conn) => {
    const facility = conn.prepare('SELECT capacity FROM facilities WHERE id = ?').get(facilityId);
    if (!facility) {
      const err = new Error('Tesis bulunamadı.');
      err.statusCode = 404;
      throw err;
    }

    const { booked } = conn.prepare(`
      SELECT COALESCE(SUM(guests), 0) AS booked FROM reservations
      WHERE facility_id = ? AND reserve_date = ? AND reserve_time = ? AND status != 'cancelled'
    `).get(facilityId, reserveDate, reserveTime);

    if (booked + guests > facility.capacity) {
      const err = new Error(`Bu slot için yeterli yer yok. Kalan: ${facility.capacity - booked}, istenen: ${guests}.`);
      err.statusCode = 409;
      throw err;
    }

    const result = conn.prepare(`
      INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, highchair_count, crypto_signature)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, facilityId, reserveDate, reserveTime, guests, highchairCount, cryptoSignature);

    const bookedAfter = booked + guests;
    return { id: Number(result.lastInsertRowid), booked: bookedAfter, remaining: facility.capacity - bookedAfter };
  });

// --- İSPARK: bağımsız bookable kaynak (atomik compare-and-set) --------------
const getIsparkStatus = (facilityId) =>
  getDb().prepare(
    'SELECT facility_id, capacity, occupied, capacity - occupied AS free FROM ispark_status WHERE facility_id = ?'
  ).get(facilityId) || null;

/**
 * Yer kapma - atomik compare-and-set. Koşul UPDATE'in WHERE'ine gömülüdür:
 * "occupied < capacity" iken +1. Tek statement atomiktir; N eşzamanlı çağrıdan tam
 * (capacity) tanesi başarılı olur, gerisi changes=0 alır (lost-update imkansız, ADR-003).
 */
const takeIsparkSpot = (facilityId) =>
  getDb().prepare(
    "UPDATE ispark_status SET occupied = occupied + 1, updated_at = datetime('now') WHERE facility_id = ? AND occupied < capacity"
  ).run(facilityId).changes === 1;

const releaseIsparkSpot = (facilityId) =>
  getDb().prepare(
    "UPDATE ispark_status SET occupied = occupied - 1, updated_at = datetime('now') WHERE facility_id = ? AND occupied > 0"
  ).run(facilityId).changes === 1;

const getReservationsByUserId = (userId) =>
  getDb().prepare(`
    SELECT r.*, f.ad AS facility_name
    FROM reservations r
    JOIN facilities f ON f.id = r.facility_id
    WHERE r.user_id = ?
    ORDER BY r.reserve_date, r.reserve_time
  `).all(userId);

// --- Menü + Sipariş (Faz v2-05) ---------------------------------------------
const getMenu = (facilityId) =>
  getDb().prepare(
    'SELECT id, facility_id, name, category, price_minor FROM menu_items WHERE facility_id = ? AND is_available = 1 ORDER BY category, name'
  ).all(facilityId);

/**
 * Sipariş oluşturma - TEK atomik transaction (DDIA Böl. 7).
 * - Rezervasyon kullanıcıya ait mi? (sahiplik)
 * - Her kalem AYNI tesisin menüsünden mi?
 * - Fiyat menu_items'tan SNAPSHOT'lanır (captured vs derived, Böl. 11): sonradan menü fiyatı
 *   değişse bile bu siparişin tutarı değişmez.
 * - total sunucuda hesaplanır (istemciye güvenilmez). Yaşam döngüsü: 'submitted' ile başlar;
 *   personel/admin panelinden submitted→served→paid ilerletilir (Faz v2-07, ADR-007).
 */
const createOrder = ({ userId, reservationId, items, paymentType, cryptoSignature }) =>
  transaction((conn) => {
    const reservation = conn.prepare('SELECT id, user_id, facility_id FROM reservations WHERE id = ?').get(reservationId);
    if (!reservation) { const e = new Error('Rezervasyon bulunamadı.'); e.statusCode = 404; throw e; }
    if (reservation.user_id !== userId) { const e = new Error('Bu rezervasyon size ait değil.'); e.statusCode = 403; throw e; }

    // Tesisin menüsünü id->fiyat haritası olarak al (kalemler bu tesise ait olmalı)
    const menu = {};
    for (const m of conn.prepare('SELECT id, price_minor FROM menu_items WHERE facility_id = ? AND is_available = 1').all(reservation.facility_id)) {
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

    const orderRes = conn.prepare(
      "INSERT INTO orders (reservation_id, status, total_minor, crypto_signature, payment_type) VALUES (?, 'submitted', ?, ?, ?)"
    ).run(reservationId, total, cryptoSignature, paymentType);
    const orderId = Number(orderRes.lastInsertRowid);

    const insItem = conn.prepare('INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_minor) VALUES (?, ?, ?, ?)');
    for (const r of resolved) insItem.run(orderId, r.menuItemId, r.quantity, r.unitPrice);

    // Rezervasyon tutarına siparişi ekle (kümülatif harcama)
    conn.prepare('UPDATE reservations SET amount_minor = amount_minor + ? WHERE id = ?').run(total, reservationId);

    return { id: orderId, total_minor: total, status: 'submitted', item_count: resolved.length };
  });

const getOrdersByReservation = (reservationId, userId) => {
  const owns = getDb().prepare('SELECT user_id FROM reservations WHERE id = ?').get(reservationId);
  if (!owns || owns.user_id !== userId) return null; // sahiplik yoksa null
  const orders = getDb().prepare('SELECT * FROM orders WHERE reservation_id = ? ORDER BY created_at DESC').all(reservationId);
  const itemStmt = getDb().prepare(`
    SELECT oi.quantity, oi.unit_price_minor, m.name, m.category
    FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id WHERE oi.order_id = ?
  `);
  return orders.map(o => ({ ...o, items: itemStmt.all(o.id) }));
};

// --- Sipariş durum makinesi (Faz v2-07, ADR-007) -----------------------------
// Yalnız bu geçişlere izin verilir (DDIA state-machine disiplini: geçersiz sıçrama
// yasak, örn. submitted'dan doğrudan paid'e atlanamaz - served aşaması atlanamaz).
const ORDER_TRANSITIONS = {
  submitted: ['served', 'cancelled'],
  served: ['paid', 'cancelled']
};

const updateOrderStatus = (orderId, newStatus, actorUserId) =>
  transaction((conn) => {
    const order = conn.prepare('SELECT id, status FROM orders WHERE id = ?').get(orderId);
    if (!order) { const e = new Error('Sipariş bulunamadı.'); e.statusCode = 404; throw e; }
    const allowed = ORDER_TRANSITIONS[order.status] || [];
    if (!allowed.includes(newStatus)) {
      const e = new Error(`Geçersiz durum geçişi: '${order.status}' → '${newStatus}'.`);
      e.statusCode = 409;
      throw e;
    }
    conn.prepare('UPDATE orders SET status = ? WHERE id = ?').run(newStatus, orderId);
    logAudit(conn, actorUserId, 'order.status_change', 'order', orderId, { from: order.status, to: newStatus });
    return { id: orderId, status: newStatus };
  });

// --- Admin gözetim (requireAdmin uçlarınca kullanılır; sahiplik filtresi YOK) -
const getAllReservations = (facilityId) =>
  getDb().prepare(`
    SELECT r.*, f.ad AS facility_name, u.username AS owner_username
    FROM reservations r
    JOIN facilities f ON f.id = r.facility_id
    JOIN users u ON u.id = r.user_id
    ${facilityId ? 'WHERE r.facility_id = ?' : ''}
    ORDER BY r.reserve_date DESC, r.reserve_time DESC
  `).all(...(facilityId ? [facilityId] : []));

const getAllOrders = (facilityId) =>
  getDb().prepare(`
    SELECT o.*, r.facility_id, f.ad AS facility_name, u.username AS owner_username
    FROM orders o
    JOIN reservations r ON r.id = o.reservation_id
    JOIN facilities f ON f.id = r.facility_id
    JOIN users u ON u.id = r.user_id
    ${facilityId ? 'WHERE r.facility_id = ?' : ''}
    ORDER BY o.created_at DESC
  `).all(...(facilityId ? [facilityId] : []));

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
