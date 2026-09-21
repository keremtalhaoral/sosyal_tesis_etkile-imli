/**
 * ibb-parse.js - İBB ham yanıtlarını normalize eden SAF ayrıştırıcılar (ADR-008).
 *
 * NEDEN AYRI DOSYA: bu fonksiyonlar ağa dokunmaz, dosya sistemine dokunmaz - sadece
 * ham metin/JSON alır, normalize nesne döndürür. Bu sayede İBB API'sine erişimi olmayan
 * bir ortamda bile FIXTURE ile test edilebilirler (test/fixtures/ibb/).
 *
 * TOLERANSLI OLMAK BİLİNÇLİ BİR KARAR: İBB uçlarının alan adlandırması sürümden sürüme
 * ve uçtan uca değişiyor (Latitude/Lat/YKOORDINATI, Data/data/Result...). Tek bir isme
 * bağlanmak, feed'in küçük bir revizyonunda ingest'i sessizce boş çıktı üretir hale
 * getirirdi. Bu yüzden her alan için bilinen adlar sırayla denenir ve HİÇBİRİ bulunamazsa
 * kayıt sessizce atlanmaz - `skipped` sayacına yazılır (bkz. build-transit.js raporu).
 */

// --- Ortak yardımcılar ------------------------------------------------------

/** Nesnede verilen adlardan İLK bulunanı döndürür (büyük/küçük harf duyarsız). */
const pick = (obj, names) => {
  if (!obj || typeof obj !== 'object') return undefined;
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

/**
 * Koordinat normalize. İETT verisinde iki bilinen bozukluk var:
 *   - virgül ondalık ayracı: "41,0191"          -> 41.0191
 *   - binlik ayraç kayması : "410.191.700.005"  -> 41.0191700005
 * (İkincisi ADR-006'da GTFS için de karşımıza çıkmıştı; aynı düzeltme.)
 */
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? '').trim();
  if (!s) return NaN;
  if (/^-?\d{1,3},\d+$/.test(s)) s = s.replace(',', '.');      // virgül ondalık
  if (/^-?\d{1,3}\.\d{3,}$/.test(s)) return parseFloat(s);      // zaten normal
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 3) return NaN;
  return parseFloat(`${digits.slice(0, 2)}.${digits.slice(2)}`);
};

/** İstanbul bbox - feed'de ülke geneli / bozuk koordinat gelirse eler. */
const inIstanbul = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat > 40.5 && lat < 41.9 && lng > 27.5 && lng < 30.2;

/** UTF-8 baytları Latin1 çözülmüşse geri çevir (İETT metinlerinde sık). */
const fixText = (s) => {
  if (!s || !/[ÃÂÄÅ]/.test(s)) return s || '';
  try {
    const back = Buffer.from(s, 'latin1').toString('utf8');
    return /�/.test(back) ? s : back;
  } catch { return s; }
};

/** Yanıt gövdesinden dizi çıkarır: {Data:[...]} | {data:[...]} | [...] | {Result:{...}} */
const toArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  const inner = pick(payload, ['Data', 'data', 'Result', 'result', 'Items', 'items', 'Lines', 'Stations']);
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === 'object') return toArray(inner);
  return [];
};

// --- Metro İstanbul (REST/JSON) ---------------------------------------------

/** GetLines -> [{ id, ref, name, color }] */
const parseMetroLines = (raw) => {
  const rows = toArray(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const out = [];
  let skipped = 0;
  for (const r of rows) {
    const id = pick(r, ['Id', 'LineId', 'LineID', 'Code']);
    const name = fixText(String(pick(r, ['Name', 'LineName', 'Title', 'Description']) ?? ''));
    if (id === undefined || !name) { skipped++; continue; }
    // "M2 Yenikapı - Hacıosman" -> ref "M2".  "T1 Kabataş..." -> "T1".  Marmaray özel.
    const m = name.match(/\b(M\d+[A-Z]?|T\d+|F\d+|TF\d+)\b/i);
    const ref = m ? m[1].toUpperCase() : (/marmaray/i.test(name) ? 'Marmaray' : name.split(/[\s-]/)[0]);
    out.push({ id: String(id), ref, name, color: pick(r, ['Color', 'LineColor', 'HexColor']) || null });
  }
  return { lines: out, skipped };
};

/** GetDirections -> [{ id, lineId, name }] */
const parseMetroDirections = (raw) => {
  const rows = toArray(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const out = [];
  let skipped = 0;
  for (const r of rows) {
    const id = pick(r, ['Id', 'DirectionId', 'DirectionID']);
    const lineId = pick(r, ['LineId', 'LineID', 'Line']);
    if (id === undefined || lineId === undefined) { skipped++; continue; }
    out.push({ id: String(id), lineId: String(lineId), name: fixText(String(pick(r, ['Name', 'Title', 'Description']) ?? '')) });
  }
  return { directions: out, skipped };
};

/**
 * GetStations -> [{ id, lineId, directionId, name, lat, lng, order }]
 * Sıra bilgisi (order) ÖNEMLİ: istasyonları hat boyunca doğru dizmek için gerekiyor.
 * Yoksa dizilim yanıltıcı bir zikzak çizgiye dönerdi.
 */
const parseMetroStations = (raw) => {
  const rows = toArray(typeof raw === 'string' ? JSON.parse(raw) : raw);
  const out = [];
  let skipped = 0;
  for (const r of rows) {
    const id = pick(r, ['Id', 'StationId', 'StationID']);
    const lineId = pick(r, ['LineId', 'LineID', 'Line']);
    const name = fixText(String(pick(r, ['Name', 'StationName', 'Title', 'Description']) ?? ''));
    const lat = num(pick(r, ['Latitude', 'Lat', 'YKoordinati', 'Y', 'lat']));
    const lng = num(pick(r, ['Longitude', 'Lng', 'Lon', 'XKoordinati', 'X', 'lng']));
    if (id === undefined || lineId === undefined || !name || !inIstanbul(lat, lng)) { skipped++; continue; }
    out.push({
      id: String(id), lineId: String(lineId),
      directionId: pick(r, ['DirectionId', 'DirectionID']) !== undefined ? String(pick(r, ['DirectionId', 'DirectionID'])) : null,
      name, lat, lng,
      order: Number(pick(r, ['Order', 'Sequence', 'StationOrder', 'SiraNo']) ?? out.length),
    });
  }
  return { stations: out, skipped };
};

// --- İETT (SOAP zarfı içinde JSON ya da XML) --------------------------------

/**
 * SOAP zarfından yararlı gövdeyi çıkarır. İETT .asmx uçları çoğunlukla JSON'u
 * <XxxResult> içine STRING olarak gömüyor; bazı metodlar düz XML döndürüyor.
 */
const unwrapSoap = (xml) => {
  const s = String(xml ?? '');
  const m = s.match(/<(\w*Result)>([\s\S]*?)<\/\1>/);
  if (!m) return { kind: 'raw', body: s };
  const body = m[2]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
  if (/^[[{]/.test(body)) {
    try { return { kind: 'json', body: JSON.parse(body) }; } catch { /* düz metne düş */ }
  }
  return { kind: 'xml', body };
};

/** XML'den <Tag>değer</Tag> çiftlerini kayıt kayıt çıkarır (basit, düz şemalar için). */
const xmlRecords = (xml, recordTag) => {
  const re = new RegExp(`<${recordTag}[^>]*>([\\s\\S]*?)</${recordTag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    const rec = {};
    const fre = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let f;
    while ((f = fre.exec(m[1]))) rec[f[1]] = f[2].trim();
    out.push(rec);
  }
  return out;
};

/**
 * HatDurakGuzergah yanıtı -> { ref, stops: [{name, lat, lng, order, direction}] }
 * Hat geometrisi bu uçta DURAK DİZİSİ olarak gelir; gerçek güzergah polyline'ı
 * ayrı bir alanda olabilir (varsa `path` olarak alınır, yoksa duraklardan çizilir).
 */
const parseIettLine = (ref, rawSoap) => {
  const un = unwrapSoap(rawSoap);
  let rows = [];
  if (un.kind === 'json') rows = toArray(un.body);
  else if (un.kind === 'xml') {
    // Bilinen kayıt etiketleri sırayla denenir.
    for (const tag of ['Table', 'DurakDetay_GYY', 'HatDurakGuzergah', 'Durak']) {
      rows = xmlRecords(un.body, tag);
      if (rows.length) break;
    }
  }

  const stops = [];
  let skipped = 0;
  for (const r of rows) {
    const name = fixText(String(pick(r, ['SDURAKADI', 'DurakAdi', 'StopName', 'Name', 'DURAKADI']) ?? ''));
    const lat = num(pick(r, ['YKOORDINATI', 'Lat', 'Latitude', 'Y', 'ENLEM']));
    const lng = num(pick(r, ['XKOORDINATI', 'Lng', 'Longitude', 'X', 'BOYLAM']));
    if (!name || !inIstanbul(lat, lng)) { skipped++; continue; }
    stops.push({
      name, lat, lng,
      order: Number(pick(r, ['SIRANO', 'Sira', 'Order', 'Sequence']) ?? stops.length),
      direction: String(pick(r, ['SYON', 'Yon', 'Direction']) ?? ''),
    });
  }
  stops.sort((a, b) => a.order - b.order);
  return { ref, stops, skipped, sourceKind: un.kind };
};

module.exports = {
  parseMetroLines, parseMetroDirections, parseMetroStations,
  parseIettLine, unwrapSoap, xmlRecords,
  num, fixText, inIstanbul, pick, toArray,
};
