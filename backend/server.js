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

// .env EN ÖNCE yüklenir: aşağıdaki modüller require edilirken process.env'i okuyor
// (security.js JWT_SECRET'i, database.js DATABASE_URL'i modül yüklenme anında çözüyor).
// Sıra bozulursa .env'deki değerler hiç görülmez.
const { loadEnv } = require('./env');
const envResult = loadEnv();

const express = require('express');
const cors = require('cors');
const db = require('./db');
const analytics = require('./analytics');
const { signJwt, verifyJwt, signReservation } = require('./security');
const { verifyPasswordAsync, DUMMY_PHC, init, DATABASE_URL, describeDevLogins } = require('./database');
const { validateReservationInput, validateOrderInput } = require('./validate');
const { getWeather } = require('./weather');
const { rateLimit, startCleanup } = require('./ratelimit');

// Async handler'da fırlatılan hata Express 4'e KENDİLİĞİNDEN ulaşmaz (reddedilen Promise
// yakalanmaz, istek asılı kalır). Bu sarmalayıcı reddi next()'e bağlar → alttaki hata
// middleware'i devreye girer.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
const PORT = process.env.PORT || 8085;

// --- Hız sınırları (bkz. backend/ratelimit.js) -------------------------------
// Login en pahalı uç: her deneme 600k PBKDF2 = ~100 ms CPU. Sınırsız bırakmak hem kaba
// kuvvete hem CPU tüketmeye açık kapı. Anahtar = IP + denenen kullanıcı adı: tek bir IP
// arkasındaki kurumsal ağın tamamı, biri yanlış parola girdi diye kilitlenmesin.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: Number(process.env.LOGIN_RATE_MAX || 5),
  keyOf: (req) => `${req.ip}|${String((req.body && req.body.username) || '').toLowerCase()}`,
  message: 'Çok fazla başarısız giriş denemesi. Lütfen biraz bekleyip tekrar deneyin.',
});
// Kayıt da PBKDF2 çalıştırıyor (aynı CPU maliyeti) - o da sınırlanmalı.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.REGISTER_RATE_MAX || 10),
  message: 'Çok fazla kayıt denemesi. Lütfen daha sonra tekrar deneyin.',
});
startCleanup(LOGIN_WINDOW_MS);

// CORS: varsayılan olarak açık (geliştirme + GitHub Pages'ten yerel backend'e erişim).
// CORS_ORIGIN verilirse yalnız o kaynaklara izin verilir (virgülle ayrılmış liste).
//
// NOT: Bu API oturumu Authorization başlığıyla taşıyor, çerezle DEĞİL. Tarayıcı bu başlığı
// başka bir siteye kendiliğinden eklemez; dolayısıyla klasik CSRF yüzeyi yok ve açık CORS
// burada göründüğü kadar tehlikeli değil. Yine de üretimde daraltılabilsin diye ayar var.
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));

// Temel güvenlik başlıkları (bağımsız; helmet paketine gerek yok).
// Bu API yalnız JSON döndürüyor, HTML değil - bu yüzden başlık seti küçük ve hedefli.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');   // tarayıcı içerik tipini tahmin etmesin
  res.set('X-Frame-Options', 'DENY');             // clickjacking: iframe'e gömülemez
  res.set('Referrer-Policy', 'no-referrer');      // dış sitelere URL sızdırma
  next();
});

// Gövde boyutu sınırı: varsayılan 100kb yeterli ama AÇIKÇA yazılsın ki bilinçli bir karar olsun.
app.use(express.json({ limit: '100kb' }));

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
app.post('/api/auth/register', registerLimiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  // En az 8 karakter. Önceki sınır 4'tü: "1234" kabul ediliyordu ve 600k iterasyonlu PBKDF2
  // bile bu kadar küçük bir arama uzayını koruyamaz (4 haneli sayı = 10.000 olasılık).
  // Hash'in gücü, parolanın entropisi kadardır.
  if (!username || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'Geçerli bir kullanıcı adı ve en az 8 karakterlik parola gerekli.' });
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

app.post('/api/auth/login', loginLimiter, asyncHandler(async (req, res) => {
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

// Rezervasyon iptali (v9). Satır SİLİNMEZ, status='cancelled' olur - gerçekleşmiş olay
// silinmez (DDIA Böl. 11). Bağlı siparişler de iptal edilir ve tutarları geri alınır.
// Kısmi benzersiz indeks sayesinde iptal edilen kayıt slotu artık bloke etmez.
app.delete('/api/reservations/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz rezervasyon id.' });
  try {
    res.json(await db.cancelReservation(id, req.user.id));
  } catch (err) {
    if (!err.statusCode) throw err;
    res.status(err.statusCode).json({ error: err.message });
  }
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
// SAYFALAMA ZORUNLU: bu uçlar eskiden tüm satırları döndürüyordu (ölçüldü: 425.139 satır /
// 142 MB / 8,7 s). Toplam sayı X-Total-Count başlığında; gövde yalnız istenen pencere.
const sendPage = (res, page) => {
  res.set('X-Total-Count', String(page.total));
  res.json({ rows: page.rows, total: page.total, limit: page.limit, offset: page.offset });
};

app.get('/api/admin/reservations', requireAdmin, asyncHandler(async (req, res) => {
  const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;
  sendPage(res, await db.getAllReservations(facilityId, req.query));
}));

app.get('/api/admin/orders', requireAdmin, asyncHandler(async (req, res) => {
  const facilityId = req.query.facilityId ? Number(req.query.facilityId) : undefined;
  sendPage(res, await db.getAllOrders(facilityId, req.query));
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
  try {
    if (!await db.takeIsparkSpot(facilityId, req.user.id)) {
      return res.status(409).json({ error: 'Otopark dolu, boş yer yok.' });
    }
  } catch (err) {
    if (!err.statusCode) throw err;
    return res.status(err.statusCode).json({ error: err.message });
  }
  res.status(201).json(await db.getIsparkStatus(facilityId));
}));

app.post('/api/ispark/:facilityId/release', requireAuth, asyncHandler(async (req, res) => {
  const facilityId = Number(req.params.facilityId);
  if (!await db.getIsparkStatus(facilityId)) return res.status(404).json({ error: 'Bu tesis için İSPARK kaydı yok.' });
  try {
    // Yalnız KENDİ kapadığı yeri bırakabilir (v9). Eskiden herkes herkesinkini bırakabiliyordu.
    await db.releaseIsparkSpot(facilityId, req.user.id);
  } catch (err) {
    if (!err.statusCode) throw err;
    return res.status(err.statusCode).json({ error: err.message });
  }
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

// Endpoint: Hava durumu. Gerçek OpenWeather verisi (anahtar .env'den); erişilemezse
// deterministik demo yanıtı - ama her zaman dürüstçe `isMock` etiketiyle.
// Ayrıntı ve önbellek gerekçesi: backend/weather.js
app.get('/api/weather', asyncHandler(async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat ve lng sorgu parametreleri zorunludur.' });
  }
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return res.status(400).json({ error: 'lat ve lng sayı olmalıdır.' });
  }
  res.json(await getWeather(lat, lng));
}));

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
      // Açılışta yapılandırmayı GÖRÜNÜR yap: "anahtarı .env'e yazdım ama demo veri geliyor"
      // sorununun kaynağı çoğu zaman burada anlaşılır.
      if (envResult.loaded) {
        console.log(`[env] .env yüklendi: ${envResult.keys.length} değişken`
          + (envResult.skipped.length ? ` (${envResult.skipped.length} tanesi ortamda zaten tanımlı olduğu için atlandı)` : ''));
      } else {
        console.log('[env] .env dosyası yok (.env.example\'ı kopyalayabilirsiniz)');
      }
      console.log(process.env.OPENWEATHER_API_KEY
        ? `[weather] GERÇEK OpenWeather verisi aktif (önbellek TTL: ${process.env.WEATHER_CACHE_TTL_MS ?? '600000'} ms)`
        : '[weather] OPENWEATHER_API_KEY yok -> deterministik DEMO verisi (isMock: true)');
      // Seed parolaları rastgele üretilip gitignored dosyaya yazılıyor; dosyayı açmayan
      // kimse giriş yapamaz. Açılışta söyleyelim ki deneme yanılmaya gerek kalmasın.
      describeDevLogins();
    });
  })
  .catch((err) => {
    console.error('[server] Veritabanı hazırlanamadı, servis başlatılmıyor:', err.message);
    console.error(`[server] Bağlantı: ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);
    console.error('[server] PostgreSQL çalışıyor mu?  npm run db:up   (docker compose)');
    process.exit(1);
  });
