/**
 * geo.js - İlçe sınır geometrisini GeoJSON'dan PostGIS'e yükler.
 *
 * Hem CLI (scripts/load-geo.js) hem testler (test-helper) buradan çağırır - yükleme mantığı
 * tek yerde durur, ikisi ayrışamaz.
 *
 * Geometri neden seed.json'da değil: 3.7MB'lık ilçe sınırı GeoJSON kendi dosyasında yaşıyor
 * ve GitHub Pages arayüzü de AYNI dosyayı doğrudan okuyor (tek kanonik kopya). Bu yüzden
 * migration'a gömülmez; ayrı, tekrar çalıştırılabilir bir yükleme adımıdır.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_GEOJSON = path.join(__dirname, '..', 'docs', 'data', 'istanbul-districts.geojson');
const DEFAULT_POPULATION = 150000; // nüfusu seed'de olmayan ilçe için (eski davranışla aynı)

/**
 * @param {{run:Function, one:Function}} conn - database.js wrap() arayüzü
 * @param {string} [file] - GeoJSON yolu
 * @returns {{features:number, skipped:number}}
 */
const loadDistrictGeometry = async (conn, file = DEFAULT_GEOJSON) => {
  if (!fs.existsSync(file)) throw new Error(`GeoJSON bulunamadı: ${file}`);
  const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const features = gj.features || [];
  if (!features.length) throw new Error('GeoJSON boş - yüklenecek ilçe yok.');

  let loaded = 0, skipped = 0;
  for (const f of features) {
    const name = f.properties && f.properties.name;
    if (!name || !f.geometry) { skipped++; continue; }
    // Polygon/MultiPolygon karışık gelebilir; kolon MultiPolygon olduğu için ST_Multi ile
    // normalize ediyoruz. ST_MakeValid bozuk halkaları onarır (gerçek idari sınır verisinde
    // kendini kesen poligon sık görülür).
    await conn.run(`
      INSERT INTO districts (name, population, geom)
      VALUES ($1, $2, ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))))
      ON CONFLICT (name) DO UPDATE SET geom = EXCLUDED.geom
    `, [name, DEFAULT_POPULATION, JSON.stringify(f.geometry)]);
    loaded++;
  }
  return { features: loaded, skipped };
};

module.exports = { loadDistrictGeometry, DEFAULT_GEOJSON };
