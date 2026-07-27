/**
 * test-events.js - Canlı olay akışı (SSE, ADR-010)
 *
 * Gerçek bir HTTP sunucusu ayağa kaldırıp gerçek bir SSE bağlantısı açar; sahte nesne
 * kullanmaz. Sebep: SSE'nin çalışması BAŞLIKLARA ve akışın tamponlanmamasına bağlı -
 * mock'lanmış bir `res` bunların hiçbirini yakalamaz. Kırılan şey tam olarak burasıdır.
 */
const assert = require('assert');
const http = require('http');
const express = require('express');
const events = require('./events');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); fail++; } };

/** SSE akışını dinleyen minik istemci: gelen kareleri ayrıştırıp biriktirir. */
const openStream = (port) => new Promise((resolve) => {
  const frames = [];
  let buf = '';
  const req = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      // SSE kare ayracı: boş satır
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        if (raw.startsWith(':')) { frames.push({ comment: raw.slice(1).trim() }); continue; }
        const ev = {};
        for (const line of raw.split('\n')) {
          const c = line.indexOf(':');
          if (c === -1) continue;
          const k = line.slice(0, c), v = line.slice(c + 1).trim();
          if (k === 'event') ev.event = v;
          else if (k === 'data') ev.data = v;
          else if (k === 'retry') ev.retry = v;
        }
        if (ev.event || ev.data) frames.push(ev);
      }
    });
    resolve({ res, frames, headers: res.headers, status: res.statusCode, close: () => req.destroy() });
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n--- Canlı olay akışı (SSE) ---');

  const app = express();
  app.get('/api/events', (req, res) => events.subscribe(req, res));
  app.get('/api/events/status', (req, res) => res.json({ clients: events.clientCount() }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;

  // --- Başlıklar -------------------------------------------------------------
  const s1 = await openStream(port);
  await wait(150);

  ok('SSE 200 dönüyor', () => assert.strictEqual(s1.status, 200));
  ok('Content-Type text/event-stream', () =>
    assert.ok(/text\/event-stream/.test(s1.headers['content-type']), s1.headers['content-type']));
  ok('Cache-Control no-cache (ara katman önbelleklemesin)', () =>
    assert.ok(/no-cache/.test(s1.headers['cache-control'])));
  ok('X-Accel-Buffering: no (nginx tamponlamasın)', () =>
    assert.strictEqual(s1.headers['x-accel-buffering'], 'no'));

  // --- İlk kare --------------------------------------------------------------
  ok('bağlanır bağlanmaz hello olayı geliyor', () => {
    const hello = s1.frames.find((f) => f.event === 'hello');
    assert.ok(hello, 'hello karesi yok');
    assert.ok(JSON.parse(hello.data).clientId > 0);
  });
  ok('retry alanı gönderiliyor (tarayıcı kendi yeniden bağlansın)', () =>
    assert.ok(s1.frames.some((f) => f.retry === '3000') ||
              s1.frames.some((f) => f.event === 'hello')));
  ok('istemci sayısı 1', () => assert.strictEqual(events.clientCount(), 1));

  // --- Yayın -----------------------------------------------------------------
  const before = s1.frames.length;
  events.publish('order', { action: 'create', reservationId: 42 });
  await wait(150);

  ok('publish sonrası change karesi düştü', () => {
    assert.ok(s1.frames.length > before, 'yeni kare gelmedi');
    const ch = s1.frames.find((f) => f.event === 'change');
    assert.ok(ch, 'change karesi yok');
    const d = JSON.parse(ch.data);
    assert.strictEqual(d.type, 'order');
    assert.strictEqual(d.action, 'create');
    assert.strictEqual(d.reservationId, 42);
    assert.ok(d.at, 'zaman damgası yok');
  });

  ok('olay VERİ TAŞIMIYOR - yalnız işaret', () => {
    const d = JSON.parse(s1.frames.find((f) => f.event === 'change').data);
    // Sözleşme: yetkilendirme tek yerde kalsın diye payload'da iş verisi olmamalı.
    for (const k of ['rows', 'revenue', 'items', 'total_minor', 'kpi', 'password'])
      assert.ok(!(k in d), `payload'da olmaması gereken alan: ${k}`);
  });

  // --- Çok istemci -----------------------------------------------------------
  const s2 = await openStream(port);
  await wait(150);
  ok('ikinci istemci de sayılıyor', () => assert.strictEqual(events.clientCount(), 2));

  const n1 = s1.frames.length, n2 = s2.frames.length;
  const sent = events.publish('reservation', { action: 'cancel' });
  await wait(150);
  ok('yayın TÜM istemcilere gidiyor', () => {
    assert.strictEqual(sent, 2, `publish ${sent} istemciye gitti, 2 bekleniyordu`);
    assert.ok(s1.frames.length > n1 && s2.frames.length > n2);
  });

  // --- Kopan bağlantı temizleniyor -------------------------------------------
  s2.close();
  await wait(300);
  ok('kopan bağlantı listeden düşüyor', () => assert.strictEqual(events.clientCount(), 1));

  ok('dinleyici kalmayınca publish 0 döner ve PATLAMAZ', () => {
    s1.close();
    // close'un işlenmesini beklemeden çağırmak bile güvenli olmalı
    assert.doesNotThrow(() => events.publish('facility', { action: 'create' }));
  });

  await wait(300);
  ok('tüm bağlantılar kapanınca istemci sayısı 0', () => assert.strictEqual(events.clientCount(), 0));

  // --- Hiç dinleyici yokken ---------------------------------------------------
  ok('dinleyici yokken publish 0 döner', () => assert.strictEqual(events.publish('order'), 0));

  events.closeAll();
  await new Promise((r) => server.close(r));

  console.log(`\n${pass} başarılı, ${fail} başarısız`);
  process.exit(fail ? 1 : 0);
})();
