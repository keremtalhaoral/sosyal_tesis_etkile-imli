/**
 * security.js - JWT (HS256) ve rezervasyon imzası
 *
 * advanced-gis/security/crypto_signer.py ile bit-uyumludur: aynı secret, aynı algoritma,
 * aynı payload biçimi. Böylece iki servis aynı users tablosunu ve token'ları paylaşabilir
 * (merkezi veri, merkezi kimlik).
 */

const crypto = require('crypto');

const JWT_SECRET = Buffer.from(process.env.JWT_SECRET || 'netcad_gis_crypto_key_2026_secure');

const base64urlEncode = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const base64urlDecode = (str) =>
  Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const signJwt = (userData) => {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64urlEncode(JSON.stringify(userData));
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
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return JSON.parse(base64urlDecode(payload).toString('utf8'));
  } catch {
    return null;
  }
};

const signReservation = (userId, facilityId, reserveDate, reserveTime, guests) =>
  crypto.createHmac('sha256', JWT_SECRET)
    .update(`${userId}:${facilityId}:${reserveDate}:${reserveTime}:${guests}`)
    .digest('hex');

module.exports = { signJwt, verifyJwt, signReservation };
