/**
 * dashboard.js - Analiz Paneli (Faz v2-04, ADR-004).
 * ÇİFT MOD: önce canlı backend API denenir; erişilemezse (GitHub Pages) data/analytics.json
 * snapshot'ına düşülür. Renkler dataviz referans paletinden CSS değişkeni olarak okunur;
 * tema (açık/koyu) değişince chart'lar yeniden çizilir.
 */
(function () {
  const API_BASE = 'http://127.0.0.1:8085';
  const GRANS = ['day', 'week', 'month', 'year'];
  let state = { granularity: 'month', mode: null, snapshot: null, charts: {} };

  const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
  const money = (minor) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format((minor || 0) / 100);
  const num = (n) => new Intl.NumberFormat('tr-TR').format(n || 0);
  const seqRamp = () => [css('--seq-1'), css('--seq-2'), css('--seq-3'), css('--seq-4'), css('--seq-5'), css('--seq-6'), css('--seq-7')];
  const catColors = () => ['--s1','--s2','--s3','--s4','--s5','--s6','--s7','--s8'].map(css);

  const DOW = [{ i: 1, l: 'Pzt' }, { i: 2, l: 'Sal' }, { i: 3, l: 'Çar' }, { i: 4, l: 'Per' }, { i: 5, l: 'Cum' }, { i: 6, l: 'Cmt' }, { i: 0, l: 'Paz' }];

  // ---- Veri kaynağı: canlı backend mi, snapshot mı? ----
  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { const r = await fetch(url, { signal: ctrl.signal }); return r.ok ? r.json() : null; }
    finally { clearTimeout(t); }
  }

  async function loadData(granularity) {
    if (state.mode === 'live') {
      const d = await fetchWithTimeout(`${API_BASE}/api/analytics/dashboard?granularity=${granularity}`, 4000).catch(() => null);
      if (d) return d;
    }
    // snapshot modu (Pages): byGranularity'den ilgili aralığı seç
    const s = state.snapshot;
    // Canlı mod sonradan koparsa (backend restart / timeout) snapshot hiç yüklenmemiş
    // olabilir; null ise çökmek yerine null dön → refresh() "Veri yüklenemedi" gösterir.
    if (!s) return null;
    const g = s.byGranularity[granularity] || s.byGranularity.month;
    return { kpi: s.kpi, occupancy_heatmap: s.occupancy_heatmap, top_facilities: s.top_facilities,
             payments: s.payments, category_sales: s.category_sales,
             revenue: g.revenue, highchair: g.highchair, cancellations: g.cancellations };
  }

  async function detectMode() {
    const live = await fetchWithTimeout(`${API_BASE}/api/analytics/dashboard?granularity=month`, 2500).catch(() => null);
    if (live) { state.mode = 'live'; return; }
    state.mode = 'snapshot';
    state.snapshot = await fetchWithTimeout('data/analytics.json', 8000).catch(() => null);
  }

  // ---- Chart yardımcıları ----
  function chartDefaults() {
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    Chart.defaults.color = css('--text-secondary');
    Chart.defaults.borderColor = css('--grid');
    Chart.defaults.animation = { duration: 500 };
  }
  function destroyAll() { Object.values(state.charts).forEach(c => c && c.destroy()); state.charts = {}; }
  const axis = () => ({ grid: { color: css('--grid'), drawBorder: false }, ticks: { color: css('--muted') } });

  /**
   * Var olan bir chart'ı YENİDEN YARATMADAN günceller.
   *
   * Neden önemli: `destroy()` + `new Chart()` grafiği sıfırdan çizer - ekran bir an
   * boşalır ve yeni değer animasyonsuz belirir. Oysa canlı güncellemede asıl istediğimiz
   * şey ÇUBUĞUN BÜYÜDÜĞÜNÜ GÖRMEK. `chart.update()` eski veriden yeniye animasyon yapar;
   * sunumda "sipariş verdim, bakın ciro çubuğu yükseldi" anı tam olarak budur.
   * (Ayrıca daha ucuz: canvas yeniden kurulmuyor.)
   *
   * Aynı id'de chart yoksa ya da tipi değiştiyse `null` döner → çağıran yenisini yaratır.
   */
  function updateChart(id, type, labels, data) {
    const c = state.charts[id];
    if (!c || c.config.type !== type) return null;
    c.data.labels = labels;
    c.data.datasets[0].data = data;
    // Halka grafikte dilim sayısı değişebilir → renk dizisi de yeniden boyutlanmalı.
    if (type === 'doughnut') c.data.datasets[0].backgroundColor = catColors().slice(0, labels.length);
    c.update();
    return c;
  }

  function lineChart(id, labels, data, colorVar, fmt) {
    if (updateChart(id, 'line', labels, data)) return;
    const color = css(colorVar);
    state.charts[id] = new Chart(document.getElementById(id), {
      type: 'line',
      data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + '22',
        borderWidth: 2, tension: 0.3, pointRadius: labels.length > 40 ? 0 : 3, pointHoverRadius: 5, fill: true }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => fmt(c.parsed.y) } } },
        scales: { x: axis(), y: { ...axis(), ticks: { color: css('--muted'), callback: (v) => fmt(v) } } } }
    });
  }

  function barChart(id, labels, data, colorVar, fmt, horizontal) {
    if (updateChart(id, 'bar', labels, data)) return;
    const color = css(colorVar);
    state.charts[id] = new Chart(document.getElementById(id), {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4, borderSkipped: false }] },
      options: { indexAxis: horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmt(horizontal ? c.parsed.x : c.parsed.y) } } },
        scales: { x: axis(), y: axis() } }
    });
  }

  function donutChart(id, labels, data, fmt) {
    if (updateChart(id, 'doughnut', labels, data)) return;
    state.charts[id] = new Chart(document.getElementById(id), {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: catColors().slice(0, labels.length),
        borderColor: css('--surface-1'), borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '58%',
        plugins: { legend: { position: 'bottom', labels: { color: css('--text-secondary'), padding: 14, usePointStyle: true } },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt(c.parsed)}` } } } }
    });
  }

  // ---- Render ----
  function renderKpis(k) {
    document.getElementById('kpis').innerHTML = [
      ['Toplam Ciro', money(k.revenue_minor), ''],
      ['Rezervasyon', num(k.reservations), 'adet'],
      ['Toplam Misafir', num(k.guests), 'kişi'],
      ['Ort. Grup', num(k.avg_group_size), 'kişi'],
      ['Bebe Sandalyesi', num(k.highchairs), 'adet'],
      ['İptal Oranı', (k.cancellation_rate * 100).toFixed(1), '%']
    ].map(([label, value, unit]) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value} <span class="unit">${unit}</span></div></div>`).join('');
  }

  function renderHeatmap(rows) {
    const slots = [...new Set(rows.map(r => r.slot))].sort();
    const map = {}; let max = 0;
    rows.forEach(r => { map[`${r.dow}|${r.slot}`] = r.guests; if (r.guests > max) max = r.guests; });
    const ramp = seqRamp();
    const colorFor = (v) => v ? ramp[Math.min(ramp.length - 1, Math.floor((v / max) * ramp.length))] : 'transparent';
    let html = '<table><thead><tr><th></th>' + slots.map(s => `<th>${s}</th>`).join('') + '</tr></thead><tbody>';
    DOW.forEach(d => {
      html += `<tr><td class="rowlab">${d.l}</td>` + slots.map(s => {
        const v = map[`${d.i}|${s}`] || 0;
        return `<td><div class="cell" style="background:${colorFor(v)}" title="${d.l} ${s}: ${num(v)} misafir">${v ? num(v) : ''}</div></td>`;
      }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('heatmap').innerHTML = html;
    document.getElementById('heat-legend').innerHTML = 'az' + ramp.map(c => `<span class="sw" style="background:${c}"></span>`).join('') + 'çok';
  }

  // rebuild=true → chart'lar sıfırdan yaratılır (tema değişimi: renkler options'a gömülü).
  // rebuild=false → var olanlar YERİNDE güncellenir (canlı akış: animasyon korunur).
  function renderAll(d, rebuild) {
    if (rebuild) destroyAll();
    chartDefaults();
    renderKpis(d.kpi);
    renderHeatmap(d.occupancy_heatmap);
    lineChart('c-revenue', d.revenue.map(r => r.bucket), d.revenue.map(r => r.revenue_minor / 100),
      '--s1', (v) => money(v * 100));
    barChart('c-facilities', d.top_facilities.map(f => f.name), d.top_facilities.map(f => f.revenue_minor / 100),
      '--s1', (v) => money(v * 100), true);
    donutChart('c-payments', d.payments.map(p => p.payment_type), d.payments.map(p => p.reservations), (v) => num(v) + ' rez');
    lineChart('c-highchair', d.highchair.map(h => h.bucket), d.highchair.map(h => h.highchairs), '--s2', (v) => num(v));
    barChart('c-cancel', d.cancellations.map(c => c.bucket),
      d.cancellations.map(c => c.total ? +(c.cancelled / c.total * 100).toFixed(1) : 0), '--s6', (v) => v + '%', false);
    barChart('c-category', d.category_sales.map(c => c.category), d.category_sales.map(c => c.revenue_minor / 100),
      '--s3', (v) => money(v * 100), true);
  }

  async function refresh(rebuild) {
    const d = await loadData(state.granularity);
    if (!d) { document.querySelector('main').innerHTML = '<div class="err">Veri yüklenemedi.</div>'; return; }
    renderAll(d, rebuild);
    stampNow();
  }

  // ---- Canlı akış (SSE, ADR-010) --------------------------------------------
  // Sunucu bir rezervasyon/sipariş yazıldığında "değişti" işareti gönderiyor; biz
  // işareti alınca TAZE veriyi normal API ucundan çekiyoruz. Olayın içinde veri YOK -
  // gerekçesi backend/events.js başındaki notta.
  const liveBar  = document.getElementById('live-bar');
  const liveText = document.getElementById('live-text');
  const liveStamp = document.getElementById('live-stamp');
  let hitTimer = null;
  let burstTimer = null;

  function stampNow() {
    if (liveStamp) liveStamp.textContent = 'son güncelleme ' + new Date().toLocaleTimeString('tr-TR');
  }
  function setLive(cls, text) {
    if (!liveBar) return;
    liveBar.hidden = false;
    liveBar.classList.remove('on', 'off', 'hit');
    liveBar.classList.add(cls);
    liveText.textContent = text;
  }

  function connectLive() {
    // EventSource yalnız canlı modda anlamlı: snapshot modunda (Pages) sunucu yok.
    if (state.mode !== 'live' || typeof EventSource === 'undefined' || new URLSearchParams(window.location.search).has('nosse')) return;

    const es = new EventSource(`${API_BASE}/api/events`);

    es.addEventListener('hello', () => setLive('on', 'Canlı akış bağlı — veri girdikçe grafikler kendiliğinden güncellenir'));

    es.addEventListener('change', (e) => {
      let type = 'veri';
      try { type = (JSON.parse(e.data).type) || 'veri'; } catch { /* bozuk kare: tipi bilmeden de yenile */ }

      // BİRİKTİRME (debounce): bir sipariş tek olay üretmiyor olabilir ve kullanıcı
      // arka arkaya işlem yapabilir. Dashboard sorgusu 6 ayrı agregasyon koşturuyor;
      // her olayda ayrı ayrı çekmek sunucuyu boşuna yorar. 400 ms sessizlik bekleyip
      // TEK yenileme yapıyoruz - insan gözü için zaten anlık.
      clearTimeout(burstTimer);
      burstTimer = setTimeout(async () => {
        await refresh(false);           // rebuild=false → chart'lar YERİNDE güncellenir (animasyonlu)
        setLive('hit', `${TYPE_LABEL[type] || 'Veri'} değişti — grafikler güncellendi`);
        clearTimeout(hitTimer);
        hitTimer = setTimeout(() => setLive('on', 'Canlı akış bağlı — veri girdikçe grafikler kendiliğinden güncellenir'), 2600);
      }, 400);
    });

    // EventSource kopunca KENDİ yeniden bağlanır (sunucu `retry: 3000` gönderiyor).
    // Burada sadece kullanıcıya durumu söylüyoruz; elle reconnect yazmak gereksiz.
    es.onerror = () => setLive('off', 'Canlı akış koptu — yeniden bağlanılıyor…');
  }

  const TYPE_LABEL = { reservation: 'Rezervasyon', order: 'Sipariş', facility: 'Tesis',
                       ispark: 'İSPARK', user: 'Kullanıcı' };

  // ---- Olaylar ----
  document.getElementById('granularity').addEventListener('click', (e) => {
    const g = e.target.dataset.g; if (!g) return;
    state.granularity = g;
    document.querySelectorAll('#granularity button').forEach(b => b.classList.toggle('active', b.dataset.g === g));
    refresh(false);
  });
  document.getElementById('refresh').addEventListener('click', () => refresh(false));
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('color-scheme', next);
    refresh(true); // renkler options'a gömülü → chart'lar sıfırdan yaratılmalı
  });

  (async function init() {
    await detectMode();
    const banner = document.getElementById('mode-banner');
    if (state.mode === 'live') banner.textContent = '🟢 Canlı backend verisi (gerçek zamanlı sorgu)';
    else if (state.snapshot) {
      // Grafikler GERÇEK ama Pages'te backend yok → sabit bir anlık görüntü (snapshot)
      // okunur. Kullanıcıya "neden hep aynı?" sorusunu yanıtlamak için tarih + adet göster.
      const gen = state.snapshot.generated_at
        ? new Date(state.snapshot.generated_at).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' })
        : '?';
      const n = state.snapshot.kpi ? num(state.snapshot.kpi.reservations) : '?';
      banner.textContent = `📦 Veri anlık görüntüsü: ${gen} · ${n} rezervasyon (sabit demo verisi — Pages modu, canlı backend'de değişir)`;
      // Pages'te sunucu yok → itilecek olay da yok. Sessiz kalmak yerine sebebini yaz.
      setLive('off', 'Canlı akış yok — bu modda sunucu çalışmıyor (snapshot okunuyor)');
    }
    else { banner.textContent = '⚠️ Veri kaynağı yok'; document.querySelector('main').innerHTML = '<div class="err">Ne backend ne de snapshot bulunabildi.</div>'; return; }
    await refresh(true);
    connectLive();
  })();
})();
