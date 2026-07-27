/**
 * database.js - Merkezi PostgreSQL + PostGIS DEPOLAMA katmanı (Single Source of Truth)
 *
 * SORUMLULUK SINIRI: Bu dosya = düşük seviye depolama (havuz/bağlantı, migration+seed,
 * transaction(), parola hash'i). Üstündeki repository + mekansal katman db.js'tedir.
 *
 * TASARIM GEREKÇESİ (DDIA - Designing Data-Intensive Applications):
 * 1. Tek Gerçek Kaynak (Bölüm 11 - Derived Data): Tesis, kullanıcı, rezervasyon verisi tek
 *    yerde yaşar; diğer temsiller (Pages localStorage replikası, analytics.json snapshot)
 *    türetilmiş veridir. Çift-yazma tutarsızlığı kökten kalkar.
 * 2. Güvenilirlik & Dayanıklılık (Bölüm 7 - Transactions): PostgreSQL WAL + fsync ile
 *    onaylanmış yazmalar çökme sonrası kaybolmaz. Çok adımlı yazmalar tek atomik
 *    transaction içinde yürür.
 * 3. Yazma-Anında Şema (Bölüm 4 - Encoding and Evolution): Şema versiyonlu migration'larla
 *    evrilir (schema_migrations). CHECK/UNIQUE/FOREIGN KEY kısıtları geçersiz durumları
 *    veritabanı seviyesinde imkansız kılar.
 * 4. İndeksler (Bölüm 3): Sorgu desenlerine göre B-tree; geometri için GiST.
 * 5. NEDEN ARTIK PostgreSQL (SQLite değil) - bkz. docs/adr/ADR-009-postgresql-postgis.md:
 *    - GERÇEK mekansal sorgu: ilçe/tesis geometrisi PostGIS'te yaşar; ST_Contains, ST_DWithin
 *      ve KNN (<->) veritabanında koşar. SQLite'ta bunlar JS'te elle yazılmıştı.
 *    - GERÇEK eşzamanlılık: SQLite tek yazıcıya zorlar (BEGIN IMMEDIATE herkesi serileştirir).
 *      PostgreSQL çok yazıcılıdır - bu YENİ bir tehlike getirir (write-skew), aşağıda
 *      SERIALIZABLE ile kapatılır.
 *    Bedeli: 'pg' dış bağımlılığı ve çalışan bir sunucu. Bilinçli takas (ADR-009).
 */

const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Tip ayrıştırıcıları - pg'nin varsayılanları API sözleşmesini bozardı, düzeltiyoruz.
// ---------------------------------------------------------------------------
// int8 (COUNT/SUM sonuçları) varsayılan olarak STRING döner (JS Number 2^53'ü aşabilir
// diye). Bizim ölçeğimizde taşma yok ama string dönerse tüm analitik toplama
// "10"+"5"="105" olur. Sayıya çeviriyoruz.
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
// date -> 'YYYY-MM-DD' (JS Date DEĞİL): frontend sözleşmesi düz string bekliyor ve Date'e
// çevirmek yerel saat dilimine göre günü kaydırabilir (klasik off-by-one hatası).
types.setTypeParser(types.builtins.DATE, (v) => v);
// time -> 'HH:MM' (pg 'HH:MM:SS' döner). Slotlar '19:00' biçiminde tanımlı.
types.setTypeParser(types.builtins.TIME, (v) => (v ? String(v).slice(0, 5) : v));

// ---------------------------------------------------------------------------
// Bağlantı yapılandırması
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, '..', 'data');
// SEED_FILE ile başka bir seed dosyası seçilebilir (sunum için data/seed-demo.json).
// Seed her açılışta çalıştığı için bu ŞART: aksi halde demo şemasından silinen tesisler
// sunucu her yeniden başladığında geri gelirdi (yaşandı).
const SEED_PATH = process.env.SEED_FILE
  ? path.resolve(process.cwd(), process.env.SEED_FILE)
  : path.join(DATA_DIR, 'seed.json');
// Yerel dev parolaları (gitignored). Testte DEV_CREDENTIALS_PATH ile geçici dizine yönlenir.
const CREDENTIALS_PATH = process.env.DEV_CREDENTIALS_PATH || path.join(DATA_DIR, 'dev-credentials.json');

const DATABASE_URL = process.env.DATABASE_URL
  || `postgres://${process.env.PGUSER || 'mufettis'}:${process.env.PGPASSWORD || 'mufettis-dev'}`
   + `@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'mufettis'}`;

// Ayrık zaman slotları - kanonik kaynak data/seed.json (slots).
let SLOTS = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00', '20:30'];
try {
  const s = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  if (Array.isArray(s.slots) && s.slots.length) SLOTS = s.slots;
} catch { /* seed yoksa varsayılan slotlar */ }

// -------------------------------------------------------------------------
// Parola hash'i - PHC (Password Hashing Competition) string formatı:
//   pbkdf2_sha256$<iterasyon>$<salt_b64>$<hash_b64>
// Django ile aynı biçim. Her kullanıcıya AYRI rastgele salt (ADR-002 Karar 1).
// -------------------------------------------------------------------------
const PBKDF2_ITERATIONS = 600000; // OWASP 2023 önerisi (SHA-256)
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

// PHC stringini parçalara ayır. Bozuksa null (çağıran sahte doğrulamaya düşer).
const parsePhc = (stored) => {
  const parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return null;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations <= 0) return null;
  return { iterations, salt: Buffer.from(parts[2], 'base64'), expected: Buffer.from(parts[3], 'base64') };
};

/**
 * DUMMY_PHC - kullanıcı BULUNAMADIĞINDA doğrulanacak sahte hash.
 *
 * NEDEN ÖNEMLİ: bir saldırgan "kullanıcı adı var mı?" sorusunu yanıt SÜRESİNDEN okuyabilir.
 * Bunu engellemenin tek yolu, kullanıcı yokken de VARMIŞ KADAR iş yapmaktır. Kritik olan
 * alan iterasyon sayısıdır - salt/hash içeriği önemsizdir (nasıl olsa eşleşmeyecek), çünkü
 * harcanan CPU zamanını yalnız iterasyon belirler. Bu yüzden PBKDF2_ITERATIONS'tan türetilir:
 * iterasyon ayarı değişirse sahte hash de otomatik takip eder, ikisi asla ayrışamaz.
 */
const DUMMY_PHC = `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(PBKDF2_KEYLEN).toString('base64')}`;

const buildPhc = (salt, hash) =>
  `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;

// --- Senkron sürümler: seed / CLI scriptleri içindir (tek seferlik, bloklaması sorun değil).
// HTTP yolunda ASLA kullanma - 600k iterasyon tek thread'i ~100ms dondurur.
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16);
  return buildPhc(salt, crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST));
};

const verifyPassword = (password, stored) => {
  try {
    const p = parsePhc(stored);
    if (!p) return false;
    const actual = crypto.pbkdf2Sync(String(password), p.salt, p.iterations, p.expected.length, PBKDF2_DIGEST);
    return actual.length === p.expected.length && crypto.timingSafeEqual(actual, p.expected);
  } catch {
    return false;
  }
};

// --- Async sürümler: HTTP yolunun (login/register) kullandıkları.
// crypto.pbkdf2 işi libuv thread pool'una atar → event loop bloke olmaz.
const pbkdf2Async = (password, salt, iterations, keylen) =>
  new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), salt, iterations, keylen, PBKDF2_DIGEST, (err, key) =>
      err ? reject(err) : resolve(key));
  });

const hashPasswordAsync = async (password) => {
  const salt = crypto.randomBytes(16);
  return buildPhc(salt, await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN));
};

const verifyPasswordAsync = async (password, stored) => {
  try {
    const p = parsePhc(stored);
    if (!p) return false;
    const actual = await pbkdf2Async(password, p.salt, p.iterations, p.expected.length);
    return actual.length === p.expected.length && crypto.timingSafeEqual(actual, p.expected);
  } catch {
    return false;
  }
};

// Güçlü rastgele parola (base64url, ~16 karakter). Seed'de ham parola tutmayız.
const generatePassword = () => crypto.randomBytes(12).toString('base64url');

const loadOrCreateCredentials = (users) => {
  let store = { _comment: 'YEREL dev parolaları - git\'e girmez. Silerseniz veritabanını da sıfırlayıp yeniden tohumlayın.', users: {} };
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try { store = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8')); store.users = store.users || {}; } catch { /* bozuksa yeniden üret */ }
  }
  let changed = false;
  for (const u of users) {
    if (!store.users[u.username]) { store.users[u.username] = generatePassword(); changed = true; }
  }
  if (changed) {
    store.generated_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(CREDENTIALS_PATH), { recursive: true });
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(store, null, 2) + '\n');
    console.log(`[db] Dev parolaları üretildi/güncellendi: ${CREDENTIALS_PATH}`);
  }
  return store.users;
};

// ---------------------------------------------------------------------------
// MIGRATIONS
// v1-v7 SQLite tarihçesinden BİREBİR taşındı (yalnız lehçe çevrildi) - şema evriminin
// anlatısı korunur, tek bir "init.sql"e sıkıştırılmaz (DDIA Böl. 4).
// v8+ PostgreSQL/PostGIS'e özgü yeni adımlardır.
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS facilities (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        kod TEXT UNIQUE NOT NULL,
        ad TEXT NOT NULL,
        adres TEXT,
        lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
        lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        occupancy INTEGER NOT NULL DEFAULT 0 CHECK (occupancy BETWEEN 0 AND 100),
        iett_info TEXT NOT NULL DEFAULT 'Mevcut Değil',
        vapur_info TEXT NOT NULL DEFAULT 'Mevcut Değil',
        transit_transfer TEXT NOT NULL DEFAULT 'Mevcut Değil',
        route_description TEXT NOT NULL DEFAULT 'Mevcut Değil',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      -- reserve_date/reserve_time artık GERÇEK date/time tipleri (SQLite'ta TEXT'ti):
      -- "2026-13-45" gibi imkansız tarihler artık veritabanı seviyesinde reddedilir.
      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
        reserve_date date NOT NULL,
        reserve_time time NOT NULL,
        guests INTEGER NOT NULL CHECK (guests > 0),
        crypto_signature TEXT NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, facility_id, reserve_date, reserve_time)
      );

      CREATE TABLE IF NOT EXISTS districts (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        population INTEGER NOT NULL CHECK (population >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
      CREATE INDEX IF NOT EXISTS idx_reservations_facility_date ON reservations(facility_id, reserve_date);
    `
  },
  {
    // v2 (Faz v2-01): sipariş/menü altyapısı + rezervasyon zenginleştirme. ADR-001.
    // Para her yerde TAM SAYI KURUŞ (*_minor) - float yuvarlama hatası imkansız.
    version: 2,
    up: `
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('pending', 'confirmed', 'cancelled'));
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS amount_minor INTEGER NOT NULL DEFAULT 0
        CHECK (amount_minor >= 0);
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_type TEXT
        CHECK (payment_type IN ('cash', 'card', 'online'));
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS highchair_count INTEGER NOT NULL DEFAULT 0
        CHECK (highchair_count >= 0);

      CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Genel',
        price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
        is_available BOOLEAN NOT NULL DEFAULT TRUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (facility_id, name)
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'submitted', 'served', 'paid', 'cancelled')),
        total_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
        crypto_signature TEXT NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_menu_items_facility ON menu_items(facility_id);
      CREATE INDEX IF NOT EXISTS idx_orders_reservation ON orders(reservation_id);
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    `
  },
  {
    // v3 (Faz v2-03): İSPARK bağımsız bookable kaynak. ADR-003.
    version: 3,
    up: `
      CREATE TABLE IF NOT EXISTS ispark_status (
        facility_id INTEGER PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        occupied INTEGER NOT NULL DEFAULT 0 CHECK (occupied >= 0 AND occupied <= capacity),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_reservations_slot
        ON reservations(facility_id, reserve_date, reserve_time);
    `
  },
  {
    // v4 (Faz v2-04): daily_stats = gün×tesis ROLLUP (türetilmiş veri). ADR-004.
    version: 4,
    up: `
      CREATE TABLE IF NOT EXISTS daily_stats (
        stat_date date NOT NULL,
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
    `
  },
  {
    // v5 (Faz v2-05): siparişin ödeme yöntemi. ADR-005.
    version: 5,
    up: `
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_type TEXT
        CHECK (payment_type IN ('cash', 'card', 'online'));
    `
  },
  {
    // v6 (Faz v2-07): audit_log = APPEND-ONLY olay kaydı (yalnız INSERT). ADR-007.
    version: 6,
    up: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        actor_user_id INTEGER NOT NULL REFERENCES users(id),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        detail JSONB,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    `
  },
  {
    // v7: 'occupancy' -> 'manual_occupancy' (ADLANDIRMA DÜZELTMESİ).
    // Kolon hiçbir zaman gerçek doluluğu göstermiyordu: yalnız seed'den ve adminin elle
    // girdiği PATCH'ten değişiyordu. Artık OLDUĞU ŞEY gibi adlandırılır; gerçek doluluk
    // rezervasyonlardan TÜRETİLİR (db.js FACILITY_SELECT). DDIA Böl. 11.
    version: 7,
    up: `ALTER TABLE facilities RENAME COLUMN occupancy TO manual_occupancy;`
  },
  {
    // v8 (PostgreSQL/PostGIS geçişi - ADR-009): GERÇEK mekansal tipler.
    //
    // facilities.geom OLUŞTURULMUŞ (generated) kolondur: lat/lng'den türetilir, elle
    // yazılamaz → nokta ile koordinat ASLA ayrışamaz (SQLite'ta böyle bir garanti yoktu).
    // districts.geom ise dışarıdan yüklenir (scripts/load-geo.js), çünkü 3.7MB'lık ilçe
    // sınırı geometrisi seed.json'da değil GeoJSON dosyasında yaşıyor.
    version: 8,
    up: `
      CREATE EXTENSION IF NOT EXISTS postgis;

      ALTER TABLE facilities ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
        GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED;
      CREATE INDEX IF NOT EXISTS idx_facilities_geom ON facilities USING GIST (geom);

      -- AYRICA geography indeksi. Neden ikisi birden:
      -- geometry <-> operatörü DERECE cinsinden düzlemsel mesafe ölçer. İstanbul'da (41°N)
      -- bir boylam derecesi bir enlem derecesinden ~%25 kısadır, bu yüzden derece sıralaması
      -- METRE sıralamasıyla uyuşmaz - "en yakın 3 tesis" yanlış sırada gelebilir (ölçüldü).
      -- geography <-> küresel/jeodezik ölçer; KNN sıralaması metre cinsinden DOĞRU olur.
      CREATE INDEX IF NOT EXISTS idx_facilities_geog ON facilities USING GIST ((geom::geography));

      ALTER TABLE districts ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);
      CREATE INDEX IF NOT EXISTS idx_districts_geom ON districts USING GIST (geom);
    `
  },
  {
    // v9: iptal edilebilir rezervasyon + eksik indeksler + İSPARK sahipliği.
    version: 9,
    up: `
      -- 1) UNIQUE kısıtı İPTALİ KAPSAMIYORDU.
      -- UNIQUE(user_id, facility_id, reserve_date, reserve_time) içinde status yok; bu yüzden
      -- iptal edilen bir rezervasyon o slotu SONSUZA DEK bloke ediyordu - kullanıcı fikrini
      -- değiştirip aynı yere tekrar rezervasyon YAPAMIYORDU.
      -- Çözüm: KISMİ (partial) benzersiz indeks. Kural yalnız iptal EDİLMEMİŞ satırlara uygulanır;
      -- iptal edilenler birikebilir (tarihçe korunur) ama slotu tutmazlar.
      ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_user_id_facility_id_reserve_date_reserve_time_key;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reservations_active_slot
        ON reservations (user_id, facility_id, reserve_date, reserve_time)
        WHERE status <> 'cancelled';

      -- 2) audit_log sıralama indeksi. Sorgu her zaman "en yeni önce" (ORDER BY created_at DESC)
      -- ama indeks yoktu; EXPLAIN 'Sort' gösteriyordu. Log büyüdükçe pahalanırdı.
      CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC, id DESC);

      -- 3) İSPARK yer sahipliği. 'take' atomikti ama 'release' KİMİN bıraktığını bilmiyordu:
      -- herhangi bir oturumlu kullanıcı başkasının yerini bırakabiliyordu. Artık her kapma
      -- bir satır bırakır; release yalnız kendi satırını silebilir.
      CREATE TABLE IF NOT EXISTS ispark_holds (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (facility_id, user_id)   -- bir kullanıcı aynı otoparkta tek yer tutar
      );
      CREATE INDEX IF NOT EXISTS idx_ispark_holds_user ON ispark_holds (user_id);
    `
  }
];

// ---------------------------------------------------------------------------
// Havuz + sorgu sarmalayıcısı
// ---------------------------------------------------------------------------
let pool = null;
let initPromise = null;

/**
 * Bir pg client/pool'u projenin okuduğu sade arayüze sarar.
 *   all() -> satır dizisi, one() -> ilk satır ya da null, run() -> etkilenen satır sayısı
 * Böylece çağrı yerleri sürücü ayrıntısıyla değil, niyetle konuşur.
 */
const wrap = (executor) => ({
  raw: executor,
  all: async (sql, params = []) => (await executor.query(sql, params)).rows,
  one: async (sql, params = []) => (await executor.query(sql, params)).rows[0] ?? null,
  run: async (sql, params = []) => (await executor.query(sql, params)).rowCount,
});

// PG_SCHEMA: testler için izolasyon. Her test dosyası kendi şemasında koşar; böylece
// paralel koşabilirler ve birbirlerinin verisini görmezler (SQLite'ta bu "her teste ayrı
// dosya" ile yapılıyordu). public search_path'te KALIR - PostGIS tipleri/fonksiyonları
// (geometry, ST_Contains) orada yaşıyor.
const PG_SCHEMA = process.env.PG_SCHEMA || null;

const getPool = () => {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      ...(PG_SCHEMA ? { options: `-c search_path=${PG_SCHEMA},public` } : {}),
    });
    // Havuzdaki boşta bağlantı hatası (ör. sunucu yeniden başladı) süreci düşürmemeli.
    pool.on('error', (err) => console.error('[db] Havuz bağlantı hatası (yoksayıldı):', err.message));
  }
  return pool;
};

const db = () => wrap(getPool());

// ---------------------------------------------------------------------------
// TRANSACTION - eşzamanlılığın kalbi (ADR-009 Karar 3)
// ---------------------------------------------------------------------------
/**
 * SQLite'ta transaction() 'BEGIN IMMEDIATE' kullanıyordu: tüm yazıcılar SERİLEŞİYORDU,
 * bu yüzden createReservation'daki "oku → kontrol et → yaz" dizisi güvenliydi.
 *
 * PostgreSQL çok yazıcılıdır ve VARSAYILAN READ COMMITTED bu diziyi KORUMAZ. İki eşzamanlı
 * transaction aynı SUM(guests)=48'i okuyup ikisi de 2 kişi ekleyebilir → 52 (kapasite 50).
 * Buna WRITE SKEW denir (DDIA Böl. 7.2.3): ne kayıp güncelleme ne kirli okuma; iki işlem de
 * kendi içinde tutarlı, ama BİRLİKTE bir invariant'ı kırıyorlar. Yalnız satır kilidi çözmez,
 * çünkü çakışma VAR OLMAYAN satırlar üzerindedir (phantom).
 *
 * Karar: SERIALIZABLE (PostgreSQL'de SSI - Serializable Snapshot Isolation). Veritabanı
 * çakışmayı tespit edip transaction'lardan birini 40001 ile geri çevirir; biz de sınırlı
 * sayıda yeniden deneriz. Bu, uygulamada elle kilit yönetmekten daha güvenlidir:
 * gelecekte eklenecek bir sorgu kilidi almayı UNUTABİLİR, ama SSI'yı atlayamaz.
 *
 * Reddedilen alternatif: SELECT ... FOR UPDATE ile tesis satırını kilitlemek. Daha ucuz
 * ama korumayı çağrı yerinin disiplinine bağlar (bkz. ADR-009).
 */
const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';
const MAX_TX_RETRIES = 5;

const transaction = async (fn, { isolation = 'SERIALIZABLE', retries = MAX_TX_RETRIES } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const client = await getPool().connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const result = await fn(wrap(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => { /* bağlantı zaten bozuksa yut */ });
      const retryable = err.code === SERIALIZATION_FAILURE || err.code === DEADLOCK_DETECTED;
      if (!retryable || attempt >= retries) throw err;
      // Jitter'lı geri çekilme: iki çakışan işlem aynı anda tekrar denerse yine çakışır.
      await new Promise((r) => setTimeout(r, Math.random() * 10 * attempt));
    } finally {
      client.release();
    }
  }
};

// ---------------------------------------------------------------------------
// Migration + seed
// ---------------------------------------------------------------------------
const runMigrations = async (conn) => {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const row = await conn.one('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');
  const applied = row.v;

  for (const migration of MIGRATIONS) {
    if (migration.version <= applied) continue;
    // Her migration KENDİ transaction'ında: PostgreSQL'de DDL transaction'a girer, yani
    // yarım uygulanmış şema diye bir şey olmaz (MySQL'in aksine).
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.up);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
      await client.query('COMMIT');
      console.log(`[db] Migration v${migration.version} uygulandı.`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
};

// Idempotent seed: ON CONFLICT DO NOTHING sayesinde tekrar çalıştırmak güvenlidir.
const seedDatabase = async (conn) => {
  if (!fs.existsSync(SEED_PATH)) {
    console.warn(`[db] Seed dosyası bulunamadı: ${SEED_PATH} - boş veritabanıyla devam ediliyor.`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

  await transaction(async (tx) => {
    // Ham parola seed'de YOK. Güçlü rastgele parola üretip gitignored dosyaya yazar,
    // DB'ye sadece hash'ini koyarız (ADR-002 Karar 4).
    const seedUsers = seed.users || [];
    const credentials = loadOrCreateCredentials(seedUsers);
    for (const u of seedUsers) {
      await tx.run(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
        [u.username, hashPassword(credentials[u.username]), u.role]
      );
    }

    for (const d of seed.districts || []) {
      await tx.run(
        'INSERT INTO districts (name, population) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [d.name, d.population]
      );
    }

    // seed.json'daki 'occupancy' alanı elle girilmiş bir göstergedir → manual_occupancy'ye
    // gider (migration v7). Gerçek doluluk rezervasyonlardan türetilir, seed'den değil.
    //
    // id IDENTITY kolonu olduğu için açıkça id yazarken OVERRIDING SYSTEM VALUE gerekir;
    // sonrasında sequence'i en büyük id'ye senkronlarız, yoksa ilk INSERT çakışır.
    for (const f of seed.facilities || []) {
      await tx.run(`
        INSERT INTO facilities
          (id, kod, ad, adres, lat, lng, capacity, manual_occupancy, iett_info, vapur_info, transit_transfer, route_description)
        OVERRIDING SYSTEM VALUE
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO NOTHING
      `, [
        f.id, f.kod, f.ad, f.adres || null, f.lat, f.lng, f.capacity, f.occupancy,
        f.iett_info || 'Mevcut Değil', f.vapur_info || 'Mevcut Değil',
        f.transit_transfer || 'Mevcut Değil', f.route_description || 'Mevcut Değil'
      ]);
    }
    await tx.run(`SELECT setval(pg_get_serial_sequence('facilities', 'id'), COALESCE((SELECT MAX(id) FROM facilities), 1))`);

    // Menü: tek şablon her tesise uygulanır (DRY). UNIQUE(facility_id,name) + DO NOTHING = idempotent.
    if (Array.isArray(seed.menu_template) && seed.menu_template.length) {
      for (const m of seed.menu_template) {
        await tx.run(`
          INSERT INTO menu_items (facility_id, name, category, price_minor)
          SELECT f.id, $1, $2, $3 FROM facilities f
          ON CONFLICT (facility_id, name) DO NOTHING
        `, [m.name, m.category || 'Genel', m.price_minor]);
      }
    }

    // İSPARK kapasitesi: tesis kapasitesine ORANTILI (gerçekçi), seed.ispark ile ayarlanır.
    const cfg = seed.ispark || { capacity_divisor: 5, min_capacity: 10 };
    await tx.run(`
      INSERT INTO ispark_status (facility_id, capacity, occupied)
      SELECT f.id, GREATEST($1::int, ROUND(f.capacity::numeric / $2::numeric)::int), 0 FROM facilities f
      ON CONFLICT (facility_id) DO NOTHING
    `, [cfg.min_capacity, cfg.capacity_divisor]);
  });
};

/**
 * init() - migration + seed'i BİR KEZ çalıştırır (aynı anda çağrılsa bile).
 * Sunucu açılışında ve her test/script başında beklenir.
 */
const init = () => {
  if (!initPromise) {
    initPromise = (async () => {
      // Test şeması henüz yoksa oluştur (search_path onu göstermeye hazır bekliyor).
      if (PG_SCHEMA) await db().run(`CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA}`);
      await runMigrations(db());
      await seedDatabase(db());
      return db();
    })();
  }
  return initPromise;
};

// Test sonu temizliği: şemayı ve içindeki her şeyi düşür.
const dropSchema = async () => {
  if (!PG_SCHEMA) return;
  await db().run(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`);
};

const close = async () => {
  if (pool) { await pool.end(); pool = null; initPromise = null; }
};

module.exports = {
  db, getPool, init, close, dropSchema, transaction, wrap,
  SLOTS, DATABASE_URL, MIGRATIONS,
  hashPassword, verifyPassword,             // senkron - seed/CLI
  hashPasswordAsync, verifyPasswordAsync,   // async - HTTP yolu
  DUMMY_PHC, PBKDF2_ITERATIONS
};
