/**
 * events.js - Sunucudan tarayıcıya CANLI bildirim (Server-Sent Events)
 *
 * PROBLEM
 * Dashboard verisini yalnız sayfa açılışında çekiyordu. Kullanıcı sipariş verdiğinde
 * grafikler olduğu gibi kalıyor, değişikliği görmek için sayfayı elle yenilemek
 * gerekiyordu. Sunumda "sipariş ver, grafiğin büyüdüğünü göster" anı imkânsızdı.
 *
 * NEDEN SSE (WebSocket ya da yoklama DEĞİL) - ADR-010
 *
 *   Yoklama (polling): her N saniyede bir "değişti mi?" diye sormak. Basit ama iki
 *   ucu da kötü: aralık kısa olursa boşuna sorgu yağmuru (dashboard sorgusu 6 ayrı
 *   agregasyon koşturuyor), uzun olursa sunumda gecikme. Ayrıca "ne zaman
 *   güncellendi" belirsiz kalıyor.
 *
 *   WebSocket: çift yönlü, güçlü - ama burada tarayıcının sunucuya söyleyeceği bir
 *   şey YOK, akış tek yönlü. Üstelik `ws` paketi gerektiriyor; proje üç bağımlılıkta
 *   (express, cors, pg) duruyor ve bunu bir bildirim kanalı için bozmak orantısız.
 *
 *   SSE: düz HTTP üstünde tek yönlü sunucu→istemci akışı. Sunucu tarafında ek paket
 *   yok (açık bir yanıt nesnesine yazmak yeterli), tarayıcı tarafında `EventSource`
 *   yerleşik ve otomatik yeniden bağlanıyor. İhtiyacın şekli tam olarak bu.
 *
 * NE GÖNDERİLİYOR - ve ne gönderilMİYOR
 * Olay yalnız bir İŞARET taşır: {type:'order', at:'…'}. Verinin kendisi YOK.
 * İstemci işareti alınca normal API ucundan taze veriyi çekiyor. Sebep:
 *   - Yetkilendirme tek yerde kalıyor. Olayın içine veri koysaydık, o veriyi görmeye
 *     kimin hakkı olduğunu BİR DE burada kontrol etmek gerekirdi (admin gözetim
 *     uçları sahiplik filtresiz - ADR-007). İki ayrı yetki yolu = ikisinin ayrışması.
 *   - Yayın anı ile okuma anı arasında başka yazmalar olabilir; istemci her zaman
 *     en güncel BÜTÜNÜ okuyor, parça parça birleştirmiyor.
 * Buna "cache invalidation" deseni denir: "şu değişti" de, "yenisi şu" deme.
 */

// Açık SSE bağlantıları. Her biri: { id, res, filter }
const clients = new Set();
let nextId = 1;

// Ara katmanlar (nginx, cloudflare) hareketsiz bağlantıyı kapatır. Düzenli bir yorum
// satırı ("ping") bağlantıyı canlı tutar; yorum satırı olduğu için istemcide olay
// tetiklemez, yalnız baytlar akar.
const HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS || 25000);
let heartbeatTimer = null;

const startHeartbeat = () => {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const c of clients) {
      try { c.res.write(`: ping ${Date.now()}\n\n`); } catch { /* yazılamıyorsa close olayı zaten temizler */ }
    }
  }, HEARTBEAT_MS);
  // Node'un kapanmasını engellemesin (testler process'i beklemeden bitebilsin).
  if (heartbeatTimer.unref) heartbeatTimer.unref();
};

const stopHeartbeat = () => {
  if (heartbeatTimer && clients.size === 0) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
};

/**
 * Yeni bir SSE aboneliği açar. Express handler'ından çağrılır.
 * Yanıt AÇIK BIRAKILIR - res.end() çağrılmaz; bağlantı istemci kapatana dek yaşar.
 */
const subscribe = (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',   // no-transform: proxy sıkıştırıp tamponlamasın
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',                   // nginx tamponlamayı kapatsın
  });

  const client = { id: nextId++, res };
  clients.add(client);
  startHeartbeat();

  // İlk mesaj: istemci "bağlandım" olduğunu bilsin (arayüzde canlı rozeti için).
  // retry: tarayıcı bağlantı koparsa kaç ms sonra yeniden denesin.
  res.write('retry: 3000\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ clientId: client.id, at: new Date().toISOString() })}\n\n`);

  const cleanup = () => {
    if (!clients.delete(client)) return;
    stopHeartbeat();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);

  return client;
};

/**
 * Bir değişikliği tüm abonelere duyurur.
 *
 * ASLA FIRLATMAZ: bildirim yan etkidir, asıl işlem (rezervasyon/sipariş) çoktan
 * commit edildi. Buradaki bir hata kullanıcının isteğini başarısız GÖSTERMEMELİ -
 * en kötü ihtimalle grafik geç güncellenir.
 *
 * @param {string} type  'reservation' | 'order' | 'facility' | 'ispark' | 'user'
 * @param {object} [detail]  küçük, hassas OLMAYAN bağlam (ör. {action:'create'})
 */
const publish = (type, detail = {}) => {
  if (clients.size === 0) return 0;
  const payload = JSON.stringify({ type, at: new Date().toISOString(), ...detail });
  const frame = `event: change\ndata: ${payload}\n\n`;
  let sent = 0;
  for (const c of clients) {
    try { c.res.write(frame); sent++; }
    catch { clients.delete(c); }   // kopmuş bağlantı: sessizce düş
  }
  return sent;
};

const clientCount = () => clients.size;

/** Testler ve düzgün kapanış için: tüm bağlantıları kapat. */
const closeAll = () => {
  for (const c of clients) { try { c.res.end(); } catch { /* zaten kapalı */ } }
  clients.clear();
  stopHeartbeat();
};

module.exports = { subscribe, publish, clientCount, closeAll, HEARTBEAT_MS };
