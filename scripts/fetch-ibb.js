#!/usr/bin/env node
/**
 * fetch-ibb.js - İBB açık veri uçlarından HAM yanıtları çeker ve önbelleğe yazar (ADR-008).
 *
 * BU, PROJEDE AĞA DOKUNAN TEK DOSYADIR. Tasarım ADR-006'daki ham-GTFS desenini izler:
 *   ham veri  -> data/ibb-cache/   (GITIGNORED; büyük, üçüncü taraf, yeniden indirilebilir)
 *   türetilmiş -> docs/data/transit-routes.geojson  (COMMIT EDİLİR; site çevrimdışı çalışır)
 * Böylece GitHub Pages hiçbir zaman canlı API'ye bağımlı olmaz; site açılışı üçüncü bir
 * tarafın uptime'ına ve rate limitine emanet edilmez.
 *
 * ÇEKİLEN UÇLAR (neden bunlar, neden diğerleri değil: ADR-008)
 *   metro-lines      GET  MetroIstanbul/api/MetroMobile/V2/GetLines
 *   metro-stations   GET  MetroIstanbul/api/MetroMobile/V2/GetStations
 *   metro-directions GET  MetroIstanbul/api/MetroMobile/V2/GetDirections
 *   iett-routes      SOAP iett/UlasimAnaVeri/HatDurakGuzergah.asmx  (hat -> durak + güzergah)
 *   iett-schedule    SOAP iett/UlasimAnaVeri/PlanlananSeferSaati.asmx (planlanan sefer saati)
 *
 * Kullanım:
 *   node scripts/fetch-ibb.js                    # hepsi
 *   node scripts/fetch-ibb.js --only=metro       # yalnız Metro İstanbul uçları
 *   node scripts/fetch-ibb.js --only=iett        # yalnız İETT SOAP
 *   node scripts/fetch-ibb.js --lines=15,26A     # yalnız bu hatlar (İETT)
 *   node scripts/fetch-ibb.js --probe            # yalnız erişilebilirlik/şema keşfi
 *
 * ABONELİK ANAHTARI: bazı api.ibb.gov.tr uçları `Ocp-Apim-Subscription-Key` ister.
 * Varsa IBB_API_KEY env değişkeninden okunur; yoksa anahtarsız denenir ve 401/403
 * alınırsa DURUM RAPORLANIR (sessizce boş çıktı üretilmez).
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const CACHE_DIR = path.join(REPO, 'data', 'ibb-cache');
const SEED = path.join(REPO, 'data', 'seed.json');

const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};
const has = (name) => process.argv.includes(`--${name}`);

const ONLY = arg('only', 'all');
const PROBE = has('probe');
const TIMEOUT_MS = Number(arg('timeout', '30000'));
const RETRIES = Number(arg('retries', '3'));

const API_KEY = process.env.IBB_API_KEY || '';
const METRO_BASE = 'https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2';
const IETT_ROUTES = 'https://api.ibb.gov.tr/iett/UlasimAnaVeri/HatDurakGuzergah.asmx';
const IETT_SCHEDULE = 'https://api.ibb.gov.tr/iett/UlasimAnaVeri/PlanlananSeferSaati.asmx';

const authHeaders = () => (API_KEY ? { 'Ocp-Apim-Subscription-Key': API_KEY, apikey: API_KEY } : {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Timeout + üstel geri çekilmeli retry. 4xx'te retry YOK (yeniden denemek düzeltmez). */
async function request(url, { method = 'GET', headers = {}, body } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        err.status = res.status;
        err.body = text.slice(0, 500);
        // 403'ün İKİ farklı sebebi olabilir ve tavsiye tamamen farklı:
        //   (a) İBB "abonelik anahtarı gerekli" diyor      -> IBB_API_KEY al
        //   (b) ARADAKİ proxy/güvenlik duvarı engelliyor   -> ağ politikası, anahtar çözmez
        // İkisini karıştırmak kullanıcıyı boş yere anahtar aramaya yollar.
        if (/not in allowlist|egress|proxy|blocked by|forbidden by policy/i.test(text)) {
          err.networkPolicy = true;
        }
        if (res.status >= 400 && res.status < 500) throw err; // retry etme
        lastErr = err;
      } else {
        return { status: res.status, text, contentType: res.headers.get('content-type') || '' };
      }
    } catch (e) {
      lastErr = e;
      if (e.status && e.status >= 400 && e.status < 500) break;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < RETRIES) await sleep(1000 * 2 ** (attempt - 1));
  }
  throw lastErr;
}

/** SOAP 1.1 zarfı. İETT .asmx servisleri klasik SOAP bekler. */
const soapEnvelope = (action, params) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${action} xmlns="http://tempuri.org/">
${Object.entries(params).map(([k, v]) => `      <${k}>${String(v).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</${k}>`).join('\n')}
    </${action}>
  </soap:Body>
</soap:Envelope>`;

const soapCall = (endpoint, action, params) => request(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `http://tempuri.org/${action}`, ...authHeaders() },
  body: soapEnvelope(action, params),
});

const write = (name, content) => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, name);
  fs.writeFileSync(file, content);
  const kb = (Buffer.byteLength(content) / 1024).toFixed(1);
  console.log(`  ✓ ${name} (${kb} KB)`);
  return file;
};

/** Tesislerin seed'deki serbest-metin transit alanlarından hat kodlarını çıkarır. */
const neededBusLines = () => {
  const facilities = JSON.parse(fs.readFileSync(SEED, 'utf8')).facilities || [];
  const set = new Set();
  for (const f of facilities) {
    (f.iett_info || '').replace(/\([^)]*\)/g, ' ').split(',')
      .map((x) => x.trim())
      .filter((x) => x && x !== 'Mevcut Değil')
      .forEach((ref) => set.add(ref));
  }
  return [...set];
};

const results = { ok: [], failed: [] };
const record = (name, fn) => fn().then(
  (v) => { results.ok.push(name); return v; },
  (e) => {
    results.failed.push({ name, reason: e.status ? `HTTP ${e.status}` : e.message, networkPolicy: !!e.networkPolicy });
    console.error(`  ✗ ${name}: ${e.status ? `HTTP ${e.status}` : e.message}`);
    if (e.body) console.error(`     yanıt: ${e.body.replace(/\s+/g, ' ').slice(0, 200)}`);
    return null;
  }
);

(async () => {
  console.log(`[ibb] Önbellek: ${path.relative(REPO, CACHE_DIR)}`);
  console.log(`[ibb] Abonelik anahtarı: ${API_KEY ? 'VAR (IBB_API_KEY)' : 'YOK - anahtarsız deneniyor'}`);
  if (PROBE) console.log('[ibb] --probe: yalnız erişilebilirlik ve şema keşfi, dosya yazılmayacak.\n');

  // --- Metro İstanbul (REST/JSON) -------------------------------------------
  if (ONLY === 'all' || ONLY === 'metro') {
    console.log('\n[ibb] Metro İstanbul (REST):');
    for (const [name, ep] of [['metro-lines', 'GetLines'], ['metro-stations', 'GetStations'], ['metro-directions', 'GetDirections']]) {
      await record(name, async () => {
        const r = await request(`${METRO_BASE}/${ep}`, { headers: { Accept: 'application/json', ...authHeaders() } });
        if (PROBE) {
          const preview = r.text.slice(0, 400).replace(/\s+/g, ' ');
          console.log(`  ✓ ${name}: ${r.contentType}, ${(r.text.length / 1024).toFixed(1)} KB`);
          console.log(`     ${preview}…`);
          return r;
        }
        // Geçerli JSON mu? Değilse ham metni yine de sakla ki ayrıştırıcı ayarlanabilsin.
        try { JSON.parse(r.text); } catch { console.warn(`     (uyarı: ${name} geçerli JSON değil, ham saklanıyor)`); }
        write(`${name}.json`, r.text);
        return r;
      });
    }
  }

  // --- İETT (SOAP/XML) -------------------------------------------------------
  if (ONLY === 'all' || ONLY === 'iett') {
    console.log('\n[ibb] İETT HatDurakGuzergah (SOAP):');
    const lines = arg('lines') ? arg('lines').split(',').map((x) => x.trim()).filter(Boolean) : neededBusLines();
    console.log(`  ${lines.length} hat kodu için sorgulanacak: ${lines.slice(0, 12).join(', ')}${lines.length > 12 ? ' …' : ''}`);

    // Metod adları feed sürümüne göre değişebiliyor; sırayla denenir, ilk çalışan kullanılır.
    const CANDIDATES = ['GetHat_json', 'GetHat', 'DurakDetay_GYY_json', 'GetHatDurakGuzergah'];
    let working = null;

    for (const action of CANDIDATES) {
      try {
        const r = await soapCall(IETT_ROUTES, action, { HatKodu: lines[0] || '15' });
        if (/soap:Fault|<faultstring>/i.test(r.text)) {
          const fault = (r.text.match(/<faultstring>([^<]*)<\/faultstring>/i) || [, '?'])[1];
          console.log(`  – ${action}: SOAP Fault (${fault.slice(0, 80)})`);
          continue;
        }
        working = action;
        console.log(`  ✓ Çalışan metod bulundu: ${action}`);
        if (PROBE) console.log(`     ${r.text.slice(0, 400).replace(/\s+/g, ' ')}…`);
        break;
      } catch (e) {
        console.log(`  – ${action}: ${e.status ? `HTTP ${e.status}` : e.message}`);
      }
    }

    if (!working) {
      results.failed.push({ name: 'iett-routes', reason: 'çalışan SOAP metodu bulunamadı' });
      console.error('  ✗ iett-routes: denenen metodların hiçbiri yanıt vermedi.');
      console.error('     WSDL\'i inceleyip --probe ile metod adlarını doğrulayın:');
      console.error(`     curl -s "${IETT_ROUTES}?wsdl" | grep -o 'name="[A-Za-z_]*"' | sort -u`);
    } else if (!PROBE) {
      const collected = {};
      for (const line of lines) {
        try {
          const r = await soapCall(IETT_ROUTES, working, { HatKodu: line });
          collected[line] = r.text;
          await sleep(200); // nazik ol: ardışık istekleri seyrelt
        } catch (e) {
          console.error(`     ${line}: ${e.status ? `HTTP ${e.status}` : e.message}`);
        }
      }
      results.ok.push('iett-routes');
      write('iett-routes.json', JSON.stringify({ method: working, fetched_at: new Date().toISOString(), lines: collected }, null, 1));
    }

    console.log('\n[ibb] İETT PlanlananSeferSaati (SOAP):');
    await record('iett-schedule', async () => {
      const r = await soapCall(IETT_SCHEDULE, 'GetPlanlananSeferSaati_json', { HatKodu: lines[0] || '15' });
      if (PROBE) { console.log(`  ✓ ${r.text.slice(0, 300).replace(/\s+/g, ' ')}…`); return r; }
      write('iett-schedule.json', JSON.stringify({ fetched_at: new Date().toISOString(), sample: r.text }, null, 1));
      return r;
    });
  }

  // --- Özet ------------------------------------------------------------------
  console.log(`\n[ibb] Başarılı: ${results.ok.length} (${results.ok.join(', ') || '-'})`);
  if (results.failed.length) {
    console.log(`[ibb] Başarısız: ${results.failed.length}`);
    results.failed.forEach((f) => console.log(`   ${f.name}: ${f.reason}`));
    if (results.failed.some((f) => f.networkPolicy)) {
      console.log('\n[ibb] Engel ARADAKİ AĞDAN geliyor (proxy/güvenlik duvarı api.ibb.gov.tr\'yi');
      console.log('      izin listesine almamış). Bu bir yetki sorunu DEĞİL - abonelik anahtarı');
      console.log('      almak çözmez. Bu makineyi/ağı api.ibb.gov.tr\'ye açın ya da script\'i');
      console.log('      erişimi olan bir ortamda çalıştırın.');
    } else if (results.failed.some((f) => /40[13]/.test(f.reason))) {
      console.log('\n[ibb] 401/403 alındı → bu uçlar abonelik anahtarı istiyor olabilir.');
      console.log('      https://api.ibb.gov.tr adresinden anahtar alıp IBB_API_KEY olarak verin.');
    }
    // Kısmi başarı da işe yarar (ör. yalnız metro çekildi); tam başarısızlıkta hata kodu dön.
    if (!results.ok.length) process.exitCode = 1;
  }
  if (!PROBE && results.ok.length) {
    console.log('\n[ibb] Sonraki adım:  node scripts/build-transit.js');
  }
})().catch((err) => {
  console.error('[ibb] Beklenmedik hata:', err);
  process.exit(1);
});
