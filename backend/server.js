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
const { signJwt, verifyJwt, signReservation } = require('./security');
const { validateReservationInput } = require('./validate');
const http = require('http');
const crypto = require('crypto');

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
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || String(password).length < 4) {
    return res.status(400).json({ error: 'Geçerli bir kullanıcı adı ve en az 4 karakterlik parola gerekli.' });
  }
  try {
    const user = db.createUser(String(username).trim(), password);
    res.status(201).json({ token: signJwt(user), user });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
    }
    throw err;
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const { verifyPassword } = require('./database');
  const record = username ? db.getUserByUsername(String(username).trim()) : null;
  // verifyPassword sabit-zamanlıdır; kullanıcı yoksa da sahte doğrulama ile timing sızıntısını azaltırız.
  const valid = verifyPassword(password || '', record ? record.password : 'pbkdf2_sha256$1$AA==$AA==');
  if (!record || !valid) {
    return res.status(401).json({ error: 'Kullanıcı adı veya parola hatalı.' });
  }
  const user = { id: record.id, username: record.username, role: record.role };
  res.json({ token: signJwt(user), user });
});

// --- Facilities API ----------------------------------------------------------
// Endpoint: Retrieve Social Facilities (from central SQLite database)
app.get('/api/facilities', (req, res) => {
  res.json(db.getFacilities());
});

// Endpoint: Add a new facility (admin) - yeni veri merkezi veritabanına kalıcı yazılır
app.post('/api/facilities', requireAdmin, (req, res) => {
  const { kod, ad, lat, lng, capacity } = req.body || {};
  if (!kod || !ad || typeof lat !== 'number' || typeof lng !== 'number' || !Number.isInteger(capacity)) {
    return res.status(400).json({ error: 'kod, ad, lat, lng (sayı) ve capacity (tamsayı) alanları zorunludur.' });
  }
  try {
    res.status(201).json(db.createFacility(req.body));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: `'${kod}' kodlu tesis zaten mevcut.` });
    }
    if (String(err.message).includes('CHECK')) {
      return res.status(400).json({ error: 'Geçersiz değer: kapasite > 0, doluluk 0-100, koordinatlar geçerli aralıkta olmalı.' });
    }
    throw err;
  }
});

// Endpoint: Update facility occupancy (admin)
app.patch('/api/facilities/:id', requireAdmin, (req, res) => {
  const { occupancy } = req.body || {};
  if (!Number.isInteger(occupancy) || occupancy < 0 || occupancy > 100) {
    return res.status(400).json({ error: 'occupancy 0-100 arası tamsayı olmalıdır.' });
  }
  const updated = db.updateFacilityOccupancy(Number(req.params.id), occupancy);
  if (!updated) return res.status(404).json({ error: 'Tesis bulunamadı.' });
  res.json(updated);
});

// Endpoint: Delete facility (admin) - rezervasyonları FK cascade ile temizlenir
app.delete('/api/facilities/:id', requireAdmin, (req, res) => {
  if (!db.deleteFacility(Number(req.params.id))) {
    return res.status(404).json({ error: 'Tesis bulunamadı.' });
  }
  res.status(204).end();
});

// --- Reservations API ---------------------------------------------------------
app.post('/api/reservations', requireAuth, (req, res) => {
  // Merkezi doğrulama (slot, tarih, guests, highchair...) - DB CHECK'lerinden ÖNCE dostça hata.
  const v = validateReservationInput(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const { facilityId, reserveDate, reserveTime, guests, highchairCount } = v.value;
  try {
    const signature = signReservation(req.user.id, facilityId, reserveDate, reserveTime, guests);
    const result = db.createReservation({
      userId: req.user.id,
      facilityId, reserveDate, reserveTime, guests, highchairCount,
      cryptoSignature: signature
    });
    res.status(201).json({ id: result.id, booked: result.booked, remaining: result.remaining, signature });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Aynı tesis, tarih ve saat için zaten rezervasyonunuz var.' });
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/reservations', requireAuth, (req, res) => {
  res.json(db.getReservationsByUserId(req.user.id));
});

// --- İSPARK API (bağımsız otopark kaynağı, atomik yer kapma) -------------------
app.get('/api/ispark/:facilityId', (req, res) => {
  const status = db.getIsparkStatus(Number(req.params.facilityId));
  if (!status) return res.status(404).json({ error: 'Bu tesis için İSPARK kaydı yok.' });
  res.json(status);
});

app.post('/api/ispark/:facilityId/take', requireAuth, (req, res) => {
  const facilityId = Number(req.params.facilityId);
  if (!db.getIsparkStatus(facilityId)) return res.status(404).json({ error: 'Bu tesis için İSPARK kaydı yok.' });
  if (!db.takeIsparkSpot(facilityId)) {
    return res.status(409).json({ error: 'Otopark dolu, boş yer yok.' });
  }
  res.status(201).json(db.getIsparkStatus(facilityId));
});

app.post('/api/ispark/:facilityId/release', requireAuth, (req, res) => {
  const facilityId = Number(req.params.facilityId);
  if (!db.getIsparkStatus(facilityId)) return res.status(404).json({ error: 'Bu tesis için İSPARK kaydı yok.' });
  db.releaseIsparkSpot(facilityId);
  res.json(db.getIsparkStatus(facilityId));
});

// Endpoint: Retrieve District boundaries with demographics and RED alarms
app.get('/api/districts', (req, res) => {
  res.json(db.getDistricts());
});

// Endpoint: K-Nearest Neighbor (KNN) Proximity Analysis (Closest 3 facilities)
app.get('/api/proximity', (req, res) => {
  const { lat, lng } = req.query;
  
  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing coordinates: lat and lng query params are required." });
  }
  
  const closest = db.getClosestFacilities(lat, lng, 3);
  res.json(closest);
});

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
  
  const request = http.get(url, (apiRes) => {
    let data = '';
    
    apiRes.on('data', (chunk) => {
      data += chunk;
    });
    
    apiRes.on('end', () => {
      try {
        if (apiRes.statusCode === 200) {
          const weatherJson = JSON.parse(data);
          res.json({
            temp: parseFloat(weatherJson.main.temp.toFixed(1)),
            condition: translateConditionToTurkish(weatherJson.weather[0].main),
            humidity: weatherJson.main.humidity,
            wind: parseFloat((weatherJson.wind.speed * 3.6).toFixed(1)), // Convert m/s to km/h
            isMock: false
          });
        } else {
          // If OpenWeather returns error (e.g. invalid key), serve mock weather instead of failing
          console.warn(`OpenWeather API returned status code ${apiRes.statusCode}. Falling back to mock.`);
          res.json(generateRealisticMockWeather(lat, lng));
        }
      } catch (err) {
        res.json(generateRealisticMockWeather(lat, lng));
      }
    });
  });

  request.on('error', (err) => {
    console.warn("OpenWeather connection failed (e.g. offline sandbox). Falling back to mock.");
    // Mask exception: serve mock weather so frontend functions uninterrupted
    res.json(generateRealisticMockWeather(lat, lng));
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
  const wind = (Math.abs(seed * 12) + 6).toFixed(1); // 6 - 18 km/h
  
  return {
    temp,
    condition,
    humidity,
    wind,
    isMock: true
  };
};

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Müfettiş GIS Backend Server listening at http://localhost:${PORT}`);
});
