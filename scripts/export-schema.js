#!/usr/bin/env node
/**
 * export-schema.js — canlı PostgreSQL şemasını okunur bir schema.sql dosyasına döker.
 *
 * NEDEN VAR: şemanın KANONİK kaynağı backend/database.js MIGRATIONS dizisidir. Ancak SQL
 * şemasını tek bakışta okumak (DBeaver'a almak, inceleme, mentöre gösterme) için düz metin
 * bir DDL çıktısı pratiktir.
 *
 * schema.sql bu yüzden TÜRETİLMİŞ (derived) bir DOKÜMANDIR: elle düzenlenmez, veritabanının
 * KENDİSİNDEN üretilir. Şema değişince bu script yeniden çalıştırılır (bkz. CLAUDE.md).
 * Veri değil yalnız YAPI döker; tam döküm için: pg_dump.
 *
 * pg_dump'a değil information_schema/pg_catalog'a dayanır: pg_dump her ortamda kurulu
 * olmayabilir, ayrıca çıktısı gürültülü (SET komutları, OWNER, ACL). Burada yalnız
 * anlatmak istediğimiz şeyi üretiyoruz: tablolar, kolonlar, kısıtlar, indeksler.
 *
 * Kullanım:  node scripts/export-schema.js
 */
const fs = require('fs');
const path = require('path');
const { db, init, close } = require('../backend/database');

const OUT_PATH = path.join(__dirname, '..', 'schema.sql');
const SCHEMA = process.env.PG_SCHEMA || 'public';

(async () => {
  await init();
  const conn = db();

  const versions = (await conn.all('SELECT version FROM schema_migrations ORDER BY version')).map(r => r.version);

  const tables = (await conn.all(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('spatial_ref_sys')
    ORDER BY table_name
  `, [SCHEMA])).map(r => r.table_name);

  const parts = [];

  for (const table of tables) {
    const cols = await conn.all(`
      SELECT column_name, data_type, udt_name, character_maximum_length, numeric_precision,
             is_nullable, column_default, is_identity, identity_generation, is_generated, generation_expression
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `, [SCHEMA, table]);

    const lines = cols.map((c) => {
      // PostGIS geometry kolonları information_schema'da 'USER-DEFINED' görünür; gerçek
      // tipi (geometry(Point,4326)) format_type ile ayrıca çekiliyor (aşağıda).
      let type = c.data_type === 'USER-DEFINED' ? c.udt_name : c.data_type;
      if (c.character_maximum_length) type += `(${c.character_maximum_length})`;

      let line = `  ${c.column_name} ${type}`;
      if (c.is_identity === 'YES') line += ` GENERATED ${c.identity_generation} AS IDENTITY`;
      else if (c.is_generated === 'ALWAYS') line += ` GENERATED ALWAYS AS (${c.generation_expression}) STORED`;
      else if (c.column_default) line += ` DEFAULT ${c.column_default}`;
      if (c.is_nullable === 'NO') line += ' NOT NULL';
      return line;
    });

    // Kısıtlar (PK / UNIQUE / FK / CHECK) - pg_get_constraintdef okunur DDL verir.
    const constraints = await conn.all(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = format('%I.%I', $1::text, $2::text)::regclass
      ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 ELSE 3 END, conname
    `, [SCHEMA, table]);
    for (const c of constraints) lines.push(`  CONSTRAINT ${c.conname} ${c.def}`);

    parts.push(`CREATE TABLE ${table} (\n${lines.join(',\n')}\n);`);

    const indexes = await conn.all(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = $1 AND tablename = $2
        AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid = format('%I.%I', $1::text, $2::text)::regclass)
      ORDER BY indexname
    `, [SCHEMA, table]);
    for (const i of indexes) parts.push(`${i.indexdef};`);
  }

  const postgis = await conn.one("SELECT extversion FROM pg_extension WHERE extname = 'postgis'");
  const pgver = (await conn.one('SELECT version() AS v')).v.split(' ').slice(0, 2).join(' ');

  const header = `-- =============================================================================
-- schema.sql — TÜRETİLMİŞ (derived) veritabanı şeması / DERIVED database schema
-- =============================================================================
-- Bu dosya ELLE DÜZENLENMEZ. Kanonik kaynak:
--   * Yapı  : backend/database.js  (MIGRATIONS dizisi)
--   * Veri  : data/seed.json  (kanonik başlangıç verisi)
-- Yeniden üretmek için:  node scripts/export-schema.js
--
-- Veritabanı: ${pgver}${postgis ? ` + PostGIS ${postgis.extversion}` : ''}
-- Uygulanmış migration sürümleri: ${versions.join(', ')}
-- Üretim zamanı: ${new Date().toISOString()}
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

`;

  fs.writeFileSync(OUT_PATH, header + parts.join('\n\n') + '\n', 'utf8');
  console.log(`Yazıldı: ${OUT_PATH}`);
  console.log(`  ${tables.length} tablo, ${parts.length - tables.length} indeks (migration v${versions[versions.length - 1]})`);

  await close();
})().catch(async (err) => {
  console.error('HATA:', err.message);
  await close().catch(() => {});
  process.exit(1);
});
