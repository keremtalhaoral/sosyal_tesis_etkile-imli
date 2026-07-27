/**
 * test-weather.js - Hava durumu servisi testleri (gerçek OpenWeather + önbellek + bozulma).
 *
 * AĞA ÇIKMAZ: yerel bir SAHTE OpenWeather sunucusu ayağa kaldırır ve `WEATHER_API_BASE` ile
 * oraya yönlendirir. Böylece 200/401/429/timeout/bozuk-JSON yollarının HEPSİ deterministik
 * olarak test edilir - gerçek API'de bunları tetiklemek imkansıza yakındır (kotayı bilerek
 * doldurmak gerekirdi).
 *
 * Test edilemeyen tek şey: kullanıcının ANAHTARININ geçerli olup olmadığı. O, tek komutla
 * kendi makinesinde görülür:
 *   curl -s 'localhost:8085/api/weather?lat=41.0369&lng=28.9850'   -> "isMock":false
 *
 * Çalıştırma: node backend/test-weather.js
 */
const http = require('http');

let passed = 0, failed = 0;
const assert = (name, cond) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
};

// --- Sahte OpenWeather -------------------------------------------------------
let upstreamCalls = 0;
let mode = 'ok';           // ok | auth | quota | garbage | hang
const OBSERVED_UNIX = 1769500000;

const server = http.createServer((req, res) => {
  upstreamCalls++;
  if (mode === 'hang') return;                       // hiç yanıt verme -> timeout yolu
  if (mode === 'auth')  { res.writeHead(401); return res.end('{"cod":401}'); }
  if (mode === 'quota') { res.writeHead(429); return res.end('{"cod":429}'); }
  if (mode === 'garbage') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"beklenmedik":true}'); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    weather: [{ main: 'Rain', description: 'hafif yağmur' }],
    main: { temp: 12.345, humidity: 81 },
    wind: { speed: 5 },              // m/s -> 18 km/h beklenir
    dt: OBSERVED_UNIX,
    name: 'Istanbul',
  }));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.WEATHER_API_BASE = `http://127.0.0.1:${server.address().port}`;

  // weather.js'i ortam ayarlandıktan SONRA yükle
  const W = require('./weather');

  const reset = (ttl = '600000') => {
    W.clearCache();
    upstreamCalls = 0;
    process.env.WEATHER_CACHE_TTL_MS = ttl;
  };

  // --- 1. Anahtar yoksa demo -------------------------------------------------
  delete process.env.OPENWEATHER_API_KEY;
  reset();
  const noKey = await W.getWeather(41.0369, 28.9850);
  assert('anahtar yok: demo yanıtı döndü (isMock)', noKey.isMock === true);
  assert('anahtar yok: sebep açıkça belirtildi', /OPENWEATHER_API_KEY/.test(noKey.reason));
  assert('anahtar yok: upstream HİÇ çağrılmadı', upstreamCalls === 0);
  assert('demo deterministik: aynı koordinat aynı değer',
    (await W.getWeather(41.0369, 28.9850)).temp === noKey.temp);
  assert('demo deterministik: farklı koordinat farklı değer',
    (await W.getWeather(40.9910, 29.0250)).temp !== noKey.temp
    || (await W.getWeather(40.9910, 29.0250)).desc !== noKey.desc);

  // --- 2. GERÇEK veri yolu ---------------------------------------------------
  process.env.OPENWEATHER_API_KEY = 'test-anahtari';
  reset();
  mode = 'ok';
  const real = await W.getWeather(41.0369, 28.9850);
  assert('gerçek: isMock false', real.isMock === false);
  assert('gerçek: sıcaklık 1 ondalığa yuvarlandı (12.345 -> 12.3)', real.temp === 12.3);
  assert('gerçek: durum Türkçeleştirildi (Rain -> Yağmurlu)', real.desc === 'Yağmurlu');
  assert('gerçek: rüzgar m/s -> km/h çevrildi (5 -> 18)', real.wind_speed === 18);
  assert('gerçek: nem aynen geçti', real.humidity === 81);
  assert('gerçek: observed_at ölçüm zamanından üretildi (tazelik kanıtı)',
    real.observed_at === new Date(OBSERVED_UNIX * 1000).toISOString());
  assert('gerçek: ilk çağrı upstream\'e gitti', upstreamCalls === 1);

  // --- 3. Önbellek -----------------------------------------------------------
  const cached = await W.getWeather(41.0369, 28.9850);
  assert('önbellek: ikinci çağrı upstream\'e GİTMEDİ', upstreamCalls === 1);
  assert('önbellek: cached bayrağı true', cached.cached === true);
  assert('önbellek: değer birebir aynı', cached.temp === real.temp && cached.observed_at === real.observed_at);

  // Yakın koordinat aynı hücreye düşmeli (~1 km yuvarlama)
  await W.getWeather(41.0371, 28.9852);
  assert('önbellek: ~20 m ötesi aynı hücreye düştü (ek çağrı yok)', upstreamCalls === 1);
  // Uzak koordinat yeni çağrı
  await W.getWeather(40.9910, 29.0250);
  assert('önbellek: uzak koordinat yeni çağrı yaptı', upstreamCalls === 2);

  // TTL=0 -> önbellek kapalı
  reset('0');
  await W.getWeather(41.0369, 28.9850);
  await W.getWeather(41.0369, 28.9850);
  assert('önbellek: TTL=0 ile devre dışı (her çağrı upstream)', upstreamCalls === 2);

  // TTL dolunca yeniden çağırır
  reset('40');
  await W.getWeather(41.0369, 28.9850);
  await new Promise((r) => setTimeout(r, 70));
  await W.getWeather(41.0369, 28.9850);
  assert('önbellek: TTL dolunca yeniden çağırdı', upstreamCalls === 2);

  // --- 4. Hata yolları: hepsi demo'ya düşmeli, ASLA fırlatmamalı --------------
  for (const [m, etiket, sebepDeseni] of [
    ['auth', '401 (anahtar geçersiz)', /401/],
    ['quota', '429 (kota doldu)', /429|kota/i],
    ['garbage', 'bozuk JSON şekli', /ayrıştırılamadı/i],
  ]) {
    reset();
    mode = m;
    const r = await W.getWeather(41.0369, 28.9850);
    assert(`bozulma: ${etiket} -> demo yanıtı, çökme yok`, r.isMock === true && typeof r.temp === 'number');
    assert(`bozulma: ${etiket} sebebi raporlandı`, sebepDeseni.test(r.reason));
  }

  // Timeout
  reset();
  mode = 'hang';
  const t0 = Date.now();
  const timedOut = await W.getWeather(41.0369, 28.9850, { timeoutMs: 200 });
  const elapsed = Date.now() - t0;
  assert('bozulma: zaman aşımı -> demo yanıtı', timedOut.isMock === true);
  assert('bozulma: zaman aşımı gerçekten kısa sürdü (<2s)', elapsed < 2000);
  assert('bozulma: zaman aşımı sebebi raporlandı', /zaman aşımı/i.test(timedOut.reason));

  // Upstream tamamen kapalı (bağlantı reddi)
  reset();
  mode = 'ok';
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const down = await W.getWeather(41.0369, 28.9850, { timeoutMs: 500 });
  assert('bozulma: upstream kapalı -> demo yanıtı, çökme yok', down.isMock === true);

  // --- 5. Sözleşme: frontend'in okuduğu alanlar HER durumda var ---------------
  for (const [ad, payload] of [['gerçek', real], ['demo', noKey], ['hata', down]]) {
    const ok = ['temp', 'desc', 'humidity', 'wind_speed', 'isMock']
      .every((k) => payload[k] !== undefined && payload[k] !== null);
    assert(`sözleşme: ${ad} yanıtta tüm zorunlu alanlar var`, ok);
  }

  // --- 6. Ayrıştırıcı doğrudan --------------------------------------------------
  let parseThrew = false;
  try { W.parseOpenWeather({ main: {} }); } catch { parseThrew = true; }
  assert('ayrıştırıcı: eksik alanlarda açıkça hata veriyor (sessizce 0 döndürmüyor)', parseThrew);
  assert('çeviri: bilinmeyen durum aynen geçiyor', W.translate('Squall') === 'Kasırga' && W.translate('Xyz') === 'Xyz');

  console.log(`\n${passed} başarılı, ${failed} başarısız`);
  console.log(`(port ${port} üzerindeki sahte OpenWeather kapatıldı)`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('TEST ÇÖKTÜ:', err);
  process.exit(1);
});
