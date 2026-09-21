/**
 * ratelimit.js - Bellek-içi kayan pencere hız sınırlayıcı.
 *
 * NEDEN GEREKLİ: /api/auth/login sınırsız denenebiliyordu. İki ayrı risk:
 *   1. Kaba kuvvet - parola deneme sayısına üst sınır yok.
 *   2. CPU tüketme - her deneme 600.000 iterasyonlu PBKDF2 = ~100 ms CPU. Saniyede 10 istek
 *      gönderen biri sunucunun bir çekirdeğini tamamen doldurur. Parolayı bilmesine bile
 *      gerek yok; sadece istek göndermesi yeter. Hız sınırı burada güvenlikten çok
 *      ERİŞİLEBİLİRLİK önlemi.
 *
 * NEDEN `express-rate-limit` DEĞİL: tek süreçli bir uygulama için ~50 satırlık bir Map yeter.
 * Bağımlılık eklemek, onu güncellemek ve denetlemek demek.
 *
 * SINIRI (dürüstçe): süreç belleğinde tutulur. Tek süreç için doğru; birden fazla kopya
 * (cluster / yatay ölçekleme) çalıştırılırsa her kopyanın kendi sayacı olur ve efektif limit
 * kopya sayısıyla çarpılır. O noktada paylaşılan bir depo (Redis) gerekir. Bugünkü dağıtım
 * tek süreç olduğu için bu takas kabul edilmiş durumda.
 */

const buckets = new Map();   // anahtar -> zaman damgası dizisi

/**
 * @param {object}  opts
 * @param {number}  opts.windowMs   pencere uzunluğu (ms)
 * @param {number}  opts.max        pencere başına izin verilen istek
 * @param {Function} [opts.keyOf]   istekten anahtar üretir (varsayılan: IP)
 * @param {string}  [opts.message]  429 gövdesindeki mesaj
 */
const rateLimit = ({ windowMs, max, keyOf, message = 'Çok fazla deneme. Lütfen biraz bekleyin.' }) => {
  const makeKey = keyOf || ((req) => req.ip || req.socket.remoteAddress || 'bilinmeyen');

  return (req, res, next) => {
    const key = makeKey(req);
    const now = Date.now();

    // Kayan pencere: pencereden düşmüş damgaları at, kalanı say.
    const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);

    if (hits.length >= max) {
      const retryAfterSec = Math.ceil((windowMs - (now - hits[0])) / 1000);
      buckets.set(key, hits);
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: message, retry_after_seconds: retryAfterSec });
    }

    hits.push(now);
    buckets.set(key, hits);
    next();
  };
};

/**
 * Süresi dolmuş kovaları temizler. Olmazsa Map sonsuza dek büyür: her yeni IP kalıcı bir
 * girdi bırakır ve bu, sınırlayıcının kendisini bir bellek sızıntısına çevirir.
 * `unref()` süreç kapanışını engellememesi için.
 */
const startCleanup = (windowMs, everyMs = 60_000) => {
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, hits] of buckets) {
      const alive = hits.filter((t) => t > cutoff);
      if (alive.length) buckets.set(key, alive);
      else buckets.delete(key);
    }
  }, everyMs);
  if (timer.unref) timer.unref();
  return timer;
};

// Testler için
const reset = () => buckets.clear();
const size = () => buckets.size;

module.exports = { rateLimit, startCleanup, reset, size };
