/**
 * weather.js - OpenWeather entegrasyonu (gerçek veri + önbellek + zarif bozulma).
 *
 * TASARIM: "Hataları var olmaktan çıkar" (Ousterhout). Frontend'in hava durumu yüzünden
 * bozulmasına asla izin verilmez: anahtar yoksa, API çökmüşse, kota dolmuşsa ya da ağ
 * kapalıysa deterministik bir demo yanıtı döner - ama her zaman DÜRÜSTÇE `isMock: true`
 * etiketiyle, ki arayüz "demo" rozetini gösterebilsin.
 *
 * ÖNBELLEK NEDEN VAR (ve "güncellik"le neden çelişmez):
 * OpenWeather'ın kendi verisi zaten ~10 dakikada bir tazeleniyor; arada yapılan çağrılar
 * AYNI değeri döndürür. Önbelleksiz 30 tesis gezmek 30 çağrı demek ve ücretsiz katman
 * 60 çağrı/dakika - limit aşılınca API 429 döner, kod mock'a düşer, yani kullanıcı DAHA AZ
 * güncel veri görür. Önbellek burada tazeliği azaltmıyor, koruyor.
 *
 * TAZELİK KANITI: yanıtta `observed_at` (OpenWeather'ın ölçüm zamanı) ve `cached` bayrağı
 * var; arayüz "14:32'de güncellendi" yazabilir. "Bu gerçek mi?" sorusunun cevabı ekranda.
 */
const https = require('https');

const API_HOST = 'api.openweathermap.org';
const DEFAULT_TIMEOUT_MS = 4000;

// Önbellek anahtarı için koordinat ızgarası. 0.01 derece ~1.1 km: aynı tesise tekrar
// tıklamak ya da yakın iki tesis aynı hücreye düşer. Hava durumu 1 km'de değişmez.
//
// toFixed(2) KULLANILMIYOR: kayan nokta sınırında tutarsız. (28.985).toFixed(2) === "28.98"
// ama (28.9852).toFixed(2) === "28.99" - yani 20 cm arayla iki farklı hücre. Ölçüldü.
// Tamsayı hücre indeksi bu tuzağa düşmez.
const CELL_DEG = 0.01;

const cache = new Map();  // "lat,lng" -> { payload, expiresAt }

const cacheTtlMs = () => {
  const raw = process.env.WEATHER_CACHE_TTL_MS;
  if (raw === undefined) return 10 * 60 * 1000;      // varsayılan 10 dk
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 10 * 60 * 1000;   // 0 = önbellek kapalı
};

const cacheKey = (lat, lng) =>
  `${Math.round(Number(lat) / CELL_DEG)},${Math.round(Number(lng) / CELL_DEG)}`;

// --- Türkçeleştirme ---------------------------------------------------------
const CONDITION_TR = {
  Clear: 'Açık / Güneşli', Clouds: 'Bulutlu', Rain: 'Yağmurlu', Drizzle: 'Çiseleyen Yağmur',
  Thunderstorm: 'Fırtınalı Yağmur', Snow: 'Karlı', Mist: 'Sisli', Smoke: 'Dumanlı',
  Haze: 'Puslu', Dust: 'Tozlu', Fog: 'Sisli', Sand: 'Kum Fırtınası', Ash: 'Kül',
  Squall: 'Kasırga', Tornado: 'Hortum',
};
const translate = (main) => CONDITION_TR[main] || main;

// --- Demo yanıtı (anahtar yok / API erişilemiyor) ----------------------------
/**
 * DETERMİNİSTİK - rastgele DEĞİL. Aynı koordinat her zaman aynı değeri verir; böylece
 * demo "uydurma canlı veri" gibi görünmez, tutarlı bir sabit gibi davranır ve
 * `isMock: true` ile dürüstçe etiketlenir.
 */
const mockWeather = (lat, lng) => {
  const seed = Math.sin(parseFloat(lat)) * Math.cos(parseFloat(lng));
  const conditions = ['Açık / Güneşli', 'Hafif Rüzgarlı / Güneşli', 'Parçalı Bulutlu', 'Az Bulutlu'];
  return {
    temp: 25 + Math.round(seed * 4),
    desc: conditions[Math.abs(Math.floor(seed * 10)) % 4],
    humidity: Math.abs(Math.floor(seed * 25)) + 55,
    wind_speed: parseFloat((Math.abs(seed * 12) + 6).toFixed(1)),
    isMock: true,
    cached: false,
    observed_at: null,
    reason: null,   // çağıran doldurur: neden mock'a düşüldü
  };
};

// --- OpenWeather yanıtını proje sözleşmesine çevir ---------------------------
// Sözleşme: { temp, desc, humidity, wind_speed } - frontend'in okuduğu alan isimleri.
const parseOpenWeather = (json) => {
  if (!json || !json.main || !Array.isArray(json.weather) || !json.weather.length) {
    throw new Error('Beklenmeyen OpenWeather yanıt şekli');
  }
  return {
    temp: parseFloat(json.main.temp.toFixed(1)),
    desc: translate(json.weather[0].main),
    humidity: json.main.humidity,
    wind_speed: parseFloat(((json.wind && json.wind.speed ? json.wind.speed : 0) * 3.6).toFixed(1)), // m/s -> km/h
    isMock: false,
    cached: false,
    // OpenWeather `dt` = ölçüm zamanı (unix saniye). Tazeliğin kanıtı.
    observed_at: json.dt ? new Date(json.dt * 1000).toISOString() : null,
    city: json.name || null,
  };
};

// --- HTTP çağrısı ------------------------------------------------------------
/**
 * ARTIK https:// - eskiden http:// idi ve API anahtarı URL sorgu dizesinde ŞİFRESİZ
 * dolaşıyordu (aradaki herkes okuyabilirdi).
 * WEATHER_API_BASE testler için override edilebilir (yerel sahte sunucu).
 */
const fetchUpstream = (lat, lng, apiKey, timeoutMs) =>
  new Promise((resolve, reject) => {
    const base = process.env.WEATHER_API_BASE || `https://${API_HOST}`;
    const url = `${base}/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`
      + `&units=metric&lang=tr&appid=${encodeURIComponent(apiKey)}`;

    const client = url.startsWith('https:') ? https : require('http');
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(parseOpenWeather(JSON.parse(data))); }
          catch (e) { reject(Object.assign(new Error(`ayrıştırma: ${e.message}`), { kind: 'parse' })); }
        } else {
          // 401 = anahtar geçersiz, 429 = kota doldu. İkisi de farklı tavsiye gerektirir.
          // 403 ikircikli: ya OpenWeather reddetti ya da ARADAKİ proxy/güvenlik duvarı
          // engelledi. İkincisinde anahtar aramak boşuna - gövdeye bakıp ayırıyoruz.
          let kind = res.statusCode === 401 ? 'auth' : res.statusCode === 429 ? 'quota' : 'http';
          if (/not in allowlist|egress|blocked by|proxy/i.test(data)) kind = 'blocked';
          reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { kind, status: res.statusCode }));
        }
      });
    });

    // Askıda kalan soket koruması: timeout olmazsa ne 'end' ne 'error' tetiklenip
    // istek sonsuza dek asılı kalabilir.
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(Object.assign(new Error('zaman aşımı'), { kind: 'timeout' }));
    });
    req.on('error', (e) => reject(Object.assign(e, { kind: e.kind || 'network' })));
  });

// --- Genel API ---------------------------------------------------------------
/**
 * Hava durumu getir. ASLA fırlatmaz - her zaman gösterilebilir bir nesne döner.
 * @returns {Promise<{temp:number, desc:string, humidity:number, wind_speed:number,
 *                    isMock:boolean, cached:boolean, observed_at:string|null, reason:string|null}>}
 */
const getWeather = async (lat, lng, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return { ...mockWeather(lat, lng), reason: 'OPENWEATHER_API_KEY tanımlı değil (.env)' };
  }

  const ttl = cacheTtlMs();
  const key = cacheKey(lat, lng);

  if (ttl > 0) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return { ...hit.payload, cached: true };
    }
  }

  try {
    const payload = await fetchUpstream(lat, lng, apiKey, timeoutMs);
    if (ttl > 0) cache.set(key, { payload, expiresAt: Date.now() + ttl });
    return payload;
  } catch (err) {
    const reason = {
      auth: 'OpenWeather anahtarı reddedildi (401) - anahtarı kontrol edin',
      quota: 'OpenWeather kota limiti (429) - önbellek TTL\'sini artırın',
      blocked: 'api.openweathermap.org ağ politikasınca engelli (proxy/güvenlik duvarı) - '
             + 'bu bir anahtar sorunu DEĞİL, ağ erişimi sorunu',
      timeout: 'OpenWeather zaman aşımı',
      network: 'OpenWeather\'a ulaşılamadı (ağ)',
      parse: 'OpenWeather yanıtı ayrıştırılamadı',
    }[err.kind] || `OpenWeather hatası: ${err.message}`;
    console.warn(`[weather] ${reason} -> demo yanıtına düşülüyor`);
    return { ...mockWeather(lat, lng), reason };
  }
};

// Testler için: önbelleği boşalt / durumunu gör
const clearCache = () => cache.clear();
const cacheSize = () => cache.size;

module.exports = { getWeather, mockWeather, parseOpenWeather, translate, clearCache, cacheSize, cacheKey };
