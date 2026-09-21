/**
 * database.js - Merkezi SQLite Veri Katmanı (Single Source of Truth)
 *
 * TASARIM GEREKÇESİ (DDIA - Designing Data-Intensive Applications):
 * 1. Tek Gerçek Kaynak (Bölüm 11 - Derived Data): Tesis, kullanıcı ve rezervasyon verisi daha önce
 *    üç ayrı yerde yaşıyordu (backend/db.js içinde gömülü JS sabitleri, advanced-gis'in kendi SQLite'ı,
 *    docs/ localStorage mock'u). Bu modül repo kökündeki data/app.db dosyasını tek otorite yapar;
 *    diğer temsiller türetilmiş veridir. Çift-yazma (dual write) tutarsızlıkları böylece kökten kalkar.
 * 2. Güvenilirlik & Dayanıklılık (Bölüm 7 - Transactions): WAL modu + senkron commit ile süreç
 *    çökse bile onaylanmış yazmalar kaybolmaz. Çok adımlı yazmalar (rezervasyon + doluluk güncellemesi)
 *    tek atomik transaction içinde yürür.
 * 3. Yazma-Anında Şema (Bölüm 4 - Encoding and Evolution): Şema, versiyonlu migration'larla evrilir
 *    (schema_migrations tablosu). CHECK / UNIQUE / FOREIGN KEY kısıtları geçersiz durumları
 *    veritabanı seviyesinde imkansız kılar - uygulama koduna güvenmek yerine.
 * 4. İndeksler (Bölüm 3 - Storage and Retrieval): Sorgu desenlerine göre ikincil B-tree indeksleri
 *    tanımlanır (rezervasyon -> kullanıcı/tesis+tarih, kullanıcı adı, tesis kodu).
 * 5. Neden SQLite: Bu ölçekte (tek düğüm, düşük yazma hacmi) sunucusuz, ACID garantili gömülü bir
 *    veritabanı en doğru araçtır; Node 22'nin yerleşik node:sqlite modülü dış bağımlılık gerektirmez.
 *    İleride PostgreSQL + PostGIS'e geçiş yolu DATABASE.md'de belgelenmiştir.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Tek veritabanı dosyası repo kökündeki data/ altında yaşar; Node ve Python servisleri paylaşır.
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');
const SEED_PATH = path.join(DATA_DIR, 'seed.json');

// Python tarafındaki security/crypto_signer.py ile bit-uyumlu parola hash'i:
// pbkdf2_hmac('sha256', parola, SALT, 100000) -> hex. Aynı kullanıcı tablosunu iki servis paylaşır.
const PASSWORD_SALT = Buffer.from('mufettis_salt_value_2026');
const hashPassword = (password) =>
  crypto.pbkdf2Sync(String(password), PASSWORD_SALT, 100000, 32, 'sha256').toString('hex');

const MIGRATIONS = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS facilities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kod TEXT UNIQUE NOT NULL,
          ad TEXT NOT NULL,
          adres TEXT,
          lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
          lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
          capacity INTEGER NOT NULL CHECK (capacity > 0),
          occupancy INTEGER NOT NULL DEFAULT 0 CHECK (occupancy BETWEEN 0 AND 100),
          iett_info TEXT NOT NULL DEFAULT 'Mevcut Değil',
          vapur_info TEXT NOT NULL DEFAULT 'Mevcut Değil',
          transit_transfer TEXT NOT NULL DEFAULT 'Mevcut Değil',
          route_description TEXT NOT NULL DEFAULT 'Mevcut Değil',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS reservations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
          reserve_date TEXT NOT NULL,
          reserve_time TEXT NOT NULL,
          guests INTEGER NOT NULL CHECK (guests > 0),
          crypto_signature TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, facility_id, reserve_date, reserve_time)
        );

        CREATE TABLE IF NOT EXISTS districts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          population INTEGER NOT NULL CHECK (population >= 0)
        );

        CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
        CREATE INDEX IF NOT EXISTS idx_reservations_facility_date ON reservations(facility_id, reserve_date);
      `);
    }
  }
];

let db = null;

const openDatabase = () => {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new DatabaseSync(DB_PATH);
  // WAL: okuyucular yazıcıyı bloklamaz, çökme sonrası log'dan kurtarma (DDIA Bölüm 3 & 7).
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA foreign_keys = ON');
  conn.exec('PRAGMA busy_timeout = 5000');
  return conn;
};

const runMigrations = (conn) => {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const appliedRow = conn.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  const applied = appliedRow && appliedRow.v ? appliedRow.v : 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= applied) continue;
    conn.exec('BEGIN');
    try {
      migration.up(conn);
      conn.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
      conn.exec('COMMIT');
      console.log(`[db] Migration v${migration.version} uygulandı.`);
    } catch (err) {
      conn.exec('ROLLBACK');
      throw err;
    }
  }
};

// Idempotent seed: INSERT OR IGNORE sayesinde tekrar çalıştırmak güvenlidir (fault tolerance).
const seedDatabase = (conn) => {
  if (!fs.existsSync(SEED_PATH)) {
    console.warn(`[db] Seed dosyası bulunamadı: ${SEED_PATH} - boş veritabanıyla devam ediliyor.`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

  conn.exec('BEGIN');
  try {
    const insertUser = conn.prepare(
      'INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)'
    );
    for (const u of seed.users || []) {
      insertUser.run(u.username, hashPassword(u.password_raw), u.role);
    }

    const insertDistrict = conn.prepare(
      'INSERT OR IGNORE INTO districts (name, population) VALUES (?, ?)'
    );
    for (const d of seed.districts || []) {
      insertDistrict.run(d.name, d.population);
    }

    const insertFacility = conn.prepare(`
      INSERT OR IGNORE INTO facilities
        (id, kod, ad, adres, lat, lng, capacity, occupancy, iett_info, vapur_info, transit_transfer, route_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const f of seed.facilities || []) {
      insertFacility.run(
        f.id, f.kod, f.ad, f.adres || null, f.lat, f.lng, f.capacity, f.occupancy,
        f.iett_info || 'Mevcut Değil', f.vapur_info || 'Mevcut Değil',
        f.transit_transfer || 'Mevcut Değil', f.route_description || 'Mevcut Değil'
      );
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
};

const getDb = () => {
  if (!db) {
    db = openDatabase();
    runMigrations(db);
    seedDatabase(db);
  }
  return db;
};

// Çok adımlı yazmalar için atomik transaction yardımcısı (DDIA Bölüm 7: ya hep ya hiç).
const transaction = (fn) => {
  const conn = getDb();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
};

module.exports = { getDb, transaction, hashPassword, DB_PATH };
