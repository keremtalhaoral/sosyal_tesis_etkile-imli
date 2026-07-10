/**
 * order.js - Müşteri sipariş akışı (Faz v2-05, ADR-005). ÇİFT MOD:
 * canlı backend varsa gerçek API; yoksa (GitHub Pages) localStorage + seed.json mock.
 * İki akış: "Yeni Sipariş" (rezervasyon + sipariş) ve "Siparişlerim" (mevcut rezervasyona sipariş).
 */
(function () {
  const API_BASE = 'http://127.0.0.1:8085';
  const K_RES = 'mufettis_mock_reservations', K_ORD = 'mufettis_mock_orders';
  let mode = null, seed = null, session = null, token = null;
  let cart = [], menuCache = [];

  const $ = (id) => document.getElementById(id);
  const money = (m) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format((m || 0) / 100);
  // v2-07: sipariş durumu artık anlık 'paid' değil - personel/admin panelinden ilerletilir.
  const ORDER_STATUS_LABEL = { submitted: 'Beklemede', served: 'Servis Edildi', paid: 'Ödendi', cancelled: 'İptal', open: 'Açık' };
  const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const jset = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); };

  async function fetchJson(url, opts, ms) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), ms || 6000);
    try { const r = await fetch(url, { ...opts, signal: ctrl.signal }); const b = await r.json().catch(() => null); return { ok: r.ok, status: r.status, body: b }; }
    catch { return { ok: false, status: 0, body: null }; } finally { clearTimeout(to); }
  }
  const auth = () => token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

  // ---- Mock menü: seed.menu_template'i tesise uygula, stabil id üret ----
  const mockMenu = (facilityId) => (seed.menu_template || []).map((m, i) => ({
    id: facilityId * 100 + i, facility_id: facilityId, name: m.name, category: m.category, price_minor: m.price_minor
  }));

  // ---- Store: canlı / mock tek arayüz ----
  const store = {
    async login(username, password) {
      if (mode === 'live') {
        const r = await fetchJson(`${API_BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        if (!r.ok) throw new Error(r.body && r.body.error || 'Giriş başarısız.');
        token = r.body.token; return r.body.user;
      }
      const u = (seed.demo_users || []).find(x => x.username === username && x.password === password);
      if (!u) throw new Error('Kullanıcı adı veya şifre hatalı.');
      return { username: u.username, role: u.role };
    },
    facilities() {
      if (mode === 'live') return fetchJson(`${API_BASE}/api/facilities`).then(r => r.body || []);
      return Promise.resolve((seed.facilities || []).map(f => ({ id: f.id, ad: f.ad })));
    },
    menu(fid) {
      if (mode === 'live') return fetchJson(`${API_BASE}/api/menu?facilityId=${fid}`).then(r => r.body || []);
      return Promise.resolve(mockMenu(fid));
    },
    async reservations() {
      if (mode === 'live') { const r = await fetchJson(`${API_BASE}/api/reservations`, { headers: auth() }); return r.body || []; }
      return jget(K_RES, []).filter(r => r.owner === session.username);
    },
    async createReservation({ facilityId, reserveDate, reserveTime, guests }) {
      if (mode === 'live') {
        const r = await fetchJson(`${API_BASE}/api/reservations`, { method: 'POST', headers: auth(), body: JSON.stringify({ facilityId, reserveDate, reserveTime, guests }) });
        if (!r.ok) throw new Error(r.body && r.body.error || 'Rezervasyon başarısız.');
        return r.body.id;
      }
      const all = jget(K_RES, []);
      const id = (all.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1;
      all.push({ id, owner: session.username, facility_id: facilityId, reserve_date: reserveDate, reserve_time: reserveTime, guests, amount_minor: 0, status: 'confirmed' });
      jset(K_RES, all); return id;
    },
    async createOrder({ reservationId, items, paymentType, facilityId }) {
      if (mode === 'live') {
        const r = await fetchJson(`${API_BASE}/api/orders`, { method: 'POST', headers: auth(), body: JSON.stringify({ reservationId, items, paymentType }) });
        if (!r.ok) throw new Error(r.body && r.body.error || 'Sipariş başarısız.');
        return r.body;
      }
      const menu = mockMenu(facilityId); let total = 0;
      const rows = items.map(it => { const m = menu.find(x => x.id === it.menuItemId); total += m.price_minor * it.quantity; return { name: m.name, quantity: it.quantity, unit_price_minor: m.price_minor }; });
      const orders = jget(K_ORD, []);
      const id = (orders.reduce((mx, x) => Math.max(mx, x.id), 0) || 0) + 1;
      // v2-07: sipariş 'submitted' ile başlar; servis/ödeme geçişleri admin panelinden yapılır
      // (ADR-005 borç notu, ADR-007). Artık anlık 'paid' varsayılmıyor.
      orders.push({ id, reservation_id: reservationId, total_minor: total, status: 'submitted', payment_type: paymentType, items: rows, created_at: new Date().toISOString() });
      jset(K_ORD, orders);
      const all = jget(K_RES, []); const rv = all.find(r => r.id === reservationId); if (rv) { rv.amount_minor += total; jset(K_RES, all); }
      return { id, total_minor: total, status: 'submitted' };
    },
    async ordersFor(reservationId) {
      if (mode === 'live') { const r = await fetchJson(`${API_BASE}/api/reservations/${reservationId}/orders`, { headers: auth() }); return r.body || []; }
      return jget(K_ORD, []).filter(o => o.reservation_id === reservationId);
    }
  };

  // ---- UI ----
  function renderAuthbar() {
    const bar = $('authbar');
    if (session) {
      bar.innerHTML = `<span style="font-size:13px;">👤 <b>${session.username}</b></span> <button class="btn ghost" id="logout">Çıkış</button>`;
      $('logout').onclick = () => { session = null; token = null; renderAuthbar(); $('app').classList.add('hidden'); showLogin(); };
      $('app').classList.remove('hidden');
    } else {
      bar.innerHTML = '';
    }
  }
  function showLogin() {
    const demo = (seed.demo_users || [])[0];
    $('banner').innerHTML = `Sipariş için giriş yapın. ${demo ? `Demo: <b>${demo.username}</b> / <b>${demo.password}</b>` : ''}`;
    const bar = $('authbar');
    bar.innerHTML = `<input id="u" placeholder="kullanıcı" style="width:120px"> <input id="p" type="password" placeholder="şifre" style="width:120px"> <button class="btn primary" id="do-login">Giriş</button>`;
    $('do-login').onclick = async () => {
      try { session = await store.login($('u').value.trim(), $('p').value); renderAuthbar(); initApp(); }
      catch (e) { toast(e.message); }
    };
  }

  async function initApp() {
    $('banner').textContent = mode === 'live' ? '🟢 Canlı backend' : '📦 Çevrimdışı (Pages) mock modu';
    const facs = await store.facilities();
    $('f-facility').innerHTML = facs.map(f => `<option value="${f.id}">${f.ad}</option>`).join('');
    $('f-slot').innerHTML = (seed.slots || ['19:00']).map(s => `<option>${s}</option>`).join('');
    const d = new Date(Date.now() + 86400000); $('f-date').value = d.toISOString().slice(0, 10);
    $('f-date').min = new Date().toISOString().slice(0, 10);
    await loadMenu();
    $('f-facility').onchange = () => { cart = []; loadMenu(); };
    renderCart();
  }

  async function loadMenu() {
    const fid = Number($('f-facility').value);
    menuCache = await store.menu(fid);
    $('menu-grid').innerHTML = menuCache.map(m => `
      <div class="mi" data-id="${m.id}">
        <div><div class="name">${m.name}</div><div class="cat">${m.category || ''}</div></div>
        <div class="price">${money(m.price_minor)}</div>
        <div class="add"><button class="qbtn" data-op="-">−</button><span class="q" data-q="${m.id}">0</span><button class="qbtn" data-op="+">+</button></div>
      </div>`).join('');
    $('menu-grid').querySelectorAll('.qbtn').forEach(b => b.onclick = (e) => {
      const id = Number(e.target.closest('.mi').dataset.id);
      changeQty(id, e.target.dataset.op === '+' ? 1 : -1);
    });
  }

  function changeQty(menuItemId, delta) {
    const m = menuCache.find(x => x.id === menuItemId);
    let line = cart.find(c => c.menuItemId === menuItemId);
    if (!line && delta > 0) { line = { menuItemId, name: m.name, price_minor: m.price_minor, quantity: 0 }; cart.push(line); }
    if (!line) return;
    line.quantity = Math.max(0, line.quantity + delta);
    cart = cart.filter(c => c.quantity > 0);
    const qEl = document.querySelector(`.q[data-q="${menuItemId}"]`); if (qEl) qEl.textContent = line.quantity || 0;
    renderCart();
  }

  function renderCart() {
    const lines = $('cart-lines');
    if (!cart.length) { lines.innerHTML = '<div class="empty">Sepet boş — menüden ekleyin.</div>'; }
    else lines.innerHTML = cart.map(c => `<div class="line"><span>${c.quantity}× ${c.name}</span><span>${money(c.price_minor * c.quantity)}</span></div>`).join('');
    const total = cart.reduce((s, c) => s + c.price_minor * c.quantity, 0);
    $('cart-total').textContent = money(total);
    $('place-order').disabled = cart.length === 0;
  }

  async function placeOrder() {
    const facilityId = Number($('f-facility').value);
    const btn = $('place-order'); btn.disabled = true; btn.textContent = 'İşleniyor…';
    try {
      const reservationId = await store.createReservation({
        facilityId, reserveDate: $('f-date').value, reserveTime: $('f-slot').value, guests: Number($('f-guests').value) || 1
      });
      const order = await store.createOrder({
        reservationId, facilityId, paymentType: $('f-payment').value,
        items: cart.map(c => ({ menuItemId: c.menuItemId, quantity: c.quantity }))
      });
      toast(`Sipariş alındı! Toplam ${money(order.total_minor)} · beklemede 🕓`);
      cart = []; loadMenu(); renderCart();
    } catch (e) { toast('Hata: ' + e.message); }
    finally { btn.textContent = 'Siparişi Tamamla'; btn.disabled = cart.length === 0; }
  }

  async function renderMine() {
    const list = $('mine-list');
    const facs = await store.facilities(); const fmap = {}; facs.forEach(f => fmap[f.id] = f.ad);
    const resvs = await store.reservations();
    if (!resvs.length) { list.innerHTML = '<div class="empty">Henüz rezervasyonunuz yok.</div>'; return; }
    const parts = [];
    for (const r of resvs) {
      const orders = await store.ordersFor(r.id);
      const fname = r.facility_name || fmap[r.facility_id] || `Tesis ${r.facility_id}`;
      const ordHtml = orders.length ? orders.map(o => `<div class="ord">Sipariş #${o.id} · ${money(o.total_minor)} · ${ORDER_STATUS_LABEL[o.status] || o.status}${o.items ? ' · ' + o.items.map(i => `${i.quantity}× ${i.name}`).join(', ') : ''}</div>`).join('') : '<div class="ord" style="color:var(--muted)">Sipariş yok</div>';
      parts.push(`<div class="resv"><div class="top"><div><b>${fname}</b> <span class="meta">${r.reserve_date} · ${r.reserve_time} · ${r.guests} kişi</span></div><span class="badge">${money(r.amount_minor || 0)}</span></div>${ordHtml}</div>`);
    }
    list.innerHTML = parts.join('');
  }

  // ---- Olaylar + init ----
  $('theme-toggle').onclick = () => { const c = document.documentElement.getAttribute('data-theme'); const n = c === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); localStorage.setItem('color-scheme', n); };
  $('place-order').onclick = placeOrder;
  document.querySelector('.tabs').onclick = (e) => {
    const t = e.target.dataset.tab; if (!t) return;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    $('tab-new').classList.toggle('hidden', t !== 'new');
    $('tab-mine').classList.toggle('hidden', t !== 'mine');
    if (t === 'mine') renderMine();
  };

  (async function boot() {
    // seed (mock için menü/tesis/demo) her modda gerekli
    seed = await fetchJson('data/seed.json').then(r => r.body).catch(() => null) || { facilities: [], menu_template: [], slots: [], demo_users: [] };
    const probe = await fetchJson(`${API_BASE}/api/menu?facilityId=1`, {}, 2500);
    mode = probe.ok ? 'live' : 'snapshot';
    showLogin();
  })();
})();
