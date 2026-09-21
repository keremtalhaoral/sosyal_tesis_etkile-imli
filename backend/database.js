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
// Yerel dev parolaları DB dosyasının yanında yaşar (gitignored). Testte geçici dizine düşer.
const CREDENTIALS_PATH = path.join(path.dirname(DB_PATH), 'dev-credentials.json');

// Ayrık zaman slotları - kanonik kaynak data/seed.json (slots). Rezervasyon bu kümeden olmalı.
let SLOTS = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00', '20:30'];
try {
  const s = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  if (Array.isArray(s.slots) && s.slots.length) SLOTS = s.slots;
} catch { /* seed yoksa varsayılan slotlar */ }

// -------------------------------------------------------------------------
// Parola hash'i - PHC (Password Hashing Competition) string formatı:
//   pbkdf2_sha256$<iterasyon>$<salt_b64>$<hash_b64>
// Django ile aynı biçim. Python (crypto_signer.py) ile ÇAPRAZ-UYUMLU: bir tarafın
// ürettiği stringi diğeri doğrular. Her kullanıcıya AYRI rastgele salt (ADR-002 Karar 1).
// -------------------------------------------------------------------------
const PBKDF2_ITERATIONS = 600000; // OWASP 2023 önerisi (SHA-256)
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
};

// Sabit-zamanlı doğrulama (timing attack'a karşı). Stored = PHC string.
const verifyPassword = (password, stored) => {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    const actual = crypto.pbkdf2Sync(String(password), salt, iterations, expected.length, PBKDF2_DIGEST);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

// Güçlü rastgele parola (base64url, ~16 karakter). Seed'de ham parola tutmayız.
const generatePassword = () => crypto.randomBytes(12).toString('base64url');

// Dev parolalarını yükle/oluştur (gitignored dosya). Node ve Python aynı dosyayı paylaşır:
// hangi servis önce tohumlarsa parolayı üretir, diğeri aynı açık metni okur → login her iki
// serviste de çalışır (DB'de sadece ilk servisin hash'i durur, INSERT OR IGNORE).
const loadOrCreateCredentials = (users) => {
  let store = { _comment: 'YEREL dev parolaları - git\'e girmez. Silerseniz app.db\'yi de silip yeniden tohumlayın.', users: {} };
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try { store = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8')); store.users = store.users || {}; } catch { /* bozuksa yeniden üret */ }
  }
  let changed = false;
  for (const u of users) {
    if (!store.users[u.username]) { store.users[u.username] = generatePassword(); changed = true; }
  }
  if (changed) {
    store.generated_at = new Date().toISOString();
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(store, null, 2) + '\n');
    console.log(`[db] Dev parolaları üretildi/güncellendi: ${CREDENTIALS_PATH}`);
  }
  return store.users;
};

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
  },
  {
    // Migration v2 (Faz v2-01: Veri Modeli) - sipariş/menü altyapısı + rezervasyon zenginleştirme.
    // Tasarım kararları ve gerekçeleri: docs/adr/ADR-001-veri-modeli.md
    version: 2,
    up: (db) => {
      // --- reservations zenginleştirme -------------------------------------
      // Not: SQLite ADD COLUMN yalnızca SABİT DEFAULT + CHECK destekler (UNIQUE/PK ekleyemez).
      // Para her yerde TAM SAYI KURUŞ olarak tutulur (float yuvarlama hatasından kaçınmak için).
      db.exec(`
        ALTER TABLE reservations ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'
          CHECK (status IN ('pending', 'confirmed', 'cancelled'));
        ALTER TABLE reservations ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0
          CHECK (amount_minor >= 0);
        ALTER TABLE reservations ADD COLUMN payment_type TEXT
          CHECK (payment_type IN ('cash', 'card', 'online'));
        ALTER TABLE reservations ADD COLUMN highchair_count INTEGER NOT NULL DEFAULT 0
          CHECK (highchair_count >= 0);
      `);

      // --- menu_items: tesise ait menü kalemleri ---------------------------
      // price_minor = kuruş. Menü zamanla değişebilir; siparişteki fiyat snapshot'ı
      // order_items.unit_price_minor'da saklanır (bkz. ADR-001, derived vs captured).
      db.exec(`
        CREATE TABLE IF NOT EXISTS menu_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Genel',
          price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
          is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (facility_id, name)
        );

        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open', 'submitted', 'served', 'paid', 'cancelled')),
          total_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
          crypto_signature TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0)
        );

        CREATE INDEX IF NOT EXISTS idx_menu_items_facility ON menu_items(facility_id);
        CREATE INDEX IF NOT EXISTS idx_orders_reservation ON orders(reservation_id);
        CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
      `);
    }
  },
  {
    // Migration v3 (Faz v2-03: Veri Bütünlüğü & Eşzamanlılık).
    // Gerekçeler: docs/adr/ADR-003-eszamanlilik.md
    version: 3,
    up: (db) => {
      // İSPARK bağımsız bookable kaynak. occupied <= capacity CHECK'i aşırı doluluğu
      // DB seviyesinde imkansız kılar (uygulama hatası olsa bile son savunma hattı).
      db.exec(`
        CREATE TABLE IF NOT EXISTS ispark_status (
          facility_id INTEGER PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
          capacity INTEGER NOT NULL CHECK (capacity > 0),
          occupied INTEGER NOT NULL DEFAULT 0 CHECK (occupied >= 0 AND occupied <= capacity),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Slot kapasite sorgusu (SUM(guests) per facility+date+time) için bileşik indeks.
        CREATE INDEX IF NOT EXISTS idx_reservations_slot
          ON reservations(facility_id, reserve_date, reserve_time);
      `);
    }
  },
  {
    // Migration v4 (Faz v2-04: Analytics). daily_stats = gün×tesis ROLLUP (türetilmiş veri).
    // Kaynaktan yeniden hesaplanır (analytics.rebuildDailyStats). Gerekçe: docs/adr/ADR-004-analytics.md
    version: 4,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_stats (
          stat_date TEXT NOT NULL,
          facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
          revenue_minor INTEGER NOT NULL DEFAULT 0,
          reservation_count INTEGER NOT NULL DEFAULT 0,
          guest_count INTEGER NOT NULL DEFAULT 0,
          highchair_count INTEGER NOT NULL DEFAULT 0,
          cancelled_count INTEGER NOT NULL DEFAULT 0,
          order_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (stat_date, facility_id)
        );
        CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(reserve_date);
      `);
    }
  },
  {
    // Migration v5 (Faz v2-05: Sipariş akışı). Siparişin ödeme yöntemi.
    // Gerekçe: docs/adr/ADR-005-siparis.md
    version: 5,
    up: (db) => {
      db.exec(`
        ALTER TABLE orders ADD COLUMN payment_type TEXT
          CHECK (payment_type IN ('cash', 'card', 'online'));
      `);
    }
  },
  {
    // Migration v6 (Faz v2-07: Admin Paneli). audit_log = APPEND-ONLY olay kaydı (yalnız INSERT;
    // UPDATE/DELETE yok — DDIA Böl. 11, gerçekleşmiş olaylar değişmez). Şema docs/diagrams/
    // er-v2.md'de önceden tasarlanmıştı. Gerekçe: docs/adr/ADR-007-admin-yonetim.md
    version: 6,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_user_id INTEGER NOT NULL REFERENCES users(id),
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id INTEGER NOT NULL,
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
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
    // Ham parola artık seed'de YOK. Güçlü rastgele parola üretip gitignored dosyaya yazar,
    // DB'ye sadece hash'i koyarız (ADR-002 Karar 4).
    const seedUsers = seed.users || [];
    const credentials = loadOrCreateCredentials(seedUsers);
    const insertUser = conn.prepare(
      'INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)'
    );
    for (const u of seedUsers) {
      insertUser.run(u.username, hashPassword(credentials[u.username]), u.role);
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

    // Menü: tek şablon her tesise uygulanır (DRY). UNIQUE(facility_id, name) + IGNORE = idempotent.
    if (Array.isArray(seed.menu_template) && seed.menu_template.length) {
      const facilityIds = conn.prepare('SELECT id FROM facilities').all().map(r => r.id);
      const insertMenuItem = conn.prepare(
        'INSERT OR IGNORE INTO menu_items (facility_id, name, category, price_minor) VALUES (?, ?, ?, ?)'
      );
      for (const fid of facilityIds) {
        for (const m of seed.menu_template) {
          insertMenuItem.run(fid, m.name, m.category || 'Genel', m.price_minor);
        }
      }
    }

    // İSPARK kapasitesi: tesis kapasitesine ORANTILI (gerçekçi), seed.ispark ile ayarlanır.
    const isparkCfg = seed.ispark || { capacity_divisor: 5, min_capacity: 10 };
    const insertIspark = conn.prepare(
      'INSERT OR IGNORE INTO ispark_status (facility_id, capacity, occupied) VALUES (?, ?, 0)'
    );
    for (const f of conn.prepare('SELECT id, capacity FROM facilities').all()) {
      const parkCap = Math.max(isparkCfg.min_capacity, Math.round(f.capacity / isparkCfg.capacity_divisor));
      insertIspark.run(f.id, parkCap);
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

module.exports = { getDb, transaction, hashPassword, verifyPassword, SLOTS, DB_PATH };
