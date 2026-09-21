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
// Yazma operasyonları - "yeni veriler" artık kalıcı olarak tek yerde tutulur.
// ---------------------------------------------------------------------------
const createFacility = ({ kod, ad, adres, lat, lng, capacity, occupancy, iett_info, vapur_info, transit_transfer, route_description }) => {
  const result = getDb().prepare(`
    INSERT INTO facilities (kod, ad, adres, lat, lng, capacity, occupancy, iett_info, vapur_info, transit_transfer, route_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    kod, ad, adres || null, lat, lng, capacity, occupancy || 0,
    iett_info || 'Mevcut Değil', vapur_info || 'Mevcut Değil',
    transit_transfer || 'Mevcut Değil', route_description || 'Mevcut Değil'
  );
  return getFacilityById(Number(result.lastInsertRowid));
};

const updateFacilityOccupancy = (id, occupancy) => {
  const result = getDb().prepare(
    "UPDATE facilities SET occupancy = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(occupancy, id);
  if (result.changes === 0) return null;
  return getFacilityById(id);
};

const deleteFacility = (id) =>
  // Rezervasyonlar ON DELETE CASCADE ile otomatik temizlenir (referans bütünlüğü DB'de).
  getDb().prepare('DELETE FROM facilities WHERE id = ?').run(id).changes > 0;

const getUserByUsername = (username) =>
  getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) || null;

const createUser = (username, passwordRaw, role = 'user') => {
  const result = getDb().prepare(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?)'
  ).run(username, hashPassword(passwordRaw), role);
  return { id: Number(result.lastInsertRowid), username, role };
};

/**
 * Rezervasyon oluşturma: kapasite kontrolü + doluluk güncellemesi + kayıt eklemesi
 * TEK atomik transaction'dır (DDIA Bölüm 7). Aradaki herhangi bir adım başarısız
 * olursa (örn. UNIQUE ihlali = çifte rezervasyon) tamamı geri alınır; doluluk oranı
 * ile rezervasyon kayıtları asla birbirinden koparılamaz.
 */
const createReservation = ({ userId, facilityId, reserveDate, reserveTime, guests, cryptoSignature }) =>
  transaction((conn) => {
    const facility = conn.prepare('SELECT capacity, occupancy FROM facilities WHERE id = ?').get(facilityId);
    if (!facility) {
      const err = new Error('Tesis bulunamadı.');
      err.statusCode = 404;
      throw err;
    }

    const currentOccupied = Math.round(facility.capacity * (facility.occupancy / 100));
    if (currentOccupied + guests > facility.capacity) {
      const err = new Error('Tesis kapasitesi yetersiz. Yer kalmadı.');
      err.statusCode = 409;
      throw err;
    }

    const newOccupancy = Math.min(100, Math.round(((currentOccupied + guests) / facility.capacity) * 100));
    conn.prepare("UPDATE facilities SET occupancy = ?, updated_at = datetime('now') WHERE id = ?")
      .run(newOccupancy, facilityId);

    const result = conn.prepare(`
      INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, facilityId, reserveDate, reserveTime, guests, cryptoSignature);

    return { id: Number(result.lastInsertRowid), newOccupancy };
  });

const getReservationsByUserId = (userId) =>
  getDb().prepare(`
    SELECT r.*, f.ad AS facility_name
    FROM reservations r
    JOIN facilities f ON f.id = r.facility_id
    WHERE r.user_id = ?
    ORDER BY r.reserve_date, r.reserve_time
  `).all(userId);

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
  getReservationsByUserId
};
