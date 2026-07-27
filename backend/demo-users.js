/**
 * demo-users.js - `demo` şemasının sunum hesapları (tek kaynak)
 *
 * Neden ayrı bir modül: bu listeyi İKİ yer okuyor -
 *   scripts/demo-reset.js      hesapları kurar
 *   backend/database.js        describeDevLogins() açılışta hatırlatır
 * İki yerde ayrı ayrı yazılsaydı biri güncellenmeden kalır ve sunumun ortasında
 * "parola yanlış" denirdi. Veri data/demo-users.json'da, kod burada.
 *
 * Bu parolaların git'te olması bilinçlidir: yalnız yerel `demo` şemasında yaşarlar ve
 * sunum sırasında BİLİNİR olmak zorundadırlar. Gerçek `public` şemasındaki kullanıcıların
 * parolaları rastgele üretilir ve data/dev-credentials.json'da (gitignored) durur.
 */
const fs = require('fs');
const path = require('path');

const DEMO_USERS_PATH = path.join(__dirname, '..', 'data', 'demo-users.json');

let DEMO_USERS = [];
try {
  const raw = JSON.parse(fs.readFileSync(DEMO_USERS_PATH, 'utf8'));
  if (Array.isArray(raw.users)) DEMO_USERS = raw.users;
} catch {
  // Dosya yoksa/bozuksa sessizce boş kal: demo-reset.js anlamlı bir hata verir,
  // describeDevLogins() ise sadece bu satırı atlar. Sunucunun açılmasını engellemez.
}

module.exports = { DEMO_USERS, DEMO_USERS_PATH };
