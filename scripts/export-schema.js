/**
 * export-schema.js — app.db şemasını okunur bir schema.sql dosyasına döker.
 *
 * NEDEN VAR: SQLite verisini tek binary dosyada (data/app.db) tutar; ayrı bir .sql dosyası
 * zorunlu değildir. Bu projede şemanın KANONİK kaynağı backend/database.js MIGRATIONS dizisidir
 * (advanced-gis/app/models.py ile senkron). Ancak SQL şemasını tek bakışta okumak (DBeaver'a almak,
 * inceleme, mentöre gösterme) için düz metin bir DDL çıktısı pratiktir.
 *
 * schema.sql bu yüzden TÜRETİLMİŞ (derived) bir DOKÜMANDIR: elle düzenlenmez, migration'lardan
 * üretilir. Şema değişince bu script yeniden çalıştırılır (bkz. CLAUDE.md > Sözleşmeler).
 * Veri değil yalnız YAPI döker; runtime verisi için: sqlite3 data/app.db .dump > data/full.sql
 *
 * Kullanım:  node scripts/export-schema.js   (app.db önce tohumlanmış olmalı)
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');
const OUT_PATH = path.join(__dirname, '..', 'schema.sql');

if (!fs.existsSync(DB_PATH)) {
  console.error(`HATA: app.db bulunamadı → ${DB_PATH}`);
  console.error('Önce veritabanını tohumla:  cd backend && npm install && npm start  (Ctrl+C ile durdur)');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);

// sqlite_master: tablo/index/view/trigger DDL'lerini SQLite'ın sakladığı normalize biçimde verir.
const objects = db.prepare(`
  SELECT type, name, sql FROM sqlite_master
  WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name
`).all();

const appliedVersions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
  .map(r => r.version).join(', ');

const header =
`-- =============================================================================
-- schema.sql — TÜRETİLMİŞ (derived) veritabanı şeması / DERIVED database schema
-- =============================================================================
-- Bu dosya ELLE DÜZENLENMEZ. Kanonik kaynak:
--   * Yapı  : backend/database.js  (MIGRATIONS dizisi) + advanced-gis/app/models.py (senkron)
--   * Veri  : data/seed.json  (kanonik başlangıç verisi)
-- Yeniden üretmek için:  node scripts/export-schema.js
-- Uygulanmış migration sürümleri: ${appliedVersions}
-- Üretim zamanı: ${new Date().toISOString()}
-- Tam veri dökümü (yapı + satırlar) için:  sqlite3 data/app.db .dump > data/full.sql
-- =============================================================================

PRAGMA foreign_keys = ON;

`;

const body = objects.map(o => `${o.sql.trim()};`).join('\n\n') + '\n';
fs.writeFileSync(OUT_PATH, header + body, 'utf8');
db.close();

const counts = objects.reduce((m, o) => (m[o.type] = (m[o.type] || 0) + 1, m), {});
console.log(`Yazıldı: ${OUT_PATH}`);
console.log(`  ${objects.length} nesne (` + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') + ')');
