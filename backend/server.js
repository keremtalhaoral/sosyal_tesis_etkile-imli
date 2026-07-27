/**
 * server.js - API Router and Weather Fetching Service
 * 
 * WHY THIS ARCHITECTURE WAS CHOSEN (John Ousterhout Philosophy):
 * 1. Define Errors Out of Existence: OpenWeatherMap queries require an API key and internet access. The server 
 *    detects the absence of the key (or catch exceptions on API failures/offline sandbox restrictions) and automatically
 *    switches to a realistic climate model generator for Istanbul districts, returning valid JSON instead of error responses.
 * 2. Deep Module: Express handlers are kept extremely lean. The routing API hides the database simulation, distance calculations,
 *    and weather mock fallbacks entirely. The frontend simply fetches coordinates and displays JSON results.
 * 3. Comments Describe Rationale: Critical handlers have comments explaining coordinate ordering constraints and error masking logic.
 */

const express = require('express');
const cors = require('cors');
const db = require('./db');
const analytics = require('./analytics');
const { signJwt, verifyJwt, signReservation } = require('./security');
const { verifyPasswordAsync, DUMMY_PHC, init, DATABASE_URL } = require('./database');
const { validateReservationInput, validateOrderInput } = require('./validate');
const http = require('http');

// Async handler'da fırlatılan hata Express 4'e KENDİLİĞİNDEN ulaşmaz (reddedilen Promise
// yakalanmaz, istek asılı kalır). Bu sarmalayıcı reddi next()'e bağlar → alttaki hata
// middleware'i devreye girer.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
const PORT = process.env.PORT || 8085;

app.use(cors());
app.use(express.json());

// Log incoming API queries for visibility
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- Kimlik doğrulama yardımcıları -----------------------------------------
const getAuthUser = (req) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return verifyJwt(header.slice(7));
};

const requireAuth = (req, res, next) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Giriş yapmanız gerekiyor.' });
  req.user = user;
  next();
};

const requireAdmin = (req, res, next) => {
  const user = getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekiyor.' });
  }
  req.user = user;
  next();
};

// --- Auth API ---------------------------------------------------------------
app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || String(password).length < 4) {
    return res.status(400).json({ error: 'Geçerli bir kullanıcı adı ve en az 4 karakterlik parola gerekli.' });
  }
  try {
    const user = await db.createUserAsync(String(username).trim(), password);
    res.status(201).json({ token: signJwt(user), user });
  } catch (err) {
    if (err.code === '23505') {  // unique_violation
      return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
    }
    throw err;
  }
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const record = username ? await db.getUserByUsername(String(username).trim()) : null;
  // Kullanıcı yoksa da GERÇEK parametrelerle (600k iterasyon) sahte bir doğrulama koştururuz:
  // "kullanıcı yok" ile "parola yanlış" aynı süreyi harcar, yani yanıt süresi kullanıcı adının
  // var olup olmadığını SIZDIRMAZ. DUMMY_PHC iterasyon sayısını PBKDF2_ITERATIONS'tan alır.
  const valid = await verifyPasswordAsync(password || '', record ? record.password : DUMMY_PHC);
  if (!record || !valid) {
    return res.status(401).json({ error: 'Kullanıcı adı veya parola hatalı.' });
  }
  const user = { id: record.id, username: record.username, role: record.role };
  res.json({ token: signJwt(user), user });
}));

// --- Facilities API ----------------------------------------------------------
// Endpoint: Retrieve Social Facilities (merkezi PostgreSQL veritabanından)
app.get('/api/facilities', asyncHandler(async (req, res) => {
  res.json(await db.getFacilities());
}));

// Endpoint: Add a new facility (admin) - yeni veri merkezi veritabanına kalıcı yazılır
app.post('/api/facilities', requireAdmin, asyncHandler(async (req, res) => {
  const { kod, ad, lat, lng, capacity } = req.body || {};
  if (!kod || !ad || typeof lat !== 'number' || typeof lng !== 'number' || !Number.isInteger(capacity)) {
    return res.status(400).json({ error: 'kod, ad, lat, lng (sayı) ve capacity (tamsayı) alanları zorunludur.' });
  }
  try {
    res.status(201).json(await db.createFacility(req.body, req.user.id));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `'${kod}' kodlu tesis zaten mevcut.` });
    }
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Geçersiz değer: kapasite > 0, doluluk 0-100, koordinatlar geçerli aralıkta olmalı.' });
    }
    throw err;
  }
}));

// Endpoint: Update facility occupancy (admin)
// NOT: bu uç adminin ELLE girdiği göstergeyi (manual_occupancy) günceller. Gerçek doluluk
// rezervasyonlardan türetilir ve YAZILAMAZ (migration v7 / ADR-009).
app.patch('/api/facilities/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { occupancy } = req.body || {};
  if (!Number.isInteger(occupancy) || occupancy < 0 || occupancy > 100) {
    return res.status(400).json({ error: 'occupancy 0-100 arası tamsayı olmalıdır.' });
  }
  const updated = await db.updateFacilityOccupancy(Number(req.params.id), occupancy, req.user.id);
  if (!updated) return res.status(404).json({ error: 'Tesis bulunamadı.' });
  res.json(updated);
}));

// Endpoint: Delete facility (admin) - rezervasyonları FK cascade ile temizlenir
app.delete('/api/facilities/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!await db.deleteFacility(Number(req.params.id), req.user.id)) {
    return res.status(404).json({ error: 'Tesis bulunamadı.' });
  }
  res.status(204).end();
}));

// --- Reservations API ---------------------------------------------------------
app.post('/api/reservations', requireAuth, asyncHandler(async (req, res) => {
  // Merkezi doğrulama (slot, tarih, guests, highchair...) - DB CHECK'lerinden ÖNCE dostça hata.
  const v = validateReservationInput(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const { facilityId, reserveDate, reserveTime, guests, highchairCount } = v.value;
  try {
    const signature = signReservation(req.user.id, facilityId, reserveDate, reserveTime, guests);
    const result = await db.createReservation({
      userId: req.user.id,
      facilityId, reserveDate, reserveTime, guests, highchairCount,
      cryptoSignature: signature
    });
    res.status(201).json({ id: result.id, booked: result.booked, remaining: result.remaining, signature });
  } catch (err) {
    if (err.code === '23505') {  // unique_violation
      return res.status(409).json({ error: 'Aynı tesis, tarih ve saat için zaten rezervasyonunuz var.' });
    }
    if (!err.statusCode) throw err;   // beklenmedik hata -> global middleware
    res.status(err.statusCode).json({ error: err.message });
  }
}));

app.get('/api/reservations', requireAuth, asyncHandler(async (req, res) => {
  res.json(await db.getReservationsByUserId(req.user.id));
}));

// --- Menü + Sipariş API (Faz v2-05) ------------------------------------------
app.get('/api/menu', asyncHandler(async (req, res) => {
  const facilityId = Number(req.query.facilityId);
  if (!Number.isInteger(facilityId) || facilityId <= 0) {
    return res.status(400).json({ error: 'facilityId gereklidir.' });
  }
  res.json(await db.getMenu(facilityId));
}));

app.post('/api/orders', requireAuth, asyncHandler(async (req, res) => {
  const v = validateOrderInput(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const { reservationId, items, paymentType } = v.value;
  try {
    // İmza createOrder içinde, GERÇEK toplam hesaplandıktan sonra üretilir (bkz. db.js).
    const result = await db.createOrder({ userId: req.user.id, reservationId, items, paymentType });
    res.status(201).json(result);
  } catch (err) {
    if (!err.statusCode) throw err;
    res.status(err.statusCode).json({ error: err.message });
  }
}));

app.get('/api/reservations/:id/orders', requireAuth, asyncHandler(async (req, res) => {
  const orders = await db.getOrdersByReservation(Number(req.params.id), req.user.id);
  if (orders === null) return res.status(403).json({ error: 'Bu rezervasyon size ait değil.' });
  res.json(orders);
}));

// Endpoint: Sipariş durum geçişi - personel/admin akışı (Faz v2-07, ADR-007).
// İzinli geçişler yalnız submitted→served, served→paid, (submitted|served)→cancelled.
app.patch('/api/orders/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status alanı zorunludur.' });
  try {
    res.json(await db.updateOrderStatus(Number(req.params.id), status, req.user.id));
  } catch (err) {
    if (!err.statusCode) throw err;
    res.status(err.statusCode).json({ error: err.message });
  }
}));

// --- Admin gözetim API (Faz v2-07) - sahiplik filtresi YOK, requireAdmin ile korunur ---
app.get('/api/admin/reservations', requireAdmin, asyncHandler(async (req, res) => {
  const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;
  res.json(await db.getAllReservations(facilityId));
}));

app.get('/api/admin/orders', requireAdmin, asyncHandler(async (req, res) => {
  const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;
  res.json(await db.getAllOrders(facilityId));
}));

app.get('/api/admin/audit-log', requireAdmin, asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  res.json(await db.getAuditLog(limit));
}));

// --- İSPARK API (bağımsız otopark kaynağı, atomik yer kapma) -------------------
app.get('/api/ispark/:facilityId', asyncHandler(async (req, res) => {
  const status = await db.getIsparkStatus(Number(req.params.facilityId));
  if (!status) return res.status(404).json({ error: 'Bu tesis için İSPARK kaydı yok.' });
  res.json(status);
}));

app.post('/api/ispark/:facilityId/take', requireAuth, asyncHandler(async (req, res) => {
  const facilityId = Number(req.params.facilityId);
  if (!await db.getIsparkStatus(facilityId)) return res.status(404).json({ error: 'Bu tesis için İSPARK kaydı yok.' });
  if (!await db.takeIsparkSpot(facilityId)) {
    return res.status(409).json({ error: 'Otopark dolu, boş yer yok.' });
  }
  res.status(201).json(await db.getIsparkStatus(facilityId));
}));

app.post('/api/ispark/:facilityId/release', requireAuth, asyncHandler(async (req, res) => {
  const facilityId = Number(req.params.facilityId);
  if (!await db.getIsparkStatus(facilityId)) return res.status(404).json({ error: 'Bu tesis için İSPARK kaydı yok.' });
  await db.releaseIsparkSpot(facilityId);
  res.json(await db.getIsparkStatus(facilityId));
}));

// --- Analytics API (canlı; Pages snapshot ile aynı şekil) ---------------------
const VALID_GRANULARITY = ['day', 'week', 'month', 'year'];
app.get('/api/analytics/dashboard', asyncHandler(async (req, res) => {
  const g = VALID_GRANULARITY.includes(req.query.granularity) ? req.query.granularity : 'month';
  res.json(await analytics.dashboard(g));
}));
// NOT (ölü sözleşme, kasıtlı): Frontend tüm ciro serisini /api/analytics/dashboard
// içinde alıyor; bu tekil uç API bütünlüğü için var (canlı-sorgu örneği) ama şu an
// hiçbir istemci çağırmıyor.
app.get('/api/analytics/revenue', asyncHandler(async (req, res) => {
  const g = VALID_GRANULARITY.includes(req.query.granularity) ? req.query.granularity : 'month';
  res.json(await analytics.revenueTimeSeries(g));
}));

// Endpoint: Retrieve District boundaries with demographics and RED alarms
// NOT (ölü sözleşme, kasıtlı): Sunucu tarafı zengin alarm/100k-başına hesaplaması
// burada yaşıyor; ancak Pages sunucusuz çalışabilsin diye frontend aynı hesabı statik
// geojson'dan client-side yapıyor (app.js). Bu uç canlı/backend senaryosu içindir.
app.get('/api/districts', asyncHandler(async (req, res) => {
  res.json(await db.getDistricts());
}));

// Endpoint: K-Nearest Neighbor (KNN) Proximity Analysis (Closest 3 facilities)
// NOT (ölü sözleşme, kasıtlı): Frontend yakınlık analizini MatrixEngine.findNearestKNN
// ile client-side yapıyor (offline çalışsın diye); bu uç aynı KNN'in backend karşılığı.
app.get('/api/proximity', asyncHandler(async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing coordinates: lat and lng query params are required." });
  }

  res.json(await db.getClosestFacilities(lat, lng, 3));
}));

// Endpoint: Weather API with automatic fail-safe fallback
app.get('/api/weather', async (req, res) => {
  const { lat, lng } = req.query;
  
  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing coordinates: lat and lng are required." });
  }

  const apiKey = process.env.OPENWEATHER_API_KEY;
  
  // Define errors out of existence: If no key is set, immediately bypass external call to avoid timeouts
  if (!apiKey) {
    return res.json(generateRealisticMockWeather(lat, lng));
  }

  // If API key is present, attempt real OpenWeatherMap request
  const url = `http://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&units=metric&appid=${apiKey}`;
  
  // Tek-yanıt guard'ı: timeout + error + end yarışabilir; yalnız ilki yanıtı gönderir.
  let settled = false;
  const reply = (payload) => { if (settled) return; settled = true; res.json(payload); };

  const request = http.get(url, (apiRes) => {
    let data = '';

    apiRes.on('data', (chunk) => {
      data += chunk;
    });

    apiRes.on('end', () => {
      try {
        if (apiRes.statusCode === 200) {
          const weatherJson = JSON.parse(data);
          reply({
            temp: parseFloat(weatherJson.main.temp.toFixed(1)),
            desc: translateConditionToTurkish(weatherJson.weather[0].main),
            humidity: weatherJson.main.humidity,
            wind_speed: parseFloat((weatherJson.wind.speed * 3.6).toFixed(1)), // Convert m/s to km/h
            isMock: false
          });
        } else {
          // If OpenWeather returns error (e.g. invalid key), serve mock weather instead of failing
          console.warn(`OpenWeather API returned status code ${apiRes.statusCode}. Falling back to mock.`);
          reply(generateRealisticMockWeather(lat, lng));
        }
      } catch (err) {
        reply(generateRealisticMockWeather(lat, lng));
      }
    });
  });

  // Askıda kalan soket koruması: 3 sn içinde yanıt gelmezse mock'a düş (aksi halde
  // ne 'end' ne 'error' tetiklenmeyip istek sonsuza dek asılı kalabilir).
  request.setTimeout(3000, () => {
    console.warn("OpenWeather isteği zaman aşımına uğradı; mock'a düşülüyor.");
    request.destroy();
    reply(generateRealisticMockWeather(lat, lng));
  });

  request.on('error', (err) => {
    console.warn("OpenWeather connection failed (e.g. offline sandbox). Falling back to mock.");
    // Mask exception: serve mock weather so frontend functions uninterrupted
    reply(generateRealisticMockWeather(lat, lng));
  });
});

// Helper: Translate basic weather conditions to Turkish
const translateConditionToTurkish = (mainCondition) => {
  const translations = {
    "Clear": "Açık / Güneşli",
    "Clouds": "Bulutlu",
    "Rain": "Yağmurlu",
    "Drizzle": "Çiseleyen Yağmur",
    "Thunderstorm": "Fırtınalı Yağmur",
    "Snow": "Karlı",
    "Mist": "Sisli",
    "Smoke": "Dumanlı",
    "Haze": "Puslu",
    "Dust": "Tozlu",
    "Fog": "Sisli",
    "Sand": "Kum Fırtınası",
    "Squall": "Kasırga",
    "Tornado": "Hortum"
  };
  return translations[mainCondition] || mainCondition;
};

// Helper: Generates realistic mock weather for Istanbul based on lat/lng coordinates
const generateRealisticMockWeather = (lat, lng) => {
  // Use a pseudo-random hash based on coordinates to keep the values stable for a specific location
  const seed = Math.sin(parseFloat(lat)) * Math.cos(parseFloat(lng));
  const tempOffset = Math.round(seed * 4); // Variations between -4°C and +4°C
  
  // Istanbul average summer temperature (approx. 26°C in June)
  const baseTemp = 25;
  const temp = baseTemp + tempOffset;
  
  // Determine weather condition based on coordinate decimals
  const index = Math.abs(Math.floor(seed * 10)) % 4;
  const conditions = [
    "Açık / Güneşli",
    "Hafif Rüzgarlı / Güneşli",
    "Parçalı Bulutlu",
    "Az Bulutlu"
  ];
  const condition = conditions[index];
  
  const humidity = Math.abs(Math.floor(seed * 25)) + 55; // 55% - 80%
  const wind_speed = parseFloat((Math.abs(seed * 12) + 6).toFixed(1)); // 6 - 18 km/h
  
  // Tek sözleşme: { temp, desc, humidity, wind_speed } — frontend'in okuduğu alan isimleri.
  return {
    temp,
    desc: condition,
    humidity,
    wind_speed,
    isMock: true
  };
};

// --- Global hata middleware'i (4 argüman = Express bunu hata işleyici sayar) --------
// Önceden hiç yoktu: bir handler beklenmedik şekilde fırlattığında Express'in varsayılan
// işleyicisi devreye girip yığın izini (stack trace) istemciye basıyordu. Artık iç detay
// sunucu log'unda kalır, istemci sade bir mesaj alır.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.url}:`, err);
  if (res.headersSent) return;
  const status = err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Sunucu hatası.' : err.message });
});

// Migration + seed BİTMEDEN port dinlenmez: aksi halde ilk istekler yarı kurulmuş bir şemaya
// çarpar (SQLite döneminde bağlantı senkron açıldığı için bu sorun yoktu; pg async).
init()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Müfettiş GIS Backend Server listening at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[server] Veritabanı hazırlanamadı, servis başlatılmıyor:', err.message);
    console.error(`[server] Bağlantı: ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);
    console.error('[server] PostgreSQL çalışıyor mu?  npm run db:up   (docker compose)');
    process.exit(1);
  });
