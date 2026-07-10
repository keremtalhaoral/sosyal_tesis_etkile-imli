-- =============================================================================
-- schema.sql — TÜRETİLMİŞ (derived) veritabanı şeması / DERIVED database schema
-- =============================================================================
-- Bu dosya ELLE DÜZENLENMEZ. Kanonik kaynak:
--   * Yapı  : backend/database.js  (MIGRATIONS dizisi) + advanced-gis/app/models.py (senkron)
--   * Veri  : data/seed.json  (kanonik başlangıç verisi)
-- Yeniden üretmek için:  node scripts/export-schema.js
-- Uygulanmış migration sürümleri: 1, 2, 3, 4, 5, 6
-- Üretim zamanı: 2026-07-10T12:26:45.344Z
-- Tam veri dökümü (yapı + satırlar) için:  sqlite3 data/app.db .dump > data/full.sql
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_user_id INTEGER NOT NULL REFERENCES users(id),
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id INTEGER NOT NULL,
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

CREATE TABLE daily_stats (
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

CREATE TABLE districts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          population INTEGER NOT NULL CHECK (population >= 0)
        );

CREATE TABLE facilities (
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

CREATE TABLE ispark_status (
          facility_id INTEGER PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
          capacity INTEGER NOT NULL CHECK (capacity > 0),
          occupied INTEGER NOT NULL DEFAULT 0 CHECK (occupied >= 0 AND occupied <= capacity),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

CREATE TABLE menu_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Genel',
          price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
          is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (facility_id, name)
        );

CREATE TABLE order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0)
        );

CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open', 'submitted', 'served', 'paid', 'cancelled')),
          total_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
          crypto_signature TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        , payment_type TEXT
          CHECK (payment_type IN ('cash', 'card', 'online')));

CREATE TABLE reservations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
          reserve_date TEXT NOT NULL,
          reserve_time TEXT NOT NULL,
          guests INTEGER NOT NULL CHECK (guests > 0),
          crypto_signature TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'confirmed'
          CHECK (status IN ('pending', 'confirmed', 'cancelled')), amount_minor INTEGER NOT NULL DEFAULT 0
          CHECK (amount_minor >= 0), payment_type TEXT
          CHECK (payment_type IN ('cash', 'card', 'online')), highchair_count INTEGER NOT NULL DEFAULT 0
          CHECK (highchair_count >= 0),
          UNIQUE (user_id, facility_id, reserve_date, reserve_time)
        );

CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);

CREATE INDEX idx_menu_items_facility ON menu_items(facility_id);

CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE INDEX idx_orders_reservation ON orders(reservation_id);

CREATE INDEX idx_reservations_date ON reservations(reserve_date);

CREATE INDEX idx_reservations_facility_date ON reservations(facility_id, reserve_date);

CREATE INDEX idx_reservations_slot
          ON reservations(facility_id, reserve_date, reserve_time);

CREATE INDEX idx_reservations_user ON reservations(user_id);
