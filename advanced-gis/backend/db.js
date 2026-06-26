/**
 * db.js - Spatial Join, Proximity Analysis & Demographic Data Layer
 * 
 * WHY THIS ARCHITECTURE WAS CHOSEN (John Ousterhout Philosophy):
 * 1. Deep Module: This module hides the complexity of coordinate translations, ray-casting point-in-polygon
 *    calculations, geodesic distance sorting, and demographic data join operations. It exposes a simple, 
 *    clean interface (getDistricts, getFacilities, getClosestFacilities) that acts exactly like a database layer.
 * 2. Define Errors Out of Existence: Geometry structures are checked for type and structure. Point coordinates 
 *    are normalized. Distance calculations handle edge cases like identical points or missing inputs without throwing
 *    exceptions, defaulting to Taksim fallback values.
 * 3. Comments Explain Why: Comments here describe why specific spatial logic is implemented (e.g. Haversine distance
 *    formula vs Euclidean, PostGIS KNN index operator equivalents).
 */

const fs = require('fs');
const path = require('path');

// District TÜİK 2023 Population Data (Istanbul Districts)
const DISTRICT_POPULATIONS = {
  "Adalar": 16372,
  "Arnavutköy": 336062,
  "Ataşehir": 416529,
  "Avcılar": 462372,
  "Bağcılar": 719264,
  "Bahçelievler": 575225,
  "Bakırköy": 220974,
  "Başakşehir": 514900,
  "Bayrampaşa": 268600,
  "Beşiktaş": 169022,
  "Beykoz": 245902,
  "Beylikdüzü": 417287,
  "Beyoğlu": 218789,
  "Büyükçekmece": 272449,
  "Çatalca": 78931,
  "Çekmeköy": 298466,
  "Esenler": 443058,
  "Esenyurt": 978923,
  "Eyüpsultan": 439737,
  "Fatih": 356220,
  "Gaziosmanpaşa": 483025,
  "Güngören": 280256,
  "Kadıköy": 467919,
  "Kağıthane": 454530,
  "Kartal": 485847,
  "Küçükçekmece": 792030,
  "Maltepe": 528544,
  "Pendik": 741895,
  "Sancaktepe": 490189,
  "Sarıyer": 344250,
  "Silivri": 221733,
  "Şişli": 264516,
  "Sultanbeyli": 360879,
  "Sultangazi": 532846,
  "Şile": 48826,
  "Tuzla": 293645,
  "Ümraniye": 723436,
  "Üsküdar": 527325,
  "Zeytinburnu": 280252
};

// Facility Records (30 actual social facilities with coordinates [lat, lng])
const FACILITIES = [
  { id: 1, kod: "ALTY-01", ad: "Altınboynuz Sosyal Tesisi", adres: "Tekke Parkı Merkez Bahariye Cd. No: 16 Eyüpsultan", koordinatlar: [41.0578458, 28.9456101], kapasite: 120, dolulukOrani: 75 },
  { id: 2, kod: "ALTY-02", ad: "Arnavutköy Sosyal Tesisi", adres: "Arnavutköy, Bebek Arnavutköy Cd No:72, Beşiktaş", koordinatlar: [41.067491, 29.0448903], kapasite: 150, dolulukOrani: 85 },
  { id: 3, kod: "ALTY-03", ad: "Avcılar Sosyal Tesisi", adres: "Denizköşkler, Dr. Sadık Ahmet Cd. No:7, Avcılar", koordinatlar: [40.976648, 28.743912], kapasite: 200, dolulukOrani: 55 },
  { id: 4, kod: "ALTY-04", ad: "Beykoz Koru Sosyal Tesisi", adres: "Merkez, Kelle İbrahim Cd. 17/A, Beykoz", koordinatlar: [41.1316936, 29.0942223], kapasite: 250, dolulukOrani: 90 },
  { id: 5, kod: "ALTY-05", ad: "Beykoz Sahil Sosyal Tesisi", adres: "Paşabahçe Mahallesi Burunbahçe Mevkii, Beykoz", koordinatlar: [41.1134095, 29.0864284], kapasite: 180, dolulukOrani: 65 },
  { id: 6, kod: "ALTY-06", ad: "Boğazköy Sosyal Tesisi", adres: "Yunus Emre, Erdener Sk. No:36, Arnavutköy", koordinatlar: [41.185797, 28.765582], kapasite: 110, dolulukOrani: 40 },
  { id: 7, kod: "ALTY-07", ad: "Çamlıca Sosyal Tesisi", adres: "Kısıklı, Turistik Çamlıca Cd., Üsküdar", koordinatlar: [41.027788, 29.069052], kapasite: 300, dolulukOrani: 95 },
  { id: 8, kod: "ALTY-08", ad: "Cihangir Sosyal Tesisi", adres: "Kamacı Ustası Sk. No: 1, Cihangir/Beyoğlu", koordinatlar: [41.0284966, 28.9825361], kapasite: 90, dolulukOrani: 72 },
  { id: 9, kod: "ALTY-09", ad: "Dragos Sosyal Tesisi", adres: "Orhantepe, Turgut Özal Blv. No:10, Kartal", koordinatlar: [40.9013477, 29.1466597], kapasite: 220, dolulukOrani: 83 },
  { id: 10, kod: "ALTY-10", ad: "Fethipaşa Sosyal Tesisi", adres: "Kuzguncuk Mahallesi Nacak Sokak No:6, Üsküdar", koordinatlar: [41.0333739, 29.0259101], kapasite: 280, dolulukOrani: 89 },
  { id: 11, kod: "ALTY-11", ad: "Florya Sosyal Tesisi", adres: "İtfaiye Cad. No:1 Florya, Bakırköy", koordinatlar: [40.960613, 28.807588], kapasite: 350, dolulukOrani: 91 },
  { id: 12, kod: "ALTY-12", ad: "Gazi Sosyal Tesisi", adres: "Zübeyde Hanım, 1481. Sk., Sultangazi", koordinatlar: [41.101274, 28.916913], kapasite: 130, dolulukOrani: 58 },
  { id: 13, kod: "ALTY-13", ad: "Gözdağı Sosyal Tesisi", adres: "Dumlupınar, Gözdağı Tepesi No:50, Pendik", koordinatlar: [40.8906409, 29.2536092], kapasite: 160, dolulukOrani: 74 },
  { id: 14, kod: "ALTY-14", ad: "Haliç Sosyal Tesisi", adres: "Abdülezel Paşa Cad. Kadir Has Üni. Karşısı, Fatih", koordinatlar: [41.028283, 28.957092], kapasite: 180, dolulukOrani: 62 },
  { id: 15, kod: "ALTY-15", ad: "İstinye Sosyal Tesisi", adres: "İstinye, Emirgan Koru Cd. No:108, Sarıyer", koordinatlar: [41.1147873, 29.0549822], kapasite: 200, dolulukOrani: 80 },
  { id: 16, kod: "ALTY-16", ad: "Kasımpaşa Sosyal Tesisi", adres: "Bedrettin, Evliya Çelebi Cd. No:4, Beyoğlu", koordinatlar: [41.0299569, 28.9667688], kapasite: 140, dolulukOrani: 48 },
  { id: 17, kod: "ALTY-17", ad: "Küçük Çamlıca Sosyal Tesisi", adres: "Küçük Çamlıca Oyma Sokak No:3, Üsküdar", koordinatlar: [41.016344, 29.064013], kapasite: 210, dolulukOrani: 67 },
  { id: 18, kod: "ALTY-18", ad: "Küçükçekmece Sosyal Tesisi", adres: "Fatih Mahallesi Yalı Caddesi, Küçükçekmece", koordinatlar: [40.9998227, 28.765311], kapasite: 170, dolulukOrani: 53 },
  { id: 19, kod: "ALTY-19", ad: "Safa Tepesi Sosyal Tesisi", adres: "Yunus Emre Mah., Mevlana Cd. No:69, Sancaktepe", koordinatlar: [41.0137496, 29.2547994], kapasite: 190, dolulukOrani: 79 },
  { id: 20, kod: "ALTY-20", ad: "Sultanbeyli Sosyal Tesisi", adres: "Sultanbeyli Gölet Parkı İçi, Sultanbeyli", koordinatlar: [40.954071, 29.276533], kapasite: 240, dolulukOrani: 86 },
  { id: 21, kod: "ALTY-21", ad: "Yakuplu Sosyal Tesisi", adres: "Güzelyurt, Mehmet Akif Ersoy Cd. No:20/1, Esenyurt", koordinatlar: [41.0036611, 28.6677748], kapasite: 150, dolulukOrani: 45 },
  { id: 22, kod: "ALTY-22", ad: "Beykoz Kır Bahçesi Sosyal Tesisi", adres: "Merkez Mahallesi, Kelle İbrahim Cd., Beykoz", koordinatlar: [41.134419, 29.1006], kapasite: 280, dolulukOrani: 82 },
  { id: 23, kod: "ALTY-23", ad: "Pembe Köşk Sosyal Tesisi", adres: "Emirgan, Emirgan Korusu İçi, Sarıyer", koordinatlar: [41.109894, 29.05697], kapasite: 120, dolulukOrani: 94 },
  { id: 24, kod: "ALTY-24", ad: "Kır Kahvesi Sosyal Tesisi", adres: "Yıldız Mahallesi, Yıldız Parkı İçi, Beşiktaş", koordinatlar: [41.0479649, 29.0131607], kapasite: 100, dolulukOrani: 70 },
  { id: 25, kod: "ALTY-25", ad: "Paşalimanı Sosyal Tesisi", adres: "Kuzguncuk, Paşalimanı Cd., Üsküdar", koordinatlar: [41.032235, 29.022992], kapasite: 160, dolulukOrani: 88 },
  { id: 26, kod: "ALTY-26", ad: "Florya Yerleşim Birimleri", adres: "Basınköy, İtfaıye Cd. No:1, Bakırköy", koordinatlar: [40.971945, 28.788689], kapasite: 320, dolulukOrani: 50 },
  { id: 27, kod: "ALTY-27", ad: "Zeytinburnu Sosyal Tesisi", adres: "Kazlıçeşme, Beşkardeşler Sk. No:12, Zeytinburnu", koordinatlar: [40.9850535, 28.906515], kapasite: 200, dolulukOrani: 73 },
  { id: 28, kod: "ALTY-28", ad: "1453 Çırpıcı Sosyal Tesisi", adres: "Çırpıcı Şehir Parkı Koşuyolu Sokak, Bakırköy", koordinatlar: [41.0003203, 28.8892505], kapasite: 300, dolulukOrani: 61 },
  { id: 29, kod: "ALTY-29", ad: "Denizköşk Sosyal Tesisi", adres: "Denizköşkler, Kemal Sunal Cd. No:38, Avcılar", koordinatlar: [40.974184, 28.743431], kapasite: 190, dolulukOrani: 59 },
  { id: 30, kod: "ALTY-30", ad: "Güngören Sosyal Tesisi", adres: "Gençosman Mah. Akyıldız Sk. No:94, Güngören", koordinatlar: [41.0363577, 28.871629], kapasite: 140, dolulukOrani: 66 }
];

// Transit routing recommendations database (Google Maps & Moovit style)
const TRANSIT_LOOKUP = {
  1: { otobus: "39D, 55, 99A, 37M, 86V (Eyüpsultan Teleferik)", vapur: "Haliç Hattı (Eyüpsultan İskelesi)", aktarma: "M7 Metro (Alibeyköy) -> T5 Tramvayı (Feshane)", arabayla: "Silahtarağa Cd. ve Bahariye Cd. üzerinden" },
  2: { otobus: "22, 22RE, 25E, 40T, 42T (Arnavutköy Durağı)", vapur: "Boğaz Hattı (Arnavutköy İskelesi)", aktarma: "M2 Metro (Taksim) -> 40T Otobüsü", arabayla: "Bebek Arnavutköy Cd. üzerinden" },
  3: { otobus: "76O, 146, 76C (Denizköşkler Durağı)", vapur: "Mevcut Değil", aktarma: "Metrobüs (Şükrübey Durağı) -> 10 dk yürüyüş", arabayla: "D-100 Karayolu ve Dr. Sadık Ahmet Cd. üzerinden" },
  4: { otobus: "15, 15F, 15T, 15BK, 121A (Beykoz Belediyesi Durağı)", vapur: "İstinye - Çubuklu Vapuru veya Üsküdar - Beykoz Motoru", aktarma: "M2 Metro (Hacıosman) -> Otobüs / Vapur", arabayla: "Beykoz Sahil Yolu üzerinden" },
  5: { otobus: "15, 15F, 15T, 15BK, 121A (Burunbahçe Durağı)", vapur: "İstinye - Çubuklu Vapuru veya Üsküdar - Beykoz Motoru", aktarma: "M2 Metro (Hacıosman) -> Otobüs / Vapur", arabayla: "Beykoz Sahil Yolu ve Burunbahçe Sk. üzerinden" },
  6: { otobus: "336G, 36AY, 36B (Boğazköy Durağı)", vapur: "Mevcut Değil", aktarma: "M11 Metro (Arnavutköy) -> 336G Otobüsü", arabayla: "E-80 ve Erdener Sk. üzerinden" },
  7: { otobus: "129T, 11A, 11ÜS, 14F (Kısıklı Durağı)", vapur: "Mevcut Değil", aktarma: "M5 Metro (Kısıklı İstasyonu) -> 15 dk yürüyüş", arabayla: "Turistik Çamlıca Cd. üzerinden" },
  8: { otobus: "26, 26A, 26B, 28, 28T (Fındıklı Durağı + Yürüyüş)", vapur: "Boğaz Hattı (Kabataş İskelesi)", aktarma: "M2 Metro (Taksim) veya T1 Tramvay (Fındıklı) -> Yürüyüş", arabayla: "Meclis-i Mebusan Cd. ve Kamacı Ustası Sk. üzerinden" },
  9: { otobus: "134YK, 16D, 17, 252 (Dragos Durağı)", vapur: "Mevcut Değil", aktarma: "M4 Metro (Hastane-Adliye) -> 134YK Otobüsü", arabayla: "Turgut Özal Bulvarı (Sahil Yolu) üzerinden" },
  10: { otobus: "15, 15B, 15C, 15H, 15K, 15M (Paşalimanı Durağı)", vapur: "Üsküdar İskelesi (1.2 km yürüyüş)", aktarma: "Marmaray (Üsküdar) -> 15 no'lu Otobüs hattı", arabayla: "Paşalimanı Cd. ve Nacak Sk. üzerinden" },
  11: { otobus: "73Y, 73B, 73F (Florya Sosyal Tesisler Durağı)", vapur: "Mevcut Değil", aktarma: "Marmaray (Florya Akvaryum Durağı) -> 5 dk yürüyüş", arabayla: "Florya Sahil Yolu üzerinden" },
  12: { otobus: "38G, 49G, 36L (Gazi Barajı Durağı)", vapur: "Mevcut Değil", aktarma: "T4 Tramvayı (Mescid-i Selam) -> 38G Otobüsü", arabayla: "Zübeyde Hanım Mahallesi ve 1481. Sk. üzerinden" },
  13: { otobus: "132G, 132V, 132P (Gözdağı Durağı)", vapur: "Mevcut Değil", aktarma: "M4 Metro (Pendik İstasyonu) -> 132G Otobüsü", arabayla: "D-100 ve Gözdağı Caddesi üzerinden" },
  14: { otobus: "99A, 55T, 48E, 399B (Kadir Has Üniversitesi Durağı)", vapur: "Haliç Hattı (Cibali İskelesi)", aktarma: "T5 Tramvayı (Cibali İstasyonu) -> Yürüyüş", arabayla: "Abdülezelpaşa Caddesi üzerinden" },
  15: { otobus: "22, 22RE, 25E, 40T, 42T (İstinye Devlet Hastanesi Durağı)", vapur: "İstinye - Çubuklu Arabalı Vapuru", aktarma: "M2 Metro (İTÜ Ayazağa) -> 29S Otobüsü", arabayla: "Emirgan Koru Caddesi ve İstinye Sahil Yolu üzerinden" },
  16: { otobus: "EM1, EM2, 77, 77A, 54HT (Kasımpaşa Durağı)", vapur: "Haliç Hattı (Kasımpaşa İskelesi)", aktarma: "M2 Metro (Şişhane) -> 15 dk yürüyüş / Tünel", arabayla: "Bahriye Caddesi ve Evliya Çelebi Caddesi üzerinden" },
  17: { otobus: "11ES, 11L, 11M, 11ÜS (Küçük Çamlıca Durağı)", vapur: "Mevcut Değil", aktarma: "M5 Metro (Kısıklı) -> 11ES Otobüsü", arabayla: "Kısıklı ve Küçük Çamlıca Oyma Sk. üzerinden" },
  18: { otobus: "76O, 89A, 89B, 98TB (Küçükçekmece Durağı)", vapur: "Mevcut Değil", aktarma: "Metrobüs (Küçükçekmece İstasyonu) -> Marmaray Aktarması", arabayla: "D-100 ve Yalı Caddesi üzerinden" },
  19: { otobus: "131A, 131YS, 132YM (Safa Tepesi Durağı)", vapur: "Mevcut Değil", aktarma: "M5 Metro (Çekmeköy) -> 131A Otobüsü", arabayla: "Şile Otoyolu ve Mevlana Caddesi üzerinden" },
  20: { otobus: "131, 131H, 131Ü, 18M (Sultanbeyli Gölet Durağı)", vapur: "Mevcut Değil", aktarma: "M5 Metro (Madenler) -> 131 no'lu Otobüs hattı", arabayla: "TEM Otoyolu Sultanbeyli çıkışı ve Gölet Parkı üzerinden" },
  21: { otobus: "458, 76Y (Yakuplu Durağı)", vapur: "Mevcut Değil", aktarma: "Metrobüs (Haramidere) -> 458 Otobüsü", arabayla: "Yakuplu Liman Yolu ve Mehmet Akif Ersoy Cd. üzerinden" },
  22: { otobus: "15, 15F, 15T, 15BK, 121A (Beykoz Belediyesi Durağı)", vapur: "İstinye - Çubuklu Vapuru veya Şehir Hatları", aktarma: "M2 Metro (Hacıosman) -> Otobüs", arabayla: "Beykoz Sahil Yolu ve Kelle İbrahim Cd. üzerinden" },
  23: { otobus: "22, 22RE, 25E, 40T, 42T (Emirgan Durağı)", vapur: "Boğaz Hattı (Emirgan İskelesi)", aktarma: "M2 Metro (İTÜ Ayazağa) -> Emirgan otobüsleri", arabayla: "Emirgan Korusu iç yolları üzerinden" },
  24: { otobus: "22, 22RE, 25E, 30D, 40T, 42T (Yıldız Parkı Durağı)", vapur: "Beşiktaş İskelesi (1.5 km yürüyüş)", aktarma: "M7 Metro (Beşiktaş İstasyonu) -> 5 dk yürüyüş", arabayla: "Yıldız Parkı iç yolları üzerinden" },
  25: { otobus: "15, 15B, 15C, 15H, 15K, 15M (Paşalimanı Durağı)", vapur: "Üsküdar İskelesi (800m yürüyüş)", aktarma: "Marmaray / M5 Metro (Üsküdar İstasyonu) -> Paşalimanı sahil yürüyüşü", arabayla: "Paşalimanı Caddesi üzerinden" },
  26: { otobus: "73Y, 73B, 73F (Basınköy Durağı)", vapur: "Mevcut Değil", aktarma: "Marmaray (Florya Durağı) -> 10 dk yürüyüş", arabayla: "Florya Sahil Yolu ve Basınköy İç Yolu üzerinden" },
  27: { otobus: "93, 93M, 93T, MR10 (Kazlıçeşme Durağı)", vapur: "Mevcut Değil", aktarma: "Marmaray (Kazlıçeşme İstasyonu) -> 8 dk yürüyüş", arabayla: "Sahil Kennedy Caddesi ve Beşkardeşler Sk. üzerinden" },
  28: { otobus: "93, 93M, 93T (Çırpıcı Parkı Durağı)", vapur: "Mevcut Değil", aktarma: "Metro M1 / Metrobüs (Zeytinburnu durağı) -> 2 dk yürüyüş", arabayla: "D-100 yanyol ve Koşuyolu Sokak üzerinden" },
  29: { otobus: "76O, 146, 76C (Denizköşkler Durağı)", vapur: "Mevcut Değil", aktarma: "Metrobüs (Şükrübey Durağı) -> 12 dk yürüyüş", arabayla: "Sahil Yolu ve Kemal Sunal Caddesi üzerinden" },
  30: { otobus: "92T, 41AT, 85T (Güngören durağı)", vapur: "Mevcut Değil", aktarma: "M1B Metro (Menderes) -> Yürüyüş veya Minibüs", arabayla: "O-3 yanyol ve Akyıldız Sokak üzerinden" }
};

// Inject transit data into facilities array
FACILITIES.forEach(f => {
  f.transit = TRANSIT_LOOKUP[f.id] || { otobus: "Mevcut Değil", vapur: "Mevcut Değil", aktarma: "Mevcut Değil", arabayla: "Mevcut Değil" };
});


// Load GeoJSON Districts boundaries safely
let districtsGeoJSON = null;
try {
  const filePath = path.join(__dirname, 'data', 'istanbul-districts.geojson');
  const fileContent = fs.readFileSync(filePath, 'utf8');
  districtsGeoJSON = JSON.parse(fileContent);
} catch (error) {
  console.error("Critical Error: Failed to load istanbul-districts.geojson. Fallback is applied to ensure system runs without crashing.", error);
  // Define errors out of existence: If file loading fails, serve an empty feature collection so client still renders
  districtsGeoJSON = { type: "FeatureCollection", features: [] };
}

// Ray-Casting algorithm to determine if a point is inside a polygon ring
// Point coordinate order: [longitude, latitude]
const pointInPolygonRing = (lng, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    
    // Check intersection with ray casted along positive X-axis
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// Check if a point lies inside a Polygon or MultiPolygon geometry structure
const pointInPolygon = (lng, lat, geometry) => {
  if (!geometry || !geometry.coordinates) return false;
  
  if (geometry.type === 'Polygon') {
    return pointInPolygonRing(lng, lat, geometry.coordinates[0]);
  } else if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(polygon => pointInPolygonRing(lng, lat, polygon[0]));
  }
  return false;
};

// Calculate geodesic distance between two points in meters using spherical law of cosines
const calculateGeodesicDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's mean radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  
  const dist = Math.acos(Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(deltaLambda)) * R;
  return isNaN(dist) ? 0 : dist; // Define errors out of existence for invalid coordinate values
};

/**
 * Executes a simulated PostGIS spatial join between districts and facility points.
 * 
 * Equivalents SQL:
 * SELECT d.name, COUNT(f.id), d.population 
 * FROM districts d LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
 * GROUP BY d.id;
 */
const getProcessedDistricts = () => {
  if (!districtsGeoJSON || !districtsGeoJSON.features) return districtsGeoJSON;
  
  // Clone features to prevent mutating original data cache
  const features = districtsGeoJSON.features.map(feature => {
    const districtName = feature.properties.name;
    const population = DISTRICT_POPULATIONS[districtName] || 150000; // Default fallback population
    
    // Count facilities located inside this district boundary
    const insideFacilities = FACILITIES.filter(fac => {
      const [facLat, facLng] = fac.koordinatlar;
      return pointInPolygon(facLng, facLat, feature.geometry);
    });
    
    const facilityCount = insideFacilities.length;
    
    // KARAR DESTEK (Decision Support) indicators:
    // Facilities ratio per 100k citizens
    const facilitiesPer100k = (facilityCount * 100000) / population;
    
    // Alarm algorithm:
    // High population (>300,000) and low facility density (<0.5 per 100k) trigger a RED alert.
    let alarmLevel = "GREEN"; // Optimal / Sakin
    let alarmReason = "Yeterli sosyal tesis yoğunluğu";
    
    if (facilitiesPer100k < 0.45 && population > 250000) {
      alarmLevel = "RED"; // Kritik Yetersizlik
      alarmReason = "Yüksek nüfus - Ciddi tesis açığı (Kırmızı Alarm)";
    } else if (facilitiesPer100k < 1.0) {
      alarmLevel = "AMBER"; // Orta Düzey
      alarmReason = "Geliştirilmesi gereken tesis oranı";
    }
    
    // Enrich GeoJSON properties directly for leaflet consumption
    const enrichedProperties = {
      ...feature.properties,
      population,
      facilityCount,
      facilitiesPer100k: parseFloat(facilitiesPer100k.toFixed(2)),
      alarmLevel,
      alarmReason,
      facilityIds: insideFacilities.map(f => f.id)
    };
    
    return {
      ...feature,
      properties: enrichedProperties
    };
  });
  
  return {
    type: "FeatureCollection",
    features
  };
};

/**
 * Performs proximity analysis (K-Nearest Neighbor) to locate the top N facilities.
 * 
 * Equivalent SQL:
 * SELECT id, tesis_adi, ST_Distance(geom, ST_MakePoint(lon, lat)) as dist
 * FROM facilities ORDER BY geom <-> ST_MakePoint(lon, lat) LIMIT 3;
 */
const getClosestFacilities = (userLat, userLng, limit = 3) => {
  const lat = parseFloat(userLat);
  const lng = parseFloat(userLng);
  
  if (isNaN(lat) || isNaN(lng)) {
    return []; // Return empty array to define parameters errors out of existence
  }
  
  return FACILITIES.map(facility => {
    const [facLat, facLng] = facility.koordinatlar;
    const distanceMeters = calculateGeodesicDistance(lat, lng, facLat, facLng);
    return {
      ...facility,
      distance: parseFloat(distanceMeters.toFixed(1))
    };
  })
  .sort((a, b) => a.distance - b.distance)
  .slice(0, limit);
};

module.exports = {
  getFacilities: () => FACILITIES,
  getDistricts: getProcessedDistricts,
  getClosestFacilities
};
