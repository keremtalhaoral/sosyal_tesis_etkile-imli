/**
 * security.js - JWT (HS256) ve rezervasyon imzası
 *
 * advanced-gis/security/crypto_signer.py ile bit-uyumludur: aynı secret, aynı algoritma,
 * aynı payload biçimi. Böylece iki servis aynı users tablosunu ve token'ları paylaşabilir
 * (merkezi veri, merkezi kimlik).
 */

const crypto = require('crypto');

// JWT secret ortam değişkeninden gelir. Üretimde (NODE_ENV=production) yoksa gürültülü hata;
// geliştirmede açıkça 'DEV-ONLY' etiketli sabit kullanılır (ADR-002 Karar 2).
const DEV_SECRET = 'DEV-ONLY-INSECURE-SECRET-do-not-use-in-production';
const resolveSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET ortam değişkeni üretimde zorunludur (güvenlik).');
  }
  console.warn('[security] JWT_SECRET set edilmemiş - DEV-ONLY sabit kullanılıyor. Üretimde ASLA.');
  return DEV_SECRET;
};
const JWT_SECRET = Buffer.from(resolveSecret());

const TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 saat

const base64urlEncode = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const base64urlDecode = (str) =>
  Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const signJwt = (userData) => {
  const now = Math.floor(Date.now() / 1000);
  // iat = veriliş anı, exp = son kullanma. Çalınan token sonsuza dek geçerli olmasın (ADR-002 Karar 3).
  const claims = { ...userData, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64urlEncode(JSON.stringify(claims));
  const signature = base64urlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
};

const verifyJwt = (token) => {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expected = base64urlEncode(
      crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
    );
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null; // imza geçersiz
    const claims = JSON.parse(base64urlDecode(payload).toString('utf8'));
    if (claims.exp && Math.floor(Date.now() / 1000) >= claims.exp) return null; // süresi geçmiş
    return claims;
  } catch {
    return null;
  }
};

const signReservation = (userId, facilityId, reserveDate, reserveTime, guests) =>
  crypto.createHmac('sha256', JWT_SECRET)
    .update(`${userId}:${facilityId}:${reserveDate}:${reserveTime}:${guests}`)
    .digest('hex');

// Sipariş bütünlük imzası: kullanıcı + rezervasyon + tutar + kalemler (menuItemId:qty).
const signOrder = (userId, reservationId, totalMinor, items) => {
  const itemsStr = items.map(i => `${i.menuItemId}x${i.quantity}`).join(',');
  return crypto.createHmac('sha256', JWT_SECRET)
    .update(`${userId}:${reservationId}:${totalMinor}:${itemsStr}`)
    .digest('hex');
};

module.exports = { signJwt, verifyJwt, signReservation, signOrder };
