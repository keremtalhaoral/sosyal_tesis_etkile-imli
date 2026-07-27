/**
 * test-helper.js - Testler için izole veritabanı ortamı + ortak assert altyapısı.
 *
 * SQLite döneminde her test kendi geçici DOSYASINI kullanıyordu (process.env.DB_PATH).
 * PostgreSQL'de karşılığı ŞEMA başına izolasyon: her test dosyası rastgele adlı bir şema
 * açar, migration'lar oraya kurulur, test bitince şema CASCADE ile düşer. Böylece:
 *   - testler gerçek veriye (public şeması) asla dokunmaz,
 *   - birbirlerinin verisini görmezler, paralel koşabilirler,
 *   - başarısız bir test artık bırakmaz.
 *
 * Kullanım (dosyanın EN ÜSTÜNDE, database/db require edilmeden ÖNCE):
 *   const t = require('./test-helper').setup('orders');
 *   ... await t.init();
 *   t.assert('bir şey doğru', kosul);
 *   await t.finish();
 */
const crypto = require('crypto');

let state = null;

/**
 * setup() ortam değişkenini AYARLAR ve modülleri ondan SONRA yükler - sıra önemlidir,
 * çünkü database.js havuzu ilk require anında yapılandırıyor.
 */
const setup = (label = 'test') => {
  const schema = `test_${label}_${crypto.randomBytes(4).toString('hex')}`;
  process.env.PG_SCHEMA = schema;
  // Dev parolaları gerçek data/dev-credentials.json'a yazılmasın (testler onu kirletmemeli).
  process.env.DEV_CREDENTIALS_PATH = require('path').join(
    require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), `${label}-`)),
    'dev-credentials.json'
  );

  const database = require('./database');
  state = { schema, database, passed: 0, failed: 0 };

  return {
    schema,
    database,
    db: () => database.db(),

    /**
     * @param {{geo?:boolean}} opts - geo:true ilçe sınır geometrisini de yükler
     *   (yalnız PostGIS mekansal join'i test eden dosyalar için; ~0.1s ek maliyet).
     */
    init: async ({ geo = false } = {}) => {
      await database.init();
      if (geo) await require('./geo').loadDistrictGeometry(database.db());
      return database.db();
    },

    assert: (name, cond) => {
      if (cond) { state.passed++; console.log(`  PASS  ${name}`); }
      else { state.failed++; console.error(`  FAIL  ${name}`); }
    },

    /** Fırlatması BEKLENEN çağrılar için: hata kodunu/statusCode'unu döndürür. */
    expectThrow: async (fn) => {
      try { await fn(); return null; } catch (e) { return e; }
    },

    finish: async () => {
      await database.dropSchema().catch((e) => console.error('  (şema temizlenemedi)', e.message));
      await database.close();
      console.log(`\n${state.passed} başarılı, ${state.failed} başarısız`);
      process.exit(state.failed === 0 ? 0 : 1);
    },
  };
};

module.exports = { setup };
