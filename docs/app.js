/**
 * Müfettiş GIS - Advanced Web GIS & Decision Support System Orchestrator
 * conformed to John Ousterhout's 'Philosophy of Software Design' principles.
 */

// Application State (Information Hiding: Encapsulating state in a single configuration container)
const state = {
  map: null,
  theme: 'light',
  facilities: [],
  districtsGeoJSON: null,
  districtsLayer: null,
  transitRoutes: null,   // v2-06: data/transit-routes.geojson (gerçek hat geometrileri)
  markers: {},
  isparkMarkers: [],
  selectedFacility: null,
  selectedDistrict: null,
  activeTileLayer: null,
  shadowsLayer: null,
  showShadows: true,
  userLocation: {
    lat: 41.037007, // Default: Taksim Square
    lng: 28.976273,
    isMock: true,
    marker: null
  },
  userSession: null,
  shiftStartCoords: null,
  shiftStartMarker: null,
  shiftEndMarker: null,
  adminPlacementMode: false,
  adminPlacementMarker: null
};

// API Base configuration
const API_BASE = 'http://127.0.0.1:8085';

// ==========================================
// MOCK FETCH INTERCEPTOR FOR SERVERLESS PROD
// ==========================================
const MOCK_FACILITIES_KEY = 'mufettis_mock_facilities';
const MOCK_RESERVATIONS_KEY = 'mufettis_mock_reservations';
const MOCK_USERS_KEY = 'mufettis_mock_users';
// v2-07: order.js ile PAYLAŞILAN anahtar (docs/order.js K_ORD) - admin panel aynı siparişleri görür/değiştirir.
const MOCK_ORDERS_KEY = 'mufettis_mock_orders';
// v2-07: Pages/offline modda audit_log'un istemci-tarafı eşleniği (DDIA Böl. 11 ilkesi burada da
// geçerli: yalnız append edilir, hiç silinmez/değiştirilmez).
const MOCK_AUDIT_LOG_KEY = 'mufettis_mock_audit_log';
const mockAuditLog = (action, entityType, entityId, detail) => {
  const actor = (state.userSession && state.userSession.username) || 'bilinmeyen';
  const rows = JSON.parse(localStorage.getItem(MOCK_AUDIT_LOG_KEY)) || [];
  rows.unshift({ actor_username: actor, action, entity_type: entityType, entity_id: entityId, detail: JSON.stringify(detail || {}), created_at: new Date().toISOString() });
  localStorage.setItem(MOCK_AUDIT_LOG_KEY, JSON.stringify(rows.slice(0, 100)));
};
const defaultFacilities = [
  {"id": 1, "kod": "ALTY-01", "ad": "Altınboynuz Sosyal Tesisi", "koordinatlar": [41.0578458, 28.9456101], "kapasite": 120, "dolulukOrani": 75, "transit": {"otobus": "39D, 55, 99A, 37M, 86V (Eyüpsultan Teleferik)", "aktarma": "M7 Metro (Alibeyköy) -> T5 Tramvayı (Feshane)", "arabayla": "Silahtarağa Cd. ve Bahariye Cd. üzerinden"}},
  {"id": 2, "kod": "ALTY-02", "ad": "Arnavutköy Sosyal Tesisi", "koordinatlar": [41.067491, 29.0448903], "kapasite": 150, "dolulukOrani": 85, "transit": {"otobus": "22, 22RE, 25E, 40T, 42T (Arnavutköy Durağı)", "aktarma": "M2 Metro (Taksim) -> 40T Otobüsü", "arabayla": "Bebek Arnavutköy Cd. üzerinden"}},
  {"id": 3, "kod": "ALTY-03", "ad": "Avcılar Sosyal Tesisi", "koordinatlar": [40.976648, 28.743912], "kapasite": 200, "dolulukOrani": 55, "transit": {"otobus": "76O, 146, 76C (Denizköşkler Durağı)", "aktarma": "Metrobüs (Şükrübey Durağı) -> 10 dk yürüyüş", "arabayla": "D-100 Karayolu ve Dr. Sadık Ahmet Cd. üzerinden"}},
  {"id": 4, "kod": "ALTY-04", "ad": "Beykoz Koru Sosyal Tesisi", "koordinatlar": [41.1316936, 29.0942223], "kapasite": 250, "dolulukOrani": 90, "transit": {"otobus": "15, 15F, 15T, 15BK, 121A (Beykoz Belediyesi Durağı)", "aktarma": "M2 Metro (Hacıosman) -> Otobüs / Vapur", "arabayla": "Beykoz Sahil Yolu üzerinden"}},
  {"id": 5, "kod": "ALTY-05", "ad": "Beykoz Sahil Sosyal Tesisi", "koordinatlar": [41.1134095, 29.0864284], "kapasite": 180, "dolulukOrani": 65, "transit": {"otobus": "15, 15F, 15T, 15BK, 121A (Burunbahçe Durağı)", "aktarma": "M2 Metro (Hacıosman) -> Otobüs / Vapur", "arabayla": "Beykoz Sahil Yolu ve Burunbahçe Sk. üzerinden"}},
  {"id": 6, "kod": "ALTY-06", "ad": "Boğazköy Sosyal Tesisi", "koordinatlar": [41.185797, 28.765582], "kapasite": 110, "dolulukOrani": 40, "transit": {"otobus": "336G, 36AY, 36B (Boğazköy Durağı)", "aktarma": "M11 Metro (Arnavutköy) -> 336G Otobüsü", "arabayla": "E-80 ve Erdener Sk. üzerinden"}},
  {"id": 7, "kod": "ALTY-07", "ad": "Çamlıca Sosyal Tesisi", "koordinatlar": [41.027788, 29.069052], "kapasite": 300, "dolulukOrani": 95, "transit": {"otobus": "129T, 11A, 11ÜS, 14F (Kısıklı Durağı)", "aktarma": "M5 Metro (Kısıklı İstasyonu) -> 15 dk yürüyüş", "arabayla": "Turistik Çamlıca Cd. üzerinden"}},
  {"id": 8, "kod": "ALTY-08", "ad": "Cihangir Sosyal Tesisi", "koordinatlar": [41.0284966, 28.9825361], "kapasite": 90, "dolulukOrani": 72, "transit": {"otobus": "26, 26A, 26B, 28, 28T (Fındıklı Durağı + Yürüyüş)", "aktarma": "M2 Metro (Taksim) veya T1 Tramvay (Fındıklı) -> Yürüyüş", "arabayla": "Meclis-i Mebusan Cd. ve Kamacı Ustası Sk. üzerinden"}},
  {"id": 9, "kod": "ALTY-09", "ad": "Dragos Sosyal Tesisi", "koordinatlar": [40.9013477, 29.1466597], "kapasite": 220, "dolulukOrani": 83, "transit": {"otobus": "134YK, 16D, 17, 252 (Dragos Durağı)", "aktarma": "M4 Metro (Hastane-Adliye) -> 134YK Otobüsü", "arabayla": "Turgut Özal Bulvarı (Sahil Yolu) üzerinden"}},
  {"id": 10, "kod": "ALTY-10", "ad": "Fethipaşa Sosyal Tesisi", "koordinatlar": [41.0333739, 29.0259101], "kapasite": 280, "dolulukOrani": 89, "transit": {"otobus": "15, 15B, 15C, 15H, 15K, 15M (Paşalimanı Durağı)", "aktarma": "Marmaray (Üsküdar) -> 15 no'lu Otobüs hattı", "arabayla": "Paşalimanı Cd. ve Nacak Sk. üzerinden"}}
];

// DEMO hesaplar (yalnız GitHub Pages/çevrimdışı replika için). Gerçek backend bu parolaları
// ASLA taşımaz; üretimde parolalar gitignored dev-credentials.json'da (ADR-002 Karar 4).
const defaultUsers = [
  { username: 'user', password_hash: 'user1234_mock', role: 'user' },
  { username: 'admin', password_hash: 'admin1234_mock', role: 'admin' },
  { username: 'demo', password_hash: 'demo1234_mock', role: 'user' },
  { username: 'demo-admin', password_hash: 'demo1234_mock', role: 'admin' }
];

const getMockItem = (key, defaultVal) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw === 'null' || raw === 'undefined') return defaultVal;
    const parsed = JSON.parse(raw);
    if (!parsed || (Array.isArray(parsed) && parsed.length === 0)) {
      return defaultVal;
    }
    return parsed;
  } catch (e) {
    return defaultVal;
  }
};

// Auto-seed mock storage safely (gömülü minimal veri; merkezi seed birazdan üzerine yazar)
localStorage.setItem(MOCK_FACILITIES_KEY, JSON.stringify(getMockItem(MOCK_FACILITIES_KEY, defaultFacilities)));
localStorage.setItem(MOCK_USERS_KEY, JSON.stringify(getMockItem(MOCK_USERS_KEY, defaultUsers)));

// ==========================================================================
// MERKEZİ SEED BOOTSTRAP (Tek Gerçek Kaynak: data/seed.json)
// GitHub Pages sunucu çalıştıramadığı için localStorage, repo kökündeki kanonik
// data/seed.json'ın TÜRETİLMİŞ çevrimdışı replikası olarak kullanılır (bkz. DATABASE.md).
// Seed versiyonu yükselince tesis/kullanıcı verisi yeniden tohumlanır; rezervasyonlardan
// yalnızca hâlâ var olan tesislere ait olanlar korunur. fetch başarısız olursa
// (örn. file:// ile açma) yukarıdaki gömülü minimal veriyle devam edilir.
// ==========================================================================
const SEED_VERSION_KEY = 'mufettis_seed_version';

const seedRowToFacility = (f) => ({
  id: f.id,
  kod: f.kod,
  ad: f.ad,
  adres: f.adres,
  koordinatlar: [f.lat, f.lng],
  kapasite: f.capacity,
  dolulukOrani: f.occupancy,
  transit: {
    otobus: f.iett_info,
    vapur: f.vapur_info,
    aktarma: f.transit_transfer,
    arabayla: f.route_description
  }
});

const bootstrapCentralSeed = async () => {
  try {
    const res = await fetch('data/seed.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('seed.json HTTP ' + res.status);
    const seed = await res.json();
    const storedVersion = parseInt(localStorage.getItem(SEED_VERSION_KEY) || '0', 10);
    if (storedVersion >= (seed.version || 1)) return; // replika zaten güncel

    localStorage.setItem(MOCK_FACILITIES_KEY, JSON.stringify((seed.facilities || []).map(seedRowToFacility)));
    // Pages auth yalnız demo_users'tan beslenir (gerçek backend kullanıcıları parola taşımaz).
    localStorage.setItem(MOCK_USERS_KEY, JSON.stringify((seed.demo_users || []).map(u => ({
      username: u.username,
      password_hash: u.password + '_mock',
      role: u.role
    }))));

    const facilityIds = new Set((seed.facilities || []).map(f => f.id));
    const reservations = getMockItem(MOCK_RESERVATIONS_KEY, []);
    localStorage.setItem(MOCK_RESERVATIONS_KEY, JSON.stringify(
      (Array.isArray(reservations) ? reservations : []).filter(r => facilityIds.has(r.facility_id))
    ));

    localStorage.setItem(SEED_VERSION_KEY, String(seed.version || 1));
    console.info(`[seed] Merkezi seed v${seed.version || 1} localStorage replikasına yüklendi (${(seed.facilities || []).length} tesis).`);
  } catch (err) {
    console.warn('[seed] data/seed.json yüklenemedi, gömülü minimal veri kullanılıyor:', err.message);
  }
};

// Reservations seed
try {
  const rawRes = localStorage.getItem(MOCK_RESERVATIONS_KEY);
  if (!rawRes || rawRes === 'null' || rawRes === 'undefined' || !Array.isArray(JSON.parse(rawRes))) {
    localStorage.setItem(MOCK_RESERVATIONS_KEY, JSON.stringify([]));
  }
} catch (e) {
  localStorage.setItem(MOCK_RESERVATIONS_KEY, JSON.stringify([]));
}

const generateMockSignature = (dataStr) => {
  let hash = 0;
  for (let i = 0; i < dataStr.length; i++) {
    const char = dataStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0') + 
              Math.abs(hash * 31).toString(16).padStart(8, '0') + 
              Math.abs(hash * 97).toString(16).padStart(8, '0') + 
              Math.abs(hash * 13).toString(16).padStart(8, '0');
  return "MOCK_SIG_" + hex.toUpperCase();
};

const originalFetch = window.fetch;
window.fetch = async function (url, options) {
  if (typeof url === 'string' && url.startsWith('http://127.0.0.1:8085/api/')) {
    const endpoint = url.replace('http://127.0.0.1:8085/api/', '');
    const cleanEndpoint = endpoint.split('?')[0];
    const method = (options && options.method) || 'GET';
    const headers = (options && options.headers) || {};
    const body = (options && options.body && JSON.parse(options.body)) || null;

    let responseData = null;
    let status = 200;
    let matched = true; // v2-07: bilinmeyen uçlar artık sahte 200 DEĞİL, gerçek ağa düşer (aşağıda)

    const getLoggedUser = () => {
      const authHeader = headers['Authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          return payload;
        } catch(e) {
          return null;
        }
      }
      return null;
    };

    if (cleanEndpoint === 'facilities' || cleanEndpoint.startsWith('facilities/')) {
      const facilities = JSON.parse(localStorage.getItem(MOCK_FACILITIES_KEY));
      const facId = cleanEndpoint.includes('/') ? parseInt(cleanEndpoint.split('/')[1]) : null;
      if (method === 'GET') {
        responseData = facilities;
      } else if (method === 'POST') {
        const user = getLoggedUser();
        if (!user || user.role !== 'admin') {
          status = 403;
          responseData = { error: 'Yetkisiz erişim.' };
        } else {
          const nextId = facilities.length ? Math.max(...facilities.map(f => f.id)) + 1 : 1;
          const nextCode = body.kod || `ALTY-${String(nextId).padStart(2, '0')}`;
          const newFac = {
            id: nextId,
            kod: nextCode,
            ad: body.ad || body.name,
            koordinatlar: [parseFloat(body.lat), parseFloat(body.lng)],
            kapasite: parseInt(body.capacity),
            dolulukOrani: parseInt(body.occupancy || body.occupancy_percent || 0),
            transit: {
              otobus: body.iett_info,
              vapur: (body.ad || body.name || "").toLowerCase().includes('sahil') ? 'Deniz Hattı' : null,
              aktarma: body.transit_transfer,
              arabayla: body.route_description
            }
          };
          facilities.push(newFac);
          localStorage.setItem(MOCK_FACILITIES_KEY, JSON.stringify(facilities));
          mockAuditLog('facility.create', 'facility', nextId, { kod: nextCode, ad: newFac.ad, isparkCapacity: body.isparkCapacity || null });
          responseData = { message: 'Tesis başarıyla eklendi.', id: nextId, kod: nextCode };
        }
      } else if (method === 'PATCH') {
        // v2-07: doluluk hızlı-düzenleme (ADR-003 gap kapanışı)
        const user = getLoggedUser();
        if (!user || user.role !== 'admin') {
          status = 403;
          responseData = { error: 'Yetkisiz erişim.' };
        } else {
          const idx = facilities.findIndex(f => f.id === facId);
          if (idx === -1) {
            status = 404;
            responseData = { error: 'Tesis bulunamadı.' };
          } else {
            const before = facilities[idx].dolulukOrani;
            facilities[idx].dolulukOrani = parseInt(body.occupancy);
            localStorage.setItem(MOCK_FACILITIES_KEY, JSON.stringify(facilities));
            mockAuditLog('facility.update', 'facility', facId, { occupancy_before: before, occupancy_after: body.occupancy });
            responseData = facilities[idx];
          }
        }
      } else if (method === 'DELETE') {
        const user = getLoggedUser();
        if (!user || user.role !== 'admin') {
          status = 403;
          responseData = { error: 'Yetkisiz erişim.' };
        } else {
          const idx = facilities.findIndex(f => f.id === facId);
          if (idx !== -1) {
            facilities.splice(idx, 1);
            localStorage.setItem(MOCK_FACILITIES_KEY, JSON.stringify(facilities));

            // Clean up related reservations
            let reservations = JSON.parse(localStorage.getItem(MOCK_RESERVATIONS_KEY)) || [];
            reservations = reservations.filter(r => r.facility_id !== facId);
            localStorage.setItem(MOCK_RESERVATIONS_KEY, JSON.stringify(reservations));

            mockAuditLog('facility.delete', 'facility', facId, {});
            responseData = { message: 'Tesis başarıyla silindi.' };
          } else {
            status = 404;
            responseData = { error: 'Tesis bulunamadı.' };
          }
        }
      }
    } else if (cleanEndpoint === 'menu') {
      responseData = [
        { name: "Mercimek Çorbası", price: "25" },
        { name: "Izgara Köfte", price: "75" },
        { name: "Fırın Sütlaç", price: "30" },
        { name: "Mevsim Salatası", price: "20" },
        { name: "Çay", price: "5" },
        { name: "Türk Kahvesi", price: "15" }
      ];
    } else if (cleanEndpoint === 'weather') {
      responseData = {
        temp: 24,
        desc: "Açık, Güneşli",
        humidity: 45,
        wind: 12
      };
    } else if (cleanEndpoint === 'auth/login' || cleanEndpoint === 'auth/register') {
      const users = JSON.parse(localStorage.getItem(MOCK_USERS_KEY));
      const { username, password } = body;
      if (cleanEndpoint === 'auth/login') {
        const found = users.find(u => u.username === username && u.password_hash === (password + '_mock'));
        if (found) {
          const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
          const payload = btoa(JSON.stringify({ id: username === 'admin' ? 1 : 2, username: found.username, role: found.role }));
          const sig = btoa('mock_signature');
          responseData = { token: `${header}.${payload}.${sig}`, user: { username: found.username, role: found.role } };
        } else {
          status = 401;
          responseData = { error: 'Kullanıcı adı veya şifre hatalı.' };
        }
      } else {
        const exists = users.some(u => u.username === username);
        if (exists) {
          status = 409;
          responseData = { error: 'Bu kullanıcı adı zaten alınmış.' };
        } else {
          users.push({ username, password_hash: password + '_mock', role: 'user' });
          localStorage.setItem(MOCK_USERS_KEY, JSON.stringify(users));
          responseData = { message: 'Kayıt başarılı.' };
        }
      }
    } else if (cleanEndpoint === 'reserve') {
      const user = getLoggedUser();
      if (!user) {
        status = 401;
        responseData = { error: 'Giriş yapılmalıdır.' };
      } else {
        const reservations = JSON.parse(localStorage.getItem(MOCK_RESERVATIONS_KEY));
        const facilities = JSON.parse(localStorage.getItem(MOCK_FACILITIES_KEY));
        const facilityIdx = facilities.findIndex(f => f.id === body.facility_id);
        const facility = facilities[facilityIdx];
        if (!facility) {
          status = 404;
          responseData = { error: 'Tesis bulunamadı.' };
        } else {
          const guestCount = parseInt(body.guests) || 1;
          const currentOccupied = Math.round(facility.kapasite * (facility.dolulukOrani / 100));
          const capacityLeft = facility.kapasite - currentOccupied;

          if (guestCount > capacityLeft) {
            status = 400;
            responseData = { error: `Kapasite yetersiz. Kalan boş yer: ${capacityLeft}` };
          } else {
            // Update dolulukOrani
            const newOccupied = currentOccupied + guestCount;
            facility.dolulukOrani = Math.round((newOccupied / facility.kapasite) * 100);
            facilities[facilityIdx] = facility;
            localStorage.setItem(MOCK_FACILITIES_KEY, JSON.stringify(facilities));

            const facilityName = facility.ad;
            const dataStr = `${user.username}-${body.facility_id}-${body.reserve_date}-${body.reserve_time}-${body.guests}`;
            const signature = generateMockSignature(dataStr);

            const newRes = {
              id: reservations.length ? Math.max(...reservations.map(r => r.id)) + 1 : 1,
              user_id: user.id,
              username: user.username,
              facility_id: body.facility_id,
              facility_name: facilityName,
              reserve_date: body.reserve_date,
              reserve_time: body.reserve_time,
              guests: body.guests,
              crypto_signature: signature
            };
            reservations.push(newRes);
            localStorage.setItem(MOCK_RESERVATIONS_KEY, JSON.stringify(reservations));
            responseData = { message: 'Rezervasyon başarıyla oluşturuldu.', signature, crypto_signature: signature };
          }
        }
      }
    } else if (cleanEndpoint === 'reservations') {
      const user = getLoggedUser();
      if (!user) {
        status = 401;
        responseData = { error: 'Giriş yapılmalıdır.' };
      } else {
        const reservations = JSON.parse(localStorage.getItem(MOCK_RESERVATIONS_KEY));
        const userReservations = reservations.filter(r => r.username === user.username);
        responseData = userReservations.map(r => ({
          id: r.id,
          facility_name: r.facility_name,
          reserve_date: r.reserve_date,
          reserve_time: r.reserve_time,
          guests: r.guests,
          crypto_signature: r.crypto_signature
        }));
      }
    } else if (cleanEndpoint.startsWith('orders/') && cleanEndpoint.endsWith('/status')) {
      // v2-07: sipariş durum makinesi (submitted→served→paid; whitelist dışı geçiş 409)
      const user = getLoggedUser();
      if (!user || user.role !== 'admin') {
        status = 403;
        responseData = { error: 'Bu işlem için admin yetkisi gerekiyor.' };
      } else {
        const orderId = parseInt(cleanEndpoint.split('/')[1]);
        const orders = JSON.parse(localStorage.getItem(MOCK_ORDERS_KEY)) || [];
        const ord = orders.find(o => o.id === orderId);
        const allowed = { submitted: ['served', 'cancelled'], served: ['paid', 'cancelled'] };
        if (!ord) {
          status = 404;
          responseData = { error: 'Sipariş bulunamadı.' };
        } else if (!(allowed[ord.status] || []).includes(body.status)) {
          status = 409;
          responseData = { error: `Geçersiz durum geçişi: '${ord.status}' → '${body.status}'.` };
        } else {
          ord.status = body.status;
          localStorage.setItem(MOCK_ORDERS_KEY, JSON.stringify(orders));
          mockAuditLog('order.status_change', 'order', orderId, { to: body.status });
          responseData = { id: orderId, status: body.status };
        }
      }
    } else if (cleanEndpoint === 'admin/orders' || cleanEndpoint === 'admin/reservations') {
      // v2-07: admin gözetim - sahiplik filtresi YOK (requireAdmin eşleniği)
      const user = getLoggedUser();
      if (!user || user.role !== 'admin') {
        status = 403;
        responseData = { error: 'Bu işlem için admin yetkisi gerekiyor.' };
      } else {
        const reservations = JSON.parse(localStorage.getItem(MOCK_RESERVATIONS_KEY)) || [];
        const facilities = JSON.parse(localStorage.getItem(MOCK_FACILITIES_KEY)) || [];
        if (cleanEndpoint === 'admin/reservations') {
          responseData = reservations.map(r => {
            const fac = facilities.find(f => f.id === r.facility_id);
            return { ...r, facility_name: r.facility_name || (fac ? fac.ad : `Tesis #${r.facility_id}`), owner_username: r.owner || r.username || '-' };
          });
        } else {
          const orders = JSON.parse(localStorage.getItem(MOCK_ORDERS_KEY)) || [];
          responseData = orders.map(o => {
            const rv = reservations.find(r => r.id === o.reservation_id) || {};
            const fac = facilities.find(f => f.id === rv.facility_id);
            return {
              id: o.id, status: o.status, total_minor: o.total_minor, created_at: o.created_at,
              facility_name: fac ? fac.ad : `Tesis #${rv.facility_id}`, owner_username: rv.owner || rv.username || '-'
            };
          }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
      }
    } else if (cleanEndpoint === 'admin/audit-log') {
      // v2-07: audit_log görüntüleme (DDIA Böl. 11 - append-only event log; ADR-007)
      const user = getLoggedUser();
      if (!user || user.role !== 'admin') {
        status = 403;
        responseData = { error: 'Bu işlem için admin yetkisi gerekiyor.' };
      } else {
        responseData = (JSON.parse(localStorage.getItem(MOCK_AUDIT_LOG_KEY)) || []).slice(0, 50);
      }
    } else {
      matched = false;
    }

    // Bilinmeyen/tanınmayan uç: sahte 200 DÖNDÜRME - gerçek ağa düş (dual-mode sözleşmesi).
    // Backend varsa gerçek yanıtı alır; yoksa (GH Pages) bağlantı hatası -> çağıranın kendi
    // localStorage fallback'i (submitAdminFacility, changeOrderStatus vb.) devreye girer.
    if (!matched) return originalFetch.apply(this, arguments);

    return new Response(JSON.stringify(responseData), {
      status: status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return originalFetch.apply(this, arguments);
};

// Map Altlık Katmanları (Tile Layers)
const TILE_LAYERS = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' }
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' }
  }
};

// Local Otopark (İSPARK) Database (Fallback model representing 15 major otoparks near social facilities)
const ISPARK_LOCATIONS = [
  { id: 1, ad: "İSPARK Eminönü Açık Otoparkı", koordinatlar: [41.018042, 28.971556], kapasite: 250 },
  { id: 2, ad: "İSPARK Arnavutköy Sahil Otoparkı", koordinatlar: [41.066491, 29.043890], kapasite: 80 },
  { id: 3, ad: "İSPARK Avcılar Denizköşkler Otoparkı", koordinatlar: [40.972332, 28.728086], kapasite: 150 },
  { id: 4, ad: "İSPARK Beykoz Burunbahçe Otoparkı", koordinatlar: [41.118942, 29.071221], kapasite: 120 },
  { id: 5, ad: "İSPARK Çamlıca Tepesi Otoparkı", koordinatlar: [41.028942, 29.066556], kapasite: 200 },
  { id: 6, ad: "İSPARK Fındıklı Açık Otoparkı", koordinatlar: [41.030542, 28.989556], kapasite: 90 },
  { id: 7, ad: "İSPARK Dragos Sahil Otoparkı", koordinatlar: [40.908042, 29.171556], kapasite: 110 },
  { id: 8, ad: "İSPARK İstinye Dere Otoparkı", koordinatlar: [41.112042, 29.051556], kapasite: 300 },
  { id: 9, ad: "İSPARK Florya Sosyal Tesis Otoparkı", koordinatlar: [40.967808, 28.797808], kapasite: 180 },
  { id: 10, ad: "İSPARK Cihangir Katlı Otoparkı", koordinatlar: [41.033542, 28.984556], kapasite: 140 },
  { id: 11, ad: "İSPARK Haliç Sosyal Tesis Otoparkı", koordinatlar: [41.025542, 28.956556], kapasite: 100 },
  { id: 12, ad: "İSPARK Pendik Gözdağı Otoparkı", koordinatlar: [40.892042, 29.241556], kapasite: 80 },
  { id: 13, ad: "İSPARK Kasımpaşa İskele Otoparkı", koordinatlar: [41.031542, 28.969556], kapasite: 120 },
  { id: 14, ad: "İSPARK Beykoz Sahil Otoparkı", koordinatlar: [41.121542, 29.082556], kapasite: 100 },
  { id: 15, ad: "İSPARK Zeytinburnu Çırpıcı Otoparkı", koordinatlar: [40.991542, 28.894556], kapasite: 160 }
];

// Color mapping logic for occupancies
const getColorByStatus = (status, currentTheme) => {
  const colors = {
    light: {
      high: '#ef4444', // Red
      moderate: '#f59e0b', // Amber
      low: '#10b981', // Green
      primary: '#3b82f6', // User Blue
      ispark: '#8b5cf6' // Purple for otoparks
    },
    dark: {
      high: '#f87171',
      moderate: '#fbbf24',
      low: '#34d399',
      primary: '#60a5fa',
      ispark: '#a78bfa'
    }
  };
  return colors[currentTheme][status];
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initMap();
  setupUIEvents();
  await bootstrapCentralSeed(); // veri, merkezi seed'den gelsin (loadData'dan önce)
  loadData();
  Auth.checkSession();
});

// Theme Management
const initTheme = () => {
  const themeToggle = document.getElementById('theme-toggle');
  const storedTheme = localStorage.getItem('color-scheme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  state.theme = storedTheme || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', state.theme);
  updateThemeIcon();

  themeToggle.addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('color-scheme', state.theme);
    document.documentElement.setAttribute('data-theme', state.theme);
    updateThemeIcon();
    switchMapTileLayer();
    
    // Refresh layer styles dynamically
    if (state.districtsLayer) renderDistrictsLayer();
    Object.keys(state.markers).forEach(id => {
      const f = state.facilities.find(facility => facility.id == id);
      if (f) {
        const color = getColorByStatus(f.dolulukOrani > 80 ? 'high' : f.dolulukOrani > 60 ? 'moderate' : 'low', state.theme);
        state.markers[id].setStyle({ fillColor: color });
      }
    });
  });
};

const updateThemeIcon = () => {
  const icon = document.querySelector('#theme-toggle .toggle-icon');
  if (icon) icon.textContent = state.theme === 'light' ? '🌙' : '☀️';
};

// Map Management
const initMap = () => {
  // Center of Istanbul
  state.map = L.map('map', {
    zoomControl: false,
    maxBounds: [[40.7, 27.8], [41.6, 29.9]],
    minZoom: 9
  }).setView([41.015, 28.979], 10);

  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  const config = TILE_LAYERS[state.theme];
  state.activeTileLayer = L.tileLayer(config.url, config.options).addTo(state.map);
};

const switchMapTileLayer = () => {
  if (state.map && state.activeTileLayer) {
    state.map.removeLayer(state.activeTileLayer);
    const config = TILE_LAYERS[state.theme];
    state.activeTileLayer = L.tileLayer(config.url, config.options).addTo(state.map);
  }
};

// UI Panel Event Handlers
const setupUIEvents = () => {
  // Collapsible Sidebar Trigger
  const sidebar = document.getElementById('sidebar');
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  const expandBtn = document.getElementById('sidebar-expand-btn');
  
  const invalidateMapSizeSmoothly = () => {
    let count = 0;
    const interval = setInterval(() => {
      if (state.map) state.map.invalidateSize();
      count++;
      if (count >= 15) clearInterval(interval);
    }, 40);
  };

  collapseBtn.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    expandBtn.classList.remove('hidden');
    invalidateMapSizeSmoothly();
  });

  expandBtn.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    expandBtn.classList.add('hidden');
    invalidateMapSizeSmoothly();
  });

  // Back to list controls
  document.getElementById('back-to-list-btn').addEventListener('click', () => {
    switchSidebarView('list-view');
    Routing.clear();
    TransitRoutes.clear();
    clearShiftMarkers();
  });

  document.getElementById('district-back-btn').addEventListener('click', () => {
    switchSidebarView('list-view');
    Routing.clear();
    TransitRoutes.clear();
    clearShiftMarkers();
  });

  document.getElementById('admin-back-btn').addEventListener('click', () => {
    switchSidebarView('list-view');
    if (state.adminPlacementMarker) {
      state.map.removeLayer(state.adminPlacementMarker);
      state.adminPlacementMarker = null;
    }
  });

  // Search input filtering
  document.getElementById('facility-search').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    filterFacilities(query, getActiveFilter());
  });

  // Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const filter = e.target.dataset.filter;
      const query = document.getElementById('facility-search').value.toLowerCase().trim();
      filterFacilities(query, filter);
    });
  });

  // Map controls
  document.getElementById('btn-my-location').addEventListener('click', () => {
    requestUserLocation(true);
  });

  document.getElementById('btn-focus-all').addEventListener('click', () => {
    if (state.facilities.length > 0) {
      const group = new L.featureGroup(Object.values(state.markers));
      state.map.fitBounds(group.getBounds().pad(0.1));
    }
  });

  document.getElementById('btn-toggle-shadows').addEventListener('click', (e) => {
    state.showShadows = !state.showShadows;
    e.target.classList.toggle('active', state.showShadows);
    if (state.showShadows) {
      if (state.shadowsLayer) state.shadowsLayer.addTo(state.map);
    } else {
      if (state.shadowsLayer) state.map.removeLayer(state.shadowsLayer);
    }
  });

  // Reservation form handler
  document.getElementById('reservation-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitReservation();
  });

  // Admin panel form handler
  document.getElementById('admin-facility-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAdminFacility();
  });

  // Admin select map location button
  document.getElementById('admin-select-map-btn').addEventListener('click', () => {
    state.adminPlacementMode = true;
    document.getElementById('admin-form-status').className = 'form-status-msg info';
    document.getElementById('admin-form-status').textContent = 'Haritada tesis eklemek istediğiniz noktaya tıklayın...';
  });

  // Admin delete facility button
  document.getElementById('admin-delete-facility-btn').addEventListener('click', () => {
    const f = state.selectedFacility;
    if (!f) return;
    const conf1 = confirm(`Bu sosyal tesisi silmek istediğinize emin misiniz?\n\nKOD: ${f.kod}\nAD: ${f.ad}\nKAPASİTE: ${f.kapasite}`);
    if (conf1) {
      const conf2 = confirm(`DİKKAT: Bu işlem geri alınamaz! "${f.ad}" tesisi ve bu tesise ait tüm rezervasyonlar kalıcı olarak silinecektir.\n\nDevam etmek istediğinize emin misiniz?`);
      if (conf2) {
        deleteSelectedFacility(f.id);
      }
    }
  });

  // Admin: doluluk hızlı-düzenleme butonu (Faz v2-07)
  document.getElementById('admin-occupancy-update-btn').addEventListener('click', () => {
    updateSelectedFacilityOccupancy();
  });

  // Admin: gözetim listesi yenile butonu (Faz v2-07)
  document.getElementById('admin-oversight-refresh-btn').addEventListener('click', () => {
    loadAdminOversight();
    loadAdminAuditLog();
  });

  // Map Click Handler for Shift-Click Routing & Admin Placement
  if (state.map) {
    state.map.on('click', (e) => {
      // 1. Admin placement mode check
      if (state.adminPlacementMode) {
        state.adminPlacementMode = false;
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        document.getElementById('admin-lat').value = lat.toFixed(6);
        document.getElementById('admin-lng').value = lng.toFixed(6);
        document.getElementById('admin-form-status').className = 'form-status-msg success';
        document.getElementById('admin-form-status').textContent = 'Haritadan konum seçildi. Yol tarifleri otomatik hesaplanıyor...';

        if (state.adminPlacementMarker) state.map.removeLayer(state.adminPlacementMarker);
        state.adminPlacementMarker = L.marker(e.latlng, { draggable: true }).addTo(state.map);
        state.adminPlacementMarker.bindTooltip('Yeni Tesis Konumu (Sürükleyebilirsiniz)').openTooltip();
        
        state.adminPlacementMarker.on('dragend', (de) => {
          const newPos = de.target.getLatLng();
          document.getElementById('admin-lat').value = newPos.lat.toFixed(6);
          document.getElementById('admin-lng').value = newPos.lng.toFixed(6);
          autoFillTransitDetails(newPos.lat, newPos.lng);
        });

        autoFillTransitDetails(lat, lng);
        return;
      }

      // 2. Shift-click custom route check
      if (e.originalEvent.shiftKey) {
        handleShiftClick(e.latlng);
        return;
      }

      // Normal click: close dropdown
      const dropdown = document.querySelector('.dropdown-menu');
      if (dropdown) dropdown.classList.remove('show');
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const profilePill = document.querySelector('.user-profile-pill');
    const dropdown = document.querySelector('.dropdown-menu');
    if (profilePill && dropdown && !profilePill.contains(e.target)) {
      dropdown.classList.remove('show');
    }
  });

  initDropdownBehavior();
};

const getActiveFilter = () => {
  const activeBtn = document.querySelector('.filter-btn.active');
  return activeBtn ? activeBtn.dataset.filter : 'all';
};

const switchSidebarView = (viewId) => {
  document.querySelectorAll('.sidebar-content .content-view').forEach(view => {
    view.classList.remove('active');
  });
  const activeView = document.getElementById(viewId);
  if (activeView) activeView.classList.add('active');
};

// Data Loading Mappings
const loadData = async () => {
  try {
    const [facilitiesRes, districtsRes] = await Promise.all([
      fetch(`${API_BASE}/api/facilities`),
      fetch('data/istanbul-districts.geojson').then(res => res.json())
    ]);

    state.facilities = await facilitiesRes.json();
    state.districtsGeoJSON = districtsRes;

    // v2-06: gerçek toplu taşıma güzergahları (türetilmiş slim GeoJSON; ADR-006).
    // Çevrimdışı/Pages'te de çalışır (statik dosya; canlı API gerektirmez).
    TransitRoutes.load();

    // Process Spatial Area Centroids and facility containment inside districts
    processDistrictsContainment();

    renderStats();
    renderFacilityList();
    renderDistrictsLayer(); // Underneath
    renderFacilityMarkers(); // On top
    renderIsparkMarkers(); // Draw otoparks
    calculateCoverageShadows(); // Turf buffer calculations

    // Call KNN on startup
    requestUserLocation(false);
  } catch (error) {
    console.error("Failed to load map data from backend API.", error);
  }
};

// Containment mapping logic (Ray-casting Point-in-Polygon approximation)
const processDistrictsContainment = () => {
  if (!state.districtsGeoJSON || !state.facilities) return;

  state.districtsGeoJSON.features.forEach(district => {
    let facilityCount = 0;
    state.facilities.forEach(f => {
      if (pointInPolygon(f.koordinatlar[1], f.koordinatlar[0], district.geometry)) {
        facilityCount++;
      }
    });
    district.properties.facilityCount = facilityCount;
  });
};

const pointInPolygonRing = (lng, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const pointInPolygon = (lng, lat, geometry) => {
  if (!geometry || !geometry.coordinates) return false;
  if (geometry.type === 'Polygon') {
    return pointInPolygonRing(lng, lat, geometry.coordinates[0]);
  } else if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(polygon => pointInPolygonRing(lng, lat, polygon[0]));
  }
  return false;
};

// Render Summary metrics card
const renderStats = () => {
  const total = state.facilities.length;
  const sumCapacity = state.facilities.reduce((sum, f) => sum + f.kapasite, 0);
  const sumOccupied = state.facilities.reduce((sum, f) => sum + (f.kapasite * (f.dolulukOrani / 100)), 0);
  const avg = sumCapacity > 0 ? (sumOccupied / sumCapacity) * 100 : 0;

  document.getElementById('stat-total-facilities').textContent = total;
  document.getElementById('stat-avg-occupancy').textContent = `${avg.toFixed(1)}%`;
  document.getElementById('stat-total-capacity').textContent = sumCapacity.toLocaleString('tr-TR');
};

// Render Facility Lists
const renderFacilityList = () => {
  const list = document.getElementById('facility-list');
  list.innerHTML = '';
  
  state.facilities.forEach(f => {
    const status = f.dolulukOrani > 80 ? 'high' : f.dolulukOrani > 60 ? 'moderate' : 'low';
    const statusClass = status === 'high' ? 'bg-danger' : status === 'moderate' ? 'bg-warning' : 'bg-success';
    const statusLabel = status === 'high' ? 'Kritik Dolu' : status === 'moderate' ? 'Orta Dolu' : 'Sakin';

    const item = document.createElement('div');
    item.className = 'facility-item';
    item.dataset.id = f.id;
    item.innerHTML = `
      <div class="facility-item-header">
        <span class="facility-item-name">${f.ad}</span>
        <span class="status-pill ${statusClass}">${statusLabel}</span>
      </div>
      <div class="facility-item-detail">
        <span>Kapasite: ${f.kapasite}</span> | <span>Doluluk: %${f.dolulukOrani}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      selectFacility(f);
    });

    list.appendChild(item);
  });
};

const filterFacilities = (query, filter) => {
  document.querySelectorAll('.facility-item').forEach(item => {
    const id = item.dataset.id;
    const f = state.facilities.find(fac => fac.id == id);
    if (!f) return;

    const matchesSearch = f.ad.toLowerCase().includes(query) || f.kod.toLowerCase().includes(query);
    let matchesFilter = true;
    if (filter === 'high') matchesFilter = f.dolulukOrani > 80;
    if (filter === 'low') matchesFilter = f.dolulukOrani < 60;

    if (matchesSearch && matchesFilter) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
};

// Render District Overlay Layer
const renderDistrictsLayer = () => {
  if (state.districtsLayer) {
    state.map.removeLayer(state.districtsLayer);
  }

  state.districtsLayer = L.geoJSON(state.districtsGeoJSON, {
    style: (feature) => {
      const count = feature.properties.facilityCount || 0;
      return {
        fillColor: getChoroplethColor(count),
        weight: 1.5,
        opacity: 0.8,
        color: state.theme === 'dark' ? '#1e293b' : '#64748b',
        fillOpacity: state.theme === 'dark' ? 0.25 : 0.35
      };
    },
    onEachFeature: (feature, layer) => {
      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectDistrict(feature, layer);
      });
    }
  }).addTo(state.map);
};

const getChoroplethColor = (count) => {
  if (count >= 5) return '#065f46'; // Dark green
  if (count >= 3) return '#047857';
  if (count >= 1) return '#10b981'; // Green
  return state.theme === 'dark' ? '#334155' : '#e2e8f0'; // Gray (No facilities)
};

// District Selection & TOPSIS MCDSS Calculations
const selectDistrict = (feature, layer) => {
  if (state.selectedDistrict && state.selectedDistrict.layer) {
    state.districtsLayer.resetStyle(state.selectedDistrict.layer);
  }

  state.selectedDistrict = { feature, layer };
  
  // Highlight polygon border
  layer.setStyle({
    weight: 3,
    color: '#3b82f6',
    fillOpacity: state.theme === 'dark' ? 0.4 : 0.5
  });

  // Fit map view to district bounds
  if (state.map && layer.getBounds) {
    state.map.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 13, animate: true, duration: 1.0 });
  }

  const name = feature.properties.name;
  const pop = feature.properties.population || 100000;
  const count = feature.properties.facilityCount || 0;

  document.getElementById('district-name').textContent = name;
  document.getElementById('district-population').textContent = pop.toLocaleString('tr-TR');
  document.getElementById('district-facility-count').textContent = count;

  // Calculate area proxy using poly bbox size (Turf area is geodetic)
  const turfPolygon = turf.polygon(feature.geometry.coordinates[0]);
  const areaSqKm = (turf.area(turfPolygon) / 1000000).toFixed(1);
  const density = (pop / areaSqKm).toFixed(0);
  document.getElementById('district-density-val').textContent = `${Number(density).toLocaleString('tr-TR')} kişi/km²`;

  // TOPSIS MCDSS decision weighting
  const topsisRankings = MatrixEngine.rankDistrictsTOPSIS(state.districtsGeoJSON.features, state.facilities);
  const rankingInfo = topsisRankings.find(r => r.name === name);
  const scorePercent = (rankingInfo.score * 100).toFixed(1);

  const alarmBadge = document.getElementById('district-alarm-badge');
  alarmBadge.textContent = rankingInfo.urgency;
  alarmBadge.className = `facility-badge ${rankingInfo.score > 0.6 ? 'bg-danger' : rankingInfo.score > 0.45 ? 'bg-warning' : 'bg-success'}`;

  const decisionText = document.getElementById('district-decision-text');
  decisionText.innerHTML = `
    İlçe CBS KDS Değerlendirme Katsayısı: <strong>%${scorePercent}</strong>.<br/>
    ${rankingInfo.score > 0.6 ? `🚨 <strong>Kritik Yatırım Açığı:</strong> Nüfus yoğunluğu yüksek olmasına karşın tesis sayısı yetersizdir. Öncelikli sosyal tesis yapılması önerilir.` :
      rankingInfo.score > 0.45 ? `⚠️ <strong>Orta Seviye İhtiyaç:</strong> Tesis kapasitesi sınırda. Nüfus artışı takip edilmeli, ek otopark ve genişletme planlanmalı.` :
      `✅ <strong>Hizmet Yeterli:</strong> Mevcut tesis sayısı ve mekansal dağılım nüfus yoğunluğunu karşılayacak düzeydedir.`}
  `;

  // Fetch Weather dynamically
  fetchWeather(rankingInfo.centroid[0], rankingInfo.centroid[1], 'district-weather-grid');

  // Load district sub-facilities list
  const listContainer = document.getElementById('district-facility-list');
  listContainer.innerHTML = '';
  const list = state.facilities.filter(f => pointInPolygon(f.koordinatlar[1], f.koordinatlar[0], feature.geometry));
  if (list.length === 0) {
    listContainer.innerHTML = '<div class="empty-msg">Bu ilçede kayıtlı tesis bulunmuyor.</div>';
  } else {
    list.forEach(f => {
      const item = document.createElement('div');
      item.className = 'facility-item mini';
      item.innerHTML = `<strong>${f.ad}</strong><br/><small>Kapasite: ${f.kapasite} | Doluluk: %${f.dolulukOrani}</small>`;
      item.onclick = () => selectFacility(f);
      listContainer.appendChild(item);
    });
  }

  switchSidebarView('district-detail-view');
};

// Render Facility markers
const renderFacilityMarkers = () => {
  // Remove existing
  Object.values(state.markers).forEach(m => state.map.removeLayer(m));
  state.markers = {};

  state.facilities.forEach(f => {
    const status = f.dolulukOrani > 80 ? 'high' : f.dolulukOrani > 60 ? 'moderate' : 'low';
    const color = getColorByStatus(status, state.theme);

    const marker = L.circleMarker(f.koordinatlar, {
      radius: 10,
      fillColor: color,
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85
    }).addTo(state.map);

    // Hover Tooltip actions
    marker.bindTooltip(`<strong>${f.ad}</strong><br/>Kapasite Doluluk: %${f.dolulukOrani}`, {
      direction: 'top',
      offset: [0, -10]
    });

    // Hover Scaling effect
    marker.on('mouseover', () => {
      if (!state.selectedFacility || state.selectedFacility.id !== f.id) {
        marker.setStyle({ radius: 13, weight: 2.5 });
      }
    });
    marker.on('mouseout', () => {
      if (!state.selectedFacility || state.selectedFacility.id !== f.id) {
        marker.setStyle({ radius: 10, weight: 2 });
      }
    });

    // Click displays details
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      selectFacility(f);
    });

    state.markers[f.id] = marker;
  });
};

// Render İSPARK markers
const renderIsparkMarkers = () => {
  state.isparkMarkers.forEach(m => state.map.removeLayer(m));
  state.isparkMarkers = [];

  ISPARK_LOCATIONS.forEach(p => {
    const color = getColorByStatus('ispark', state.theme);
    const marker = L.circleMarker(p.koordinatlar, {
      radius: 6,
      fillColor: color,
      color: '#ffffff',
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(state.map);

    // Simulated available occupancy on otoparks
    const occupiedPercent = Math.floor(Math.random() * 40) + 40; // 40-80% occupied
    const emptySpots = Math.floor(p.kapasite * (1 - occupiedPercent / 100));

    // Custom Click popup representation
    marker.bindPopup(`
      <div class="ispark-popup">
        <strong>${p.ad}</strong><br/>
        Kapasite: ${p.kapasite} araç<br/>
        Boş Yer: <strong style="color: #8b5cf6;">${emptySpots}</strong> araç (%${(100 - occupiedPercent).toFixed(0)} boş)<br/>
        <small style="font-size: 8px; opacity: 0.75; display: block; margin-top: 4px;">Kaynak: İBB İSPARK Otopark Feed</small>
      </div>
    `);

    marker.on('click', () => {
      state.map.flyTo(p.koordinatlar, 15, { animate: true, duration: 1.0 });
    });

    state.isparkMarkers.push(marker);
  });
};

// Selected Facility display
const selectFacility = (facility) => {
  if (state.selectedFacility && state.markers[state.selectedFacility.id]) {
    // Reset former style
    state.markers[state.selectedFacility.id].setStyle({
      radius: 10, weight: 2
    });
  }

  state.selectedFacility = facility;
  
  // Highlight pin scale
  if (state.markers[facility.id]) {
    state.markers[facility.id].setStyle({
      radius: 14, weight: 3
    });
  }

  // Sidebar changes
  document.getElementById('detail-code').textContent = facility.kod;
  document.getElementById('detail-name').textContent = facility.ad;
  document.getElementById('detail-capacity').textContent = facility.kapasite;
  document.getElementById('detail-occupancy-percent').textContent = `%${facility.dolulukOrani}`;
  
  const progressFill = document.getElementById('detail-progress-fill');
  const status = facility.dolulukOrani > 80 ? 'high' : facility.dolulukOrani > 60 ? 'moderate' : 'low';
  const statusClass = status === 'high' ? 'bg-danger' : status === 'moderate' ? 'bg-warning' : 'bg-success';
  const statusLabel = status === 'high' ? 'Kritik Doluluk' : status === 'moderate' ? 'Orta Doluluk' : 'Sakin Seviye';

  progressFill.className = `progress-bar-fill ${statusClass}`;
  progressFill.style.width = `${facility.dolulukOrani}%`;
  
  const statusText = document.getElementById('detail-occupancy-text');
  statusText.className = `occupancy-status-text ${statusClass}`;
  statusText.textContent = `${statusLabel} (%${facility.dolulukOrani})`;

  // Admin: doluluk hızlı-düzenleme input'unu mevcut değere sıfırla (Faz v2-07)
  const occInput = document.getElementById('admin-occupancy-input');
  const occMsg = document.getElementById('admin-occupancy-msg');
  if (occInput) { occInput.value = ''; occInput.placeholder = `Şu an: %${facility.dolulukOrani}`; }
  if (occMsg) { occMsg.textContent = ''; occMsg.className = 'form-status-msg mini'; }

  // Focus Map view
  state.map.flyTo(facility.koordinatlar, 14, { animate: true, duration: 1.2 });

  // Draw OSRM route line
  Routing.draw([state.userLocation.lat, state.userLocation.lng], facility.koordinatlar);

  // v2-06: gerçek toplu taşıma güzergahları (düz çizgi yerine GTFS geometrisi; ADR-006)
  TransitRoutes.showForFacility(facility);

  // Fetch Menu from Scraper backend
  fetchMenu(facility.id);

  // Fetch weather
  fetchWeather(facility.koordinatlar[0], facility.koordinatlar[1], 'facility-weather-grid');

  // Compute nearest İSPARK otopark
  calculateNearestIspark(facility);

  // Compute Moovit Timeline options
  calculateTransitOptions(facility);

  switchSidebarView('detail-view');
};

// Fetch Dynamic restaurant Menu scraper
const fetchMenu = async (facilityId) => {
  const container = document.getElementById('detail-menu-list');
  container.innerHTML = '<div class="menu-loading">Menü listesi alınıyor...</div>';
  
  try {
    const res = await fetch(`${API_BASE}/api/menu?facilityId=${facilityId}`);
    if (!res.ok) throw new Error("Backend unavailable");
    const data = await res.json();
    
    container.innerHTML = '';
    data.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'menu-item-row';
      row.innerHTML = `
        <span class="menu-item-name">${item.name}</span>
        <span class="menu-item-price">${item.price} TL</span>
      `;
      container.appendChild(row);
    });
  } catch (error) {
    // APoSD: Define error out of existence using backup local list
    console.warn("Menu Scraper Backend failed. Fallback offline menu database applied.", error);
    container.innerHTML = `
      <div class="menu-item-row"><span class="menu-item-name">Süzme Mercimek Çorbası</span><span class="menu-item-price">45 TL</span></div>
      <div class="menu-item-row"><span class="menu-item-name">Karışık Izgara Tabağı</span><span class="menu-item-price">280 TL</span></div>
      <div class="menu-item-row"><span class="menu-item-name">Fırın Sütlaç (Tesis Özel)</span><span class="menu-item-price">65 TL</span></div>
      <div class="menu-item-row"><span class="menu-item-name">Çay (Cam Bardak)</span><span class="menu-item-price">10 TL</span></div>
      <small style="opacity: 0.65; display:block; font-size: 8px; margin-top: 5px;">* Fiyatlar yerel veritabanı yedeğinden (Offline DB) yüklenmiştir.</small>
    `;
  }
};

// Fetch Weather API
const fetchWeather = async (lat, lng, elementId) => {
  const container = document.getElementById(elementId);
  try {
    const res = await fetch(`${API_BASE}/api/weather?lat=${lat}&lng=${lng}`);
    if (!res.ok) throw new Error("Weather request failed");
    const data = await res.json();
    
    container.innerHTML = `
      <div class="weather-temp">${data.temp}°C</div>
      <div class="weather-desc">${data.desc}</div>
      <div class="weather-detail">Nem: %${data.humidity}</div>
      <div class="weather-detail">Rüzgar: ${data.wind_speed} km/s</div>
    `;
  } catch (e) {
    // Fallback simulated local weather based on coordinates to avoid app crashing
    const tempSim = Math.floor(Math.random() * 8) + 22; // 22-30C
    container.innerHTML = `
      <div class="weather-temp">${tempSim}°C</div>
      <div class="weather-desc">Açık / Güneşli ☀️</div>
      <div class="weather-detail">Nem: %48</div>
      <div class="weather-detail">Rüzgar: 14 km/s</div>
      <small style="grid-column: 1 / span 2; font-size: 8px; opacity:0.65;">* İstanbul Centroid İklim Modeli Simülasyonu</small>
    `;
  }
};

// Compute closest İSPARK using Matrix Engine
const calculateNearestIspark = (facility) => {
  const result = MatrixEngine.findNearestKNN(facility.koordinatlar, ISPARK_LOCATIONS, 1);
  if (result.length > 0) {
    const ispark = result[0].target;
    const distanceVal = result[0].distance;
    
    // Simulate current empty spots dynamically
    const percentSim = Math.floor(Math.random() * 40) + 30; // 30-70% capacity
    const spotsSim = Math.floor(ispark.kapasite * (1 - percentSim / 100));

    document.getElementById('detail-ispark-name').textContent = ispark.ad;
    document.getElementById('detail-ispark-distance').textContent = `${distanceVal.toFixed(0)} metre`;
    document.getElementById('detail-ispark-occupancy').textContent = `${spotsSim} / ${ispark.kapasite} Boş`;
    
    const fill = document.getElementById('detail-ispark-progress-fill');
    fill.style.width = `${(100 - percentSim)}%`;
    fill.className = `progress-bar-fill ${percentSim > 80 ? 'bg-danger' : percentSim > 60 ? 'bg-warning' : 'bg-success'}`;
  }
};

// Multi-Modal Moovit-style Route Timeline Renderer
const calculateTransitOptions = (facility) => {
  const container = document.getElementById('transit-options-container');
  if (!container) return;
  container.innerHTML = '';

  const origin = [state.userLocation.lat, state.userLocation.lng];
  const dest = facility.koordinatlar;
  const distance = state.map.distance(L.latLng(origin), L.latLng(dest));
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();

  const getNextDeparture = (freq) => {
    const totalMins = currentHour * 60 + currentMin;
    const wait = freq - (totalMins % freq);
    const depTime = new Date(now.getTime() + wait * 60 * 1000);
    return {
      timeStr: `${depTime.getHours().toString().padStart(2,'0')}:${depTime.getMinutes().toString().padStart(2,'0')}`,
      wait
    };
  };

  const transitData = [];

  if (facility.transit && facility.transit.otobus) {
    transitData.push({
      type: "otobus",
      icon: "🚌",
      label: "Otobüs (İETT)",
      color: "#eab308",
      headway: 8,
      duration: Math.max(5, Math.round(distance / 240 + 12)),
      steps: [
        { type: "walk", desc: "En Yakın Durak", mins: 4 },
        { type: "ride", desc: `İETT Otobüs (Hat: ${facility.transit.otobus})`, mins: Math.max(2, Math.round(distance / 300)), line: "İETT" },
        { type: "walk", desc: "Tesise Yürüyüş", mins: 2 }
      ],
      attribution: "Kaynak: İBB Açık Veri Portalı - İETT GTFS"
    });
  }

  if (facility.transit && facility.transit.vapur) {
    transitData.push({
      type: "vapur",
      icon: "🛳️",
      label: "Vapur / Motor",
      color: "#06b6d4",
      headway: 20,
      duration: Math.max(10, Math.round(distance / 320 + 15)),
      steps: [
        { type: "walk", desc: "İskele Yürüyüş", mins: 12 },
        { type: "ride", desc: `Şehir Hatları Vapuru (${facility.transit.vapur})`, mins: Math.max(5, Math.round(distance / 350)), line: "Vapur" },
        { type: "walk", desc: "Sahil Boyunca Yürüyüş", mins: 5 }
      ],
      attribution: "Kaynak: İBB Şehir Hatları Sefer Verileri"
    });
  }

  if (facility.transit && facility.transit.aktarma) {
    transitData.push({
      type: "aktarma",
      icon: "🔄",
      label: "Aktarmalı Rota",
      color: "#8b5cf6",
      headway: 6,
      duration: Math.max(5, Math.round(distance / 220 + 8)),
      steps: [
        { type: "walk", desc: "Metro İstasyonuna Yürüyüş", mins: 6 },
        { type: "ride", desc: `Aktarma: ${facility.transit.aktarma}`, mins: Math.max(2, Math.round(distance / 400)), line: "Metro" },
        { type: "walk", desc: "Tesise Yürüyüş", mins: 2 }
      ],
      attribution: "Kaynak: Metro İstanbul Raylı Sistem Planları"
    });
  }

  let firstCard = null;

  transitData.forEach((route, idx) => {
    const dep = getNextDeparture(route.headway);
    let stepsHTML = '';
    route.steps.forEach((s, idx) => {
      const isLast = idx === route.steps.length - 1;
      const badgeClass = s.type === 'walk' ? 'badge-walk' : 'badge-ride';
      stepsHTML += `
        <div class="timeline-step">
          <div class="step-indicator">
            <span class="circle-dot ${s.type}"></span>
            ${!isLast ? `<span class="line-segment ${s.type}" style="border-color: ${s.type === 'ride' ? route.color : '#94a3b8'};"></span>` : ''}
          </div>
          <div class="step-details">
            <span class="step-desc">${s.desc}</span>
            <span class="step-badge ${badgeClass}">${s.mins} dk</span>
          </div>
        </div>
      `;
    });

    const card = document.createElement('div');
    card.className = 'transit-card';
    card.innerHTML = `
      <div class="transit-header-row">
        <div class="transit-title">
          <span class="transit-icon">${route.icon}</span>
          <strong>${route.label}</strong>
        </div>
        <span class="transit-time-badge">${route.duration} dk</span>
      </div>
      <div class="transit-schedule-row">
        Kalkış: <strong>${dep.timeStr}</strong> (${dep.wait} dk sonra)
      </div>
      
      <div class="route-timeline">
        ${stepsHTML}
      </div>

      <small class="provenance-label">${route.attribution}</small>
    `;

    card.addEventListener('click', () => {
      document.querySelectorAll('.transit-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      // v2-06: gerçek geometriyi (GTFS shapes) göster — düz-çizgi interpolasyonu kaldırıldı.
      // Hattı olmayan modlar (vapur/aktarma: operatör feed'i eksik) dürüstçe not + yürüme bacağı.
      TransitRoutes.showForFacility(facility);
    });

    container.appendChild(card);
    if (idx === 0) {
      firstCard = card;
    }
  });

  if (firstCard) {
    firstCard.click();
  } else {
    Routing.draw(origin, dest);
  }
};

// Turf-based Service Coverage Shadow Map Calculation
const calculateCoverageShadows = () => {
  if (!state.districtsGeoJSON || state.facilities.length === 0) return;

  try {
    const bufferPolygons = state.facilities.map(f => {
      const point = turf.point([f.koordinatlar[1], f.koordinatlar[0]]);
      return turf.buffer(point, 2.0, { units: 'kilometers' });
    });

    let unionBuffer = bufferPolygons[0];
    for (let i = 1; i < bufferPolygons.length; i++) {
      if (bufferPolygons[i]) {
        unionBuffer = turf.union(unionBuffer, bufferPolygons[i]);
      }
    }

    let istanbulPolygon = state.districtsGeoJSON.features[0];
    for (let i = 1; i < state.districtsGeoJSON.features.length; i++) {
      istanbulPolygon = turf.union(istanbulPolygon, state.districtsGeoJSON.features[i]);
    }

    const shadowPolygon = turf.difference(istanbulPolygon, unionBuffer);

    if (state.shadowsLayer) state.map.removeLayer(state.shadowsLayer);
    
    state.shadowsLayer = L.geoJSON(shadowPolygon, {
      style: {
        fillColor: '#1e293b',
        weight: 0.5,
        color: '#334155',
        fillOpacity: 0.35
      },
      interactive: false
    });

    if (state.showShadows) state.shadowsLayer.addTo(state.map);
  } catch (error) {
    console.error("Turf spatial buffer overlay calculation failed.", error);
  }
};

// OSRM Routing Engine & Fallback Line Rendering
const Routing = (() => {
  let activeRouteGroup = null;

  const clear = () => {
    if (activeRouteGroup && state.map) {
      state.map.removeLayer(activeRouteGroup);
      activeRouteGroup = null;
    }
  };

  const draw = async (start, end) => {
    clear();
    activeRouteGroup = L.layerGroup().addTo(state.map);

    const url = `https://router.projectosrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?geometries=geojson`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("OSRM driving route failed");
      const data = await res.json();
      
      if (data.routes && data.routes.length > 0) {
        const routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        L.polyline(routeCoords, {
          color: '#3b82f6',
          weight: 5,
          opacity: 0.85
        }).addTo(activeRouteGroup);
      } else {
        throw new Error("No routes");
      }
    } catch (e) {
      L.polyline([start, end], {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.7
      }).addTo(activeRouteGroup);
    }
  };

  const drawTransitRoute = async (start, end, routeType, routeColor) => {
    clear();
    activeRouteGroup = L.layerGroup().addTo(state.map);

    if (routeType === 'vapur') {
      const coords = interpolatePoints(start, end, 30);
      renderThreeSegments(coords, routeColor);
      return;
    }

    const url = `https://router.projectosrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?geometries=geojson`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("OSRM transit route failed");
      const data = await res.json();
      
      if (data.routes && data.routes.length > 0) {
        const routeCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        renderThreeSegments(routeCoords, routeColor);
      } else {
        throw new Error("No routes");
      }
    } catch (e) {
      const coords = interpolatePoints(start, end, 15);
      renderThreeSegments(coords, routeColor);
    }
  };

  const interpolatePoints = (p1, p2, steps = 10) => {
    const coords = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      coords.push([
        p1[0] + t * (p2[0] - p1[0]),
        p1[1] + t * (p2[1] - p1[1])
      ]);
    }
    return coords;
  };

  const renderThreeSegments = (coords, rideColor) => {
    const len = coords.length;
    if (len < 3) return;

    const idx1 = Math.max(1, Math.floor(len * 0.15));
    const idx2 = Math.max(idx1 + 1, Math.floor(len * 0.85));

    const walk1 = coords.slice(0, idx1 + 1);
    const ride = coords.slice(idx1, idx2 + 1);
    const walk2 = coords.slice(idx2);

    L.polyline(walk1, {
      color: '#94a3b8',
      weight: 3.5,
      opacity: 0.8,
      dashArray: '5, 8'
    }).addTo(activeRouteGroup);

    L.polyline(ride, {
      color: rideColor,
      weight: 5.5,
      opacity: 0.95
    }).addTo(activeRouteGroup);

    L.polyline(walk2, {
      color: '#94a3b8',
      weight: 3.5,
      opacity: 0.8,
      dashArray: '5, 8'
    }).addTo(activeRouteGroup);
  };

  return { draw, drawTransitRoute, clear };
})();

// ==========================================
// v2-06: TransitRoutes — GERÇEK hat geometrileri (GTFS shapes → slim GeoJSON)
// Düz-çizgi interpolasyonunun (Routing.drawTransitRoute) yerini alır. Çevrimdışı çalışır.
// Veri: data/transit-routes.geojson (build-routes.js üretir; ADR-006).
// ==========================================
const TransitRoutes = (() => {
  // build-routes.js ile senkron mod renkleri (dataviz paleti; ADR-006)
  const MODE_COLOR = { bus: '#2a78d6', metrobus: '#eb6834', ferry: '#1baf7a', rail: '#4a3aa7', walk: '#898781' };
  const MODE_LABEL = { bus: 'Otobüs', metrobus: 'Metrobüs', ferry: 'Vapur', rail: 'Raylı', walk: 'Yürüyüş' };
  const MODE_WEIGHT = { bus: 5, metrobus: 6, ferry: 5, rail: 5.5, walk: 3.5 };
  let group = null;      // aktif hat/yürüme katmanı
  let legend = null;     // Leaflet kontrol

  const load = async () => {
    try {
      const res = await fetch('data/transit-routes.geojson', { cache: 'no-cache' });
      if (!res.ok) throw new Error('transit-routes HTTP ' + res.status);
      state.transitRoutes = await res.json();
    } catch (e) {
      console.warn('[TransitRoutes] gerçek güzergah verisi yüklenemedi (offline mock?).', e);
      state.transitRoutes = null;
    }
  };

  // facility_index anahtarları "mode:ref" → eşleşen line feature'ları
  const linesForFacility = (facility) => {
    const gj = state.transitRoutes;
    if (!gj) return [];
    const keys = (gj.facility_index && gj.facility_index[facility.id]) || [];
    return gj.features.filter(f => f.properties.kind === 'line' && keys.includes(`${f.properties.mode}:${f.properties.ref}`));
  };
  const walkForFacility = (facility) => {
    const gj = state.transitRoutes;
    if (!gj) return null;
    return gj.features.find(f => f.properties.kind === 'walk' && f.properties.facility_id === facility.id) || null;
  };

  const clear = () => {
    if (group && state.map) { state.map.removeLayer(group); group = null; }
    if (legend && state.map) { state.map.removeControl(legend); legend = null; }
  };

  const renderLegend = (modesPresent, note) => {
    if (legend && state.map) state.map.removeControl(legend);
    legend = L.control({ position: 'topright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'transit-legend');
      let html = '<div class="transit-legend-title">Gerçek Güzergah</div>';
      modesPresent.forEach(m => {
        html += `<div class="transit-legend-row"><span class="transit-legend-swatch" style="background:${MODE_COLOR[m]}"></span>${MODE_LABEL[m] || m}</div>`;
      });
      if (note) html += `<div class="transit-legend-note">${note}</div>`;
      div.innerHTML = html;
      return div;
    };
    legend.addTo(state.map);
  };

  // Bir tesis için gerçek hat polyline'larını + yürüme bacağını çiz (moda göre renk).
  const showForFacility = (facility) => {
    clear();
    if (!state.transitRoutes) return;
    group = L.layerGroup().addTo(state.map);

    const lines = linesForFacility(facility);
    const walk = walkForFacility(facility);
    const modes = new Set();
    const bounds = [];

    lines.forEach(f => {
      const mode = f.properties.mode;
      modes.add(mode);
      const latlngs = f.geometry.coordinates.map(c => [c[1], c[0]]); // [lng,lat] → [lat,lng]
      L.polyline(latlngs, { color: f.properties.color, weight: MODE_WEIGHT[mode] || 5, opacity: 0.9, lineJoin: 'round' })
        .bindTooltip(`${MODE_LABEL[mode] || mode} ${f.properties.ref}`, { sticky: true })
        .addTo(group);
      latlngs.forEach(p => bounds.push(p));
    });

    if (walk) {
      modes.add('walk');
      const wl = walk.geometry.coordinates.map(c => [c[1], c[0]]);
      L.polyline(wl, { color: MODE_COLOR.walk, weight: MODE_WEIGHT.walk, opacity: 0.85, dashArray: '4, 8' })
        .bindTooltip(`Yürüyüş → ${walk.properties.stop_name} (${walk.properties.distance_m} m)`, { sticky: true })
        .addTo(group);
      wl.forEach(p => bounds.push(p));
    }

    // Dürüst not: hattı olmayan tesis (stop_times eksik veya operatör feed'i yok)
    const note = lines.length === 0
      ? 'Bu tesis için gerçek hat verisi yok (stop_times eksik / operatör feed\'i). Yürüme bacağı gerçektir.'
      : '';
    renderLegend([...modes], note);

    if (bounds.length > 1) state.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
  };

  return { load, showForFacility, linesForFacility, clear };
})();

// Geolocation
const requestUserLocation = (flyToUser = true) => {
  const dot = document.getElementById('location-dot');
  const txt = document.getElementById('location-status-text');
  
  if (dot) dot.className = 'location-status-dot orange';
  if (txt) txt.textContent = 'Canlı konum alınıyor...';

  const success = (position) => {
    state.userLocation.lat = position.coords.latitude;
    state.userLocation.lng = position.coords.longitude;
    state.userLocation.isMock = false;
    updateUserLocationUI('Senin Konumun (Canlı GPS)', 'green', flyToUser);
  };

  const error = () => {
    state.userLocation.lat = 41.037007; // Taksim
    state.userLocation.lng = 28.976273;
    state.userLocation.isMock = true;
    updateUserLocationUI('Senin Konumun (Taksim - Varsayılan)', 'blue', flyToUser);
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(success, error, { timeout: 5000 });
  } else {
    error();
  }
};

const updateUserLocationUI = (label, colorClass, flyToUser) => {
  const dot = document.getElementById('location-dot');
  const txt = document.getElementById('location-status-text');
  if (dot) dot.className = `location-status-dot ${colorClass}`;
  if (txt) txt.textContent = label;

  const coords = [state.userLocation.lat, state.userLocation.lng];
  
  if (state.userLocation.marker) {
    state.userLocation.marker.setLatLng(coords);
  } else {
    state.userLocation.marker = L.circleMarker(coords, {
      radius: 8,
      fillColor: getColorByStatus('primary', state.theme),
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 1
    }).addTo(state.map);
    
    state.userLocation.marker.bindTooltip('Senin Konumun', {
      permanent: true,
      direction: 'bottom',
      className: 'leaflet-tooltip-own',
      offset: [0, 8]
    });
  }

  // Update proximity lists using MatrixEngine vectorized KNN search
  const nearest = MatrixEngine.findNearestKNN(coords, state.facilities, 3);
  const container = document.getElementById('proximity-list');
  container.innerHTML = '';
  
  nearest.forEach(n => {
    const item = document.createElement('div');
    item.className = 'proximity-item';
    const distKm = (n.distance / 1000).toFixed(2);
    item.innerHTML = `
      <div style="font-weight: 600;">${n.target.ad}</div>
      <div style="font-size: 11px; opacity: 0.85;">Mesafe: ${distKm} km | Doluluk: %${n.target.dolulukOrani}</div>
    `;
    item.onclick = () => selectFacility(n.target);
    container.appendChild(item);
  });

  if (flyToUser) {
    state.map.setView(coords, 13);
  }
};

// USER RESERVATION ACTIONS
const submitReservation = async () => {
  const date = document.getElementById('reserve-date').value;
  const time = document.getElementById('reserve-time').value;
  const guests = document.getElementById('reserve-guests').value;
  const msg = document.getElementById('reservation-status-msg');

  msg.className = 'form-status-msg';
  msg.textContent = 'Rezervasyon oluşturuluyor...';

  try {
    const token = localStorage.getItem('session-token');
    const res = await fetch(`${API_BASE}/api/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        facilityId: state.selectedFacility.id,
        reserveDate: date,
        reserveTime: time,
        guests: parseInt(guests)
      })
    });

    const data = await res.json();
    if (res.ok) {
      msg.className = 'form-status-msg success';
      msg.textContent = `Rezervasyon başarıyla kaydedildi! Kripto İmza: ${data.crypto_signature.slice(0, 16)}...`;
      // Clear forms
      document.getElementById('reservation-form').reset();
      // Reload profile data
      Auth.loadProfile();
    } else {
      msg.className = 'form-status-msg error';
      msg.textContent = data.error || 'İşlem başarısız.';
    }
  } catch (e) {
    msg.className = 'form-status-msg error';
    msg.textContent = 'Sunucuyla bağlantı kurulamadı.';
  }
};

// ADMIN CRUD OPERATIONS
// slugify: tesis adından benzersiz bir 'kod' üretir (backend UNIQUE(kod) bekler; eski form
// bu alanı hiç göndermiyordu - Faz v2-07'de düzeltildi).
const slugifyFacilityCode = (name) => {
  const base = (name || 'TESIS')
    .toUpperCase()
    .replace(/[İIĞÜŞÖÇ]/g, c => ({ 'İ': 'I', 'I': 'I', 'Ğ': 'G', 'Ü': 'U', 'Ş': 'S', 'Ö': 'O', 'Ç': 'C' }[c] || c))
    .replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 12) || 'TESIS';
  return `${base}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
};

const submitAdminFacility = async () => {
  const name = document.getElementById('admin-name').value;
  const lat = parseFloat(document.getElementById('admin-lat').value);
  const lng = parseFloat(document.getElementById('admin-lng').value);
  const cap = parseInt(document.getElementById('admin-capacity').value);
  const occ = parseInt(document.getElementById('admin-occupancy').value);
  const isparkCapRaw = document.getElementById('admin-ispark-capacity').value;
  const isparkCapacity = isparkCapRaw ? parseInt(isparkCapRaw) : undefined;
  const iett = document.getElementById('admin-iett').value;
  const transit = document.getElementById('admin-transit-transfer').value;
  const route = document.getElementById('admin-route-description').value;
  const msg = document.getElementById('admin-form-status');
  const kod = slugifyFacilityCode(name);

  msg.className = 'form-status-msg';
  msg.textContent = 'Yeni tesis mekansal olarak kaydediliyor...';

  try {
    const token = localStorage.getItem('session-token');
    const res = await fetch(`${API_BASE}/api/facilities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        kod, ad: name, lat, lng, capacity: cap, occupancy: occ, isparkCapacity,
        iett_info: iett, transit_transfer: transit, route_description: route
      })
    });

    const data = await res.json();
    if (res.ok) {
      msg.className = 'form-status-msg success';
      msg.textContent = 'Yeni tesis veritabanına eklendi! Harita güncelleniyor...';
      document.getElementById('admin-facility-form').reset();

      // Reload everything
      await loadData();

      // Switch back to list
      setTimeout(() => switchSidebarView('list-view'), 1500);
    } else {
      msg.className = 'form-status-msg error';
      msg.textContent = data.error || 'Tesis eklenemedi.';
    }
  } catch (e) {
    console.warn('Create facility backend connection failed, falling back to local storage.', e);
    // Offline docs local storage fallback (dashboard/order.js ile aynı çift-mod deseni)
    const localFacs = JSON.parse(localStorage.getItem(MOCK_FACILITIES_KEY)) || state.facilities;
    const newId = (localFacs.reduce((m, f) => Math.max(m, f.id), 0) || 0) + 1;
    const newFac = {
      id: newId, kod, ad: name, adres: null,
      koordinatlar: [lat, lng], kapasite: cap, dolulukOrani: occ || 0,
      transit: { otobus: iett || 'Mevcut Değil', vapur: 'Mevcut Değil', aktarma: transit || 'Mevcut Değil', arabayla: route || 'Mevcut Değil' }
    };
    localFacs.push(newFac);
    localStorage.setItem(MOCK_FACILITIES_KEY, JSON.stringify(localFacs));
    state.facilities = localFacs;
    mockAuditLog('facility.create', 'facility', newId, { kod, ad: name, isparkCapacity: isparkCapacity || null });

    msg.className = 'form-status-msg success';
    msg.textContent = 'Yeni tesis yerel olarak kaydedildi (Offline Mod).';
    document.getElementById('admin-facility-form').reset();
    renderStats();
    renderFacilityList();
    renderFacilityMarkers();
    calculateCoverageShadows();
    setTimeout(() => switchSidebarView('list-view'), 1500);
  }
};

// Admin: doluluk hızlı-düzenleme (Faz v2-07, ADR-003 gap kapanışı - PATCH ucu zaten vardı, UI yoktu)
const updateSelectedFacilityOccupancy = async () => {
  const f = state.selectedFacility;
  const msgEl = document.getElementById('admin-occupancy-msg');
  if (!f) return;
  const val = parseInt(document.getElementById('admin-occupancy-input').value);
  if (!Number.isInteger(val) || val < 0 || val > 100) {
    msgEl.className = 'form-status-msg mini error';
    msgEl.textContent = '0-100 arası tamsayı girin.';
    return;
  }
  msgEl.className = 'form-status-msg mini';
  msgEl.textContent = 'Güncelleniyor...';
  try {
    const token = localStorage.getItem('session-token');
    const res = await fetch(`${API_BASE}/api/facilities/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ occupancy: val })
    });
    if (!res.ok) throw new Error('PATCH başarısız');
    await loadData();
    const updated = state.facilities.find(x => x.id === f.id);
    if (updated) selectFacility(updated);
    msgEl.className = 'form-status-msg mini success';
    msgEl.textContent = 'Doluluk güncellendi.';
  } catch (e) {
    console.warn('Occupancy update backend connection failed, falling back to local storage.', e);
    const localFacs = JSON.parse(localStorage.getItem(MOCK_FACILITIES_KEY)) || state.facilities;
    const target = localFacs.find(x => x.id === f.id);
    if (target) target.dolulukOrani = val;
    localStorage.setItem(MOCK_FACILITIES_KEY, JSON.stringify(localFacs));
    state.facilities = localFacs;
    mockAuditLog('facility.update', 'facility', f.id, { occupancy_after: val });
    const updated = state.facilities.find(x => x.id === f.id);
    if (updated) selectFacility(updated);
    msgEl.className = 'form-status-msg mini success';
    msgEl.textContent = 'Doluluk yerel olarak güncellendi (Offline Mod).';
  }
};

// ==========================================
// Admin Gözetim: tüm tesislerdeki rezervasyon/sipariş listesi + durum değiştirme (Faz v2-07)
// ==========================================
const ORDER_STATUS_LABEL = { submitted: 'Beklemede', served: 'Servis Edildi', paid: 'Ödendi', cancelled: 'İptal', open: 'Açık' };
const ORDER_NEXT_ACTIONS = { submitted: [['served', 'Servis Edildi'], ['cancelled', 'İptal']], served: [['paid', 'Ödendi'], ['cancelled', 'İptal']] };
const money = (m) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format((m || 0) / 100);

const loadAdminOversight = async () => {
  const container = document.getElementById('admin-oversight-list');
  container.innerHTML = '<div class="admin-oversight-empty">Yükleniyor...</div>';
  let orders;
  try {
    const token = localStorage.getItem('session-token');
    const res = await fetch(`${API_BASE}/api/admin/orders`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error('admin/orders başarısız');
    orders = await res.json();
  } catch (e) {
    console.warn('Admin oversight backend connection failed, falling back to local storage.', e);
    const mockOrders = JSON.parse(localStorage.getItem(MOCK_ORDERS_KEY)) || [];
    const mockRes = JSON.parse(localStorage.getItem(MOCK_RESERVATIONS_KEY)) || [];
    const facs = state.facilities || [];
    orders = mockOrders.map(o => {
      const rv = mockRes.find(r => r.id === o.reservation_id) || {};
      const fac = facs.find(f => f.id === rv.facility_id);
      return { id: o.id, status: o.status, total_minor: o.total_minor, created_at: o.created_at,
        facility_name: fac ? fac.ad : `Tesis #${rv.facility_id}`, owner_username: rv.owner || '-' };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  renderAdminOversight(orders);
};

const renderAdminOversight = (orders) => {
  const container = document.getElementById('admin-oversight-list');
  if (!orders.length) { container.innerHTML = '<div class="admin-oversight-empty">Henüz sipariş yok.</div>'; return; }
  container.innerHTML = orders.map(o => {
    const actions = (ORDER_NEXT_ACTIONS[o.status] || []).map(([next, label]) =>
      `<button type="button" class="btn btn-secondary btn-xs" data-order-id="${o.id}" data-next-status="${next}">${label}</button>`
    ).join('');
    return `
      <div class="admin-oversight-row">
        <div class="admin-oversight-main">
          <strong>${o.facility_name}</strong>
          <span class="admin-oversight-owner">${o.owner_username}</span>
          <span class="order-status-badge status-${o.status}">${ORDER_STATUS_LABEL[o.status] || o.status}</span>
        </div>
        <div class="admin-oversight-sub">
          <span>${money(o.total_minor)}</span>
          <div class="admin-oversight-actions">${actions}</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('button[data-order-id]').forEach(btn => {
    btn.addEventListener('click', () => changeOrderStatus(Number(btn.dataset.orderId), btn.dataset.nextStatus));
  });
};

const changeOrderStatus = async (orderId, newStatus) => {
  try {
    const token = localStorage.getItem('session-token');
    const res = await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Durum güncellenemedi'); }
  } catch (e) {
    console.warn('Order status update backend connection failed, falling back to local storage.', e);
    const mockOrders = JSON.parse(localStorage.getItem(MOCK_ORDERS_KEY)) || [];
    const target = mockOrders.find(o => o.id === orderId);
    if (target) { target.status = newStatus; localStorage.setItem(MOCK_ORDERS_KEY, JSON.stringify(mockOrders)); }
    mockAuditLog('order.status_change', 'order', orderId, { to: newStatus });
  }
  await loadAdminOversight();
  await loadAdminAuditLog();
};

// Audit Log: append-only işlem kaydı görüntüleme (DDIA Böl. 11 - event log; ADR-007)
const loadAdminAuditLog = async () => {
  const container = document.getElementById('admin-audit-list');
  let rows;
  try {
    const token = localStorage.getItem('session-token');
    const res = await fetch(`${API_BASE}/api/admin/audit-log?limit=20`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error('admin/audit-log başarısız');
    rows = await res.json();
  } catch (e) {
    rows = (JSON.parse(localStorage.getItem(MOCK_AUDIT_LOG_KEY)) || []).slice(0, 20);
  }
  if (!rows.length) { container.innerHTML = '<div class="admin-oversight-empty">Henüz işlem kaydı yok.</div>'; return; }
  container.innerHTML = rows.map(r => {
    const when = new Date(r.created_at).toLocaleString('tr-TR');
    return `<div class="admin-audit-row"><strong>${r.actor_username}</strong> · ${r.action} · ${r.entity_type}#${r.entity_id} · <span class="admin-audit-time">${when}</span></div>`;
  }).join('');
};

// AUTHENTICATION MODULE (JWT Session Controls)
const Auth = (() => {
  let isRegister = false;

  const showLoginModal = () => {
    document.getElementById('login-modal').classList.remove('hidden');
  };

  const closeLoginModal = () => {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('auth-form').reset();
    document.getElementById('auth-modal-status').textContent = '';
  };

  const toggleAuthMode = () => {
    isRegister = !isRegister;
    document.getElementById('modal-auth-title').textContent = isRegister ? 'Yeni Hesap Oluştur' : 'Sisteme Giriş Yap';
    document.getElementById('auth-submit-btn').textContent = isRegister ? 'Kayıt Ol' : 'Giriş Yap';
    document.getElementById('auth-mode-toggle').textContent = isRegister ? 'Zaten hesabın var mı? Giriş Yap' : 'Hesabın yok mu? Kayıt Ol';
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    const user = document.getElementById('auth-username').value;
    const pass = document.getElementById('auth-password').value;
    const msg = document.getElementById('auth-modal-status');
    
    msg.className = 'form-status-msg';
    msg.textContent = 'Doğrulanıyor...';

    // v2-07 düzeltmesi: backend uçları /api/auth/register ve /api/auth/login'de (bkz. server.js);
    // eski URL'ler hiç eşleşmiyordu (404) - canlı backend'de giriş her zaman mock'a düşüyordu.
    const url = isRegister ? `${API_BASE}/api/auth/register` : `${API_BASE}/api/auth/login`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('session-token', data.token);
        localStorage.setItem('session-user', JSON.stringify(data.user));
        
        closeLoginModal();
        checkSession();
      } else {
        msg.className = 'form-status-msg error';
        msg.textContent = data.error || 'İşlem başarısız.';
      }
    } catch (err) {
      msg.className = 'form-status-msg error';
      msg.textContent = 'Sunucu bağlantı hatası.';
    }
  };

  const checkSession = () => {
    const token = localStorage.getItem('session-token');
    const userJson = localStorage.getItem('session-user');

    const anonymousPanel = document.getElementById('user-anonymous');
    const authenticatedPanel = document.getElementById('user-authenticated');
    const reserveOut = document.getElementById('reservation-logged-out');
    const reserveIn = document.getElementById('reservation-logged-in');
    const adminLink = document.getElementById('menu-admin-panel');
    const deleteBtn = document.getElementById('admin-delete-facility-btn');
    const occEditBox = document.getElementById('admin-occupancy-edit');

    if (token && userJson) {
      const user = JSON.parse(userJson);
      state.userSession = user;

      document.getElementById('user-display-name').textContent = user.username;

      anonymousPanel.classList.add('hidden');
      authenticatedPanel.classList.remove('hidden');
      reserveOut.classList.add('hidden');
      reserveIn.classList.remove('hidden');

      if (user.role === 'admin') {
        adminLink.classList.remove('hidden');
        if (deleteBtn) deleteBtn.classList.remove('hidden');
        if (occEditBox) occEditBox.classList.remove('hidden');
      } else {
        adminLink.classList.add('hidden');
        if (deleteBtn) deleteBtn.classList.add('hidden');
        if (occEditBox) occEditBox.classList.add('hidden');
      }
    } else {
      state.userSession = null;
      anonymousPanel.classList.remove('hidden');
      authenticatedPanel.classList.add('hidden');
      reserveOut.classList.remove('hidden');
      reserveIn.classList.add('hidden');
      adminLink.classList.add('hidden');
      if (deleteBtn) deleteBtn.classList.add('hidden');
      if (occEditBox) occEditBox.classList.add('hidden');
    }
  };

  const logout = () => {
    localStorage.removeItem('session-token');
    localStorage.removeItem('session-user');
    checkSession();
    switchSidebarView('list-view');
  };

  const showProfileModal = () => {
    if (!state.userSession) return;
    document.getElementById('profile-username-val').textContent = state.userSession.username;
    document.getElementById('profile-role-val').textContent = state.userSession.role === 'admin' ? 'Sistem Yöneticisi (Admin)' : 'Sistem Misafiri (Kullanıcı)';
    loadProfile();
    document.getElementById('profile-modal').classList.remove('hidden');
  };

  const closeProfileModal = () => {
    document.getElementById('profile-modal').classList.add('hidden');
  };

  const loadProfile = async () => {
    const tbody = document.getElementById('profile-reservations-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-table">Yükleniyor...</td></tr>';
    
    try {
      const token = localStorage.getItem('session-token');
      const res = await fetch(`${API_BASE}/api/reservations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      
      if (res.ok && data.length > 0) {
        tbody.innerHTML = '';
        data.forEach(r => {
          const row = document.createElement('tr');
          const truncSign = r.crypto_signature ? `${r.crypto_signature.slice(0, 18)}...` : '-';
          row.innerHTML = `
            <td><strong>${r.facility_name}</strong></td>
            <td>${r.reserve_date}</td>
            <td>${r.reserve_time}</td>
            <td>${r.guests} kişi</td>
            <td><code title="${r.crypto_signature}">${truncSign}</code></td>
          `;
          tbody.appendChild(row);
        });
      } else {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-table">Kayıtlı rezervasyonunuz bulunmamaktadır.</td></tr>';
      }
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-table error">Rezervasyonlar yüklenirken hata oluştu.</td></tr>';
    }
  };

  const openAdminPanel = () => {
    switchSidebarView('admin-view');
    loadAdminOversight();
    loadAdminAuditLog();
  };

  // Bind Form handlers
  document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);

  return {
    showLoginModal,
    closeLoginModal,
    toggleAuthMode,
    checkSession,
    logout,
    showProfileModal,
    closeProfileModal,
    openAdminPanel,
    loadProfile
  };
})();

const initDropdownBehavior = () => {
  const profilePill = document.querySelector('.user-profile-pill');
  const dropdown = document.querySelector('.dropdown-menu');
  if (!profilePill || !dropdown) return;

  let hideTimeout = null;

  const showDropdown = () => {
    if (hideTimeout) clearTimeout(hideTimeout);
    dropdown.classList.add('show');
  };

  const delayHideDropdown = () => {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      dropdown.classList.remove('show');
    }, 10000);
  };

  profilePill.addEventListener('mouseenter', showDropdown);
  profilePill.addEventListener('mouseleave', delayHideDropdown);
  
  profilePill.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains('show')) {
      dropdown.classList.remove('show');
    } else {
      showDropdown();
    }
  });
};

const clearShiftMarkers = () => {
  if (state.shiftStartMarker) {
    state.map.removeLayer(state.shiftStartMarker);
    state.shiftStartMarker = null;
  }
  if (state.shiftEndMarker) {
    state.map.removeLayer(state.shiftEndMarker);
    state.shiftEndMarker = null;
  }
  state.shiftStartCoords = null;
};

const handleShiftClick = (latlng) => {
  const coords = [latlng.lat, latlng.lng];
  
  if (!state.shiftStartCoords) {
    state.shiftStartCoords = coords;
    clearShiftMarkers();
    Routing.clear();
    TransitRoutes.clear();
    
    state.shiftStartMarker = L.circleMarker(coords, {
      radius: 8,
      fillColor: '#10b981',
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 1
    }).addTo(state.map).bindTooltip('Özel Rota Başlangıcı (Shift-Tık)').openTooltip();
  } else {
    const start = state.shiftStartCoords;
    state.shiftStartCoords = null;
    
    state.shiftEndMarker = L.circleMarker(coords, {
      radius: 8,
      fillColor: '#ef4444',
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 1
    }).addTo(state.map).bindTooltip('Özel Rota Bitişi (Shift-Tık)').openTooltip();
    
    // Display custom route metadata details in panel
    document.getElementById('detail-code').textContent = "ÖZEL ROTA";
    document.getElementById('detail-name').textContent = "İki Nokta Arası Özel Güzergah";
    document.getElementById('detail-capacity').textContent = "-";
    document.getElementById('detail-occupancy-percent').textContent = "-";
    document.getElementById('detail-occupancy-text').textContent = "Shift + Tıklama ile oluşturulmuş özel rota.";
    
    // Hide facility cards not related to routing
    document.getElementById('facility-menu-card').classList.add('hidden');
    document.getElementById('detail-ispark-card').classList.add('hidden');
    document.getElementById('detail-reservation-section').classList.add('hidden');
    document.getElementById('facility-weather-card').classList.add('hidden');

    const mockFacility = {
      id: "custom",
      ad: "Özel Rota",
      kod: "CUSTOM",
      koordinatlar: coords,
      transit: {
        otobus: "İETT Özel Güzergah Otobüs Hattı",
        vapur: "Özel Rota Vapur / Deniz Hattı",
        transit_transfer: "Raylı Sistem / Tramvay aktarmalı"
      }
    };
    
    const savedUserLocation = { ...state.userLocation };
    state.userLocation.lat = start[0];
    state.userLocation.lng = start[1];
    
    calculateTransitOptions(mockFacility);
    switchSidebarView('detail-view');
    
    state.userLocation = savedUserLocation;
  }
};

const autoFillTransitDetails = (lat, lng) => {
  let containingDistrictName = "İstanbul";
  
  if (state.districtsGeoJSON) {
    for (const f of state.districtsGeoJSON.features) {
      if (pointInPolygon(lng, lat, f.geometry)) {
        containingDistrictName = f.properties.name;
        break;
      }
    }
  }
  
  document.getElementById('admin-iett').value = `${containingDistrictName} Merkez Durağı (Hatlar: 99A, 55, 15F)`;
  document.getElementById('admin-transit-transfer').value = `Metro / Metrobüs -> ${containingDistrictName} aktarmalı`;
  document.getElementById('admin-route-description').value = `${containingDistrictName} sahil veya ana caddeleri üzerinden`;
};

const deleteSelectedFacility = async (facilityId) => {
  try {
    const token = localStorage.getItem('session-token');
    // v2-07 düzeltmesi: backend /api/facilities/:id (yol parametresi) bekliyor; eski ?id= sorgu
    // parametresi hiçbir zaman eşleşmiyordu (canlı backend'de silme her zaman başarısız oluyordu).
    const res = await fetch(`${API_BASE}/api/facilities/${facilityId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.ok) {
      alert("Tesis başarıyla silindi!");
      await loadData();
      switchSidebarView('list-view');
      Routing.clear();
      TransitRoutes.clear();
    } else {
      const data = await res.json();
      alert(data.error || "Tesis silinemedi.");
    }
  } catch (e) {
    console.warn("Delete facility backend connection failed, falling back to local storage.", e);
    // Offline docs local storage fallback
    let localFacs = JSON.parse(localStorage.getItem(MOCK_FACILITIES_KEY)) || state.facilities;
    localFacs = localFacs.filter(f => f.id !== facilityId);
    localStorage.setItem(MOCK_FACILITIES_KEY, JSON.stringify(localFacs));

    let localRes = JSON.parse(localStorage.getItem(MOCK_RESERVATIONS_KEY)) || [];
    localRes = localRes.filter(r => r.facility_id !== facilityId);
    localStorage.setItem(MOCK_RESERVATIONS_KEY, JSON.stringify(localRes));

    state.facilities = localFacs;
    mockAuditLog('facility.delete', 'facility', facilityId, {});
    alert("Tesis yerel olarak silindi (Offline Mod).");
    renderStats();
    renderFacilityList();
    renderFacilityMarkers();
    calculateCoverageShadows();
    switchSidebarView('list-view');
    Routing.clear();
    TransitRoutes.clear();
  }
};
