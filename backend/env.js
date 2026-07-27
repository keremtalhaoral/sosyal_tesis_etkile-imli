/**
 * env.js - `.env` dosyasını okur ve process.env'e yükler.
 *
 * NEDEN VAR: proje `.env.example` ile "anahtarını .env'e koy" diyordu ama `.env` dosyasını
 * OKUYAN hiçbir kod yoktu. Yani kullanıcı anahtarı doğru yere yazsa bile hiçbir şey olmuyordu
 * (sessiz başarısızlık - en can sıkıcı hata türü). Bu dosya o boşluğu kapatır.
 *
 * NEDEN `dotenv` PAKETİ DEĞİL: ihtiyacımız 30 satırlık bir ayrıştırıcı. Bir bağımlılık
 * eklemek, onu güncellemek/denetlemek demek. `pg` gibi gerçekten karmaşık bir iş için
 * bağımlılık makul; `KEY=VALUE` okumak için değil.
 *
 * KURAL: gerçek ortam değişkeni HER ZAMAN kazanır. `.env` yalnızca EKSİK olanı doldurur.
 * Sebep: CI/üretimde değişkenler ortamdan gelir; repoda unutulmuş bir `.env` onları ezerse
 * "bende çalışıyordu, sunucuda farklı davranıyor" sınıfı hatalar doğar.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', '.env');

/**
 * @param {string} [file] - .env yolu
 * @returns {{loaded:boolean, keys:string[], skipped:string[]}}
 *   keys    = .env'den alınan değişkenler
 *   skipped = .env'de vardı ama ortamda ZATEN tanımlı olduğu için atlananlar
 */
const loadEnv = (file = DEFAULT_PATH) => {
  if (!fs.existsSync(file)) return { loaded: false, keys: [], skipped: [] };

  const keys = [];
  const skipped = [];

  for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    // `export KEY=VALUE` biçimi de kabul edilir (kabuk alışkanlığı).
    if (line.startsWith('export ')) line = line.slice(7).trim();

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Tırnaklı değerleri soy: KEY="a b" -> a b. Tek/çift tırnak.
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] !== undefined) { skipped.push(key); continue; }
    process.env[key] = value;
    keys.push(key);
  }

  return { loaded: true, keys, skipped };
};

module.exports = { loadEnv, DEFAULT_PATH };
