/**
 * test-auth.js - Parola hash'i ve login zamanlama testleri (ADR-002).
 *
 * ASIL DERDİ: login yanıtının SÜRESİ, kullanıcı adının var olup olmadığını sızdırmamalı.
 * Bir saldırgan parolayı bilmese bile "bu kullanıcı adı kayıtlı mı?" sorusunu süreden
 * okuyabiliyorsa, elindeki e-posta/kullanıcı listesini eleyip hedefli saldırıya geçebilir.
 *
 * Regresyon: server.js kullanıcı bulunamadığında sahte hash olarak 1 İTERASYONLU bir PHC
 * stringi doğruluyordu; gerçek hash'ler 600.000 iterasyonluydu. Yani "kullanıcı yok" yanıtı
 * "parola yanlış" yanıtından ~10.000× hızlı dönüyor, kodun engellemeye çalıştığı sızıntıyı
 * bizzat kod üretiyordu.
 *
 * Çalıştırma: node backend/test-auth.js
 */
const t = require('./test-helper').setup('auth');
const { assert } = t;

const {
  hashPassword, verifyPassword, hashPasswordAsync, verifyPasswordAsync,
  DUMMY_PHC, PBKDF2_ITERATIONS
} = require('./database');

const iterationsOf = (phc) => parseInt(String(phc).split('$')[1], 10);

(async () => {
  // --- 1. DUMMY_PHC gerçek hash'lerle AYNI maliyette olmalı --------------------
  const realHash = await hashPasswordAsync('dogru-parola');
  assert('dummy: PHC formatı geçerli (4 parça, pbkdf2_sha256)',
    String(DUMMY_PHC).split('$').length === 4 && DUMMY_PHC.startsWith('pbkdf2_sha256$'));
  assert('dummy: iterasyon sayısı gerçek hash ile AYNI (timing sızıntısı yok)',
    iterationsOf(DUMMY_PHC) === iterationsOf(realHash));
  assert('dummy: iterasyon sayısı PBKDF2_ITERATIONS ile senkron',
    iterationsOf(DUMMY_PHC) === PBKDF2_ITERATIONS);
  assert('dummy: hiçbir parolayla eşleşmiyor',
    (await verifyPasswordAsync('dogru-parola', DUMMY_PHC)) === false
    && (await verifyPasswordAsync('', DUMMY_PHC)) === false);

  // --- 2. Ölçülen zamanlama: iki login yolu da aynı süreyi harcamalı ----------
  // server.js'in login dalını birebir taklit ediyoruz:
  //   kullanıcı VAR  -> verifyPasswordAsync(yanlisParola, gercekHash)
  //   kullanıcı YOK  -> verifyPasswordAsync(yanlisParola, DUMMY_PHC)
  const timeIt = async (stored) => {
    const runs = 3;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) await verifyPasswordAsync('yanlis-parola', stored);
    return Number(process.hrtime.bigint() - t0) / 1e6 / runs; // ms/çağrı
  };
  await timeIt(realHash); // ısınma (JIT + thread pool)

  const msUserExists = await timeIt(realHash);
  const msUserMissing = await timeIt(DUMMY_PHC);
  const ratio = Math.max(msUserExists, msUserMissing) / Math.min(msUserExists, msUserMissing);
  console.log(`  ...kullanıcı var: ${msUserExists.toFixed(1)}ms | kullanıcı yok: ${msUserMissing.toFixed(1)}ms | oran: ${ratio.toFixed(2)}×`);
  // Eşik cömert (2×): 600k iterasyon ölçüm gürültüsünü bastırır, ama ESKİ hata (1 iterasyon)
  // ~10.000× fark ürettiği için bu testten asla geçemez.
  assert('zamanlama: var olan ve olmayan kullanıcı aynı süreyi harcıyor (oran < 2×)', ratio < 2);

  // --- 3. Async ve senkron sürümler çapraz uyumlu olmalı ----------------------
  // Seed/CLI senkron hash yazar, HTTP login async doğrular: ikisi ayrışırsa tohumlanmış
  // kullanıcılar giriş yapamaz. Bu yüzden her iki yön de test edilir.
  const syncHash = hashPassword('ayni-parola');
  assert('çapraz: senkron hash, async doğrulayıcı ile geçerli',
    (await verifyPasswordAsync('ayni-parola', syncHash)) === true);
  assert('çapraz: async hash, senkron doğrulayıcı ile geçerli',
    verifyPassword('ayni-parola', await hashPasswordAsync('ayni-parola')) === true);
  assert('çapraz: yanlış parola her iki yolda da reddedilir',
    verifyPassword('yanlis', syncHash) === false
    && (await verifyPasswordAsync('yanlis', syncHash)) === false);

  // --- 4. Bozuk/kötü niyetli PHC girdileri çökmeden false dönmeli -------------
  const badInputs = ['', 'x', 'pbkdf2_sha256$abc$AA==$AA==', 'pbkdf2_sha256$0$AA==$AA==',
                     'bcrypt$10$AA==$AA==', null, undefined, '$$$'];
  assert('bozuk PHC girdileri çökmeden reddedildi',
    badInputs.every((bad) => verifyPassword('p', bad) === false));

  // --- 5. Salt gerçekten kullanıcı başına rastgele olmalı ---------------------
  const h1 = await hashPasswordAsync('ayni');
  const h2 = await hashPasswordAsync('ayni');
  assert('salt: aynı parola farklı hash üretiyor (rainbow table saldırısına kapalı)', h1 !== h2);

  await t.finish();
})().catch(async (err) => {
  console.error('\nTEST ÇÖKTÜ:', err);
  await require('./database').dropSchema().catch(() => {});
  process.exit(1);
});
