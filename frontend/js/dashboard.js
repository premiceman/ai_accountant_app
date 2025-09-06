// frontend/js/dashboard.js (fixed, preserves existing UI)
(function () {
  const RANGE_KEY = 'dashboardRangeV1';

  init().catch(err => {
    console.error('Dashboard init failed:', err);
    softError('Could not load dashboard: ' + (err?.message || err));
  });

  async function init() {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Dashboard');
    const g = document.getElementById('greeting-name');
    if (g && me?.firstName) g.textContent = me.firstName;

    wireRangePicker();
    await reloadDashboard();
  }

  // ---------------- Range state & UI ----------------
  function defaultRangeState() { return { mode: 'quick', preset: 'last-month', start: null, end: null }; }
  function loadRangeState() { try { return JSON.parse(localStorage.getItem(RANGE_KEY) || 'null') || defaultRangeState(); } catch { return defaultRangeState(); } }
  function saveRangeState(st) { try { localStorage.setItem(RANGE_KEY, JSON.stringify(st)); } catch {} }

  function wireRangePicker() {
    const st = loadRangeState();
    const btnQuick  = byId('rng-btn-quick');
    const btnCustom = byId('rng-btn-custom');
    const paneQuick = byId('rng-quick');
    const paneCustom= byId('rng-custom');

    if (!btnQuick || !btnCustom || !paneQuick || !paneCustom) return;

    function setMode(mode) {
      st.mode = mode;
      btnQuick.classList.toggle('active', mode === 'quick');
      btnCustom.classList.toggle('active', mode === 'custom');
      paneQuick.style.display = (mode === 'quick') ? '' : 'none';
      paneCustom.style.display = (mode === 'custom') ? '' : 'none';
      saveRangeState(st);
      updateRangeLabel(st);
    }
    btnQuick.addEventListener('click', () => setMode('quick'));
    btnCustom.addEventListener('click', ()=> setMode('custom'));

    const quickRadios = [ 'rng-last-month', 'rng-last-quarter', 'rng-last-year' ].map(byId).filter(Boolean);
    const applyQuick  = byId('rng-apply-quick');
    quickRadios.forEach(r => r.addEventListener('change', () => { st.preset = r.value; saveRangeState(st); }));
    if (applyQuick) applyQuick.addEventListener('click', async () => { await reloadDashboard(); });

    const startEl = byId('rng-start'), endEl = byId('rng-end'), applyCustom = byId('rng-apply-custom');
    if (applyCustom) applyCustom.addEventListener('click', async () => {
      const s = startEl.value, e = endEl.value;
      if (!s || !e) return alert('Please select both start and end dates.');
      if (new Date(s) > new Date(e)) return alert('Start date must be before end date.');
      st.start = s; st.end = e; saveRangeState(st);
      await reloadDashboard();
    });

    setMode(st.mode || 'quick');
    const presetEl = byId(st.preset === 'last-year' ? 'rng-last-year' : (st.preset === 'last-quarter' ? 'rng-last-quarter' : 'rng-last-month'));
    if (presetEl) presetEl.checked = true;
    if (st.start && startEl) startEl.value = st.start;
    if (st.end && endEl)   endEl.value   = st.end;
    updateRangeLabel(st);
  }
  function updateRangeLabel(st) {
    const el = byId('range-current'); if (!el) return;
    if (st.mode === 'quick') {
      const pretty = st.preset === 'last-year' ? 'Last year' : st.preset === 'last-quarter' ? 'Last quarter' : 'Last month';
      el.textContent = `Current: ${pretty}`;
    } else if (st.start && st.end) {
      el.textContent = `Current: ${new Date(st.start).toLocaleDateString()} – ${new Date(st.end).toLocaleDateString()}`;
    } else el.textContent = '—';
  }

  // ---------------- Data fetch & render ----------------
  async function reloadDashboard() {
    setText('dash-year', `Tax year ${safeTaxYearLabel(new Date())}`);

    const st = loadRangeState();
    const qs = st.mode === 'quick'
      ? `preset=${encodeURIComponent(st.preset || 'last-month')}`
      : (st.start && st.end) ? `start=${encodeURIComponent(st.start)}&end=${encodeURIComponent(st.end)}` : `preset=last-month`;

    let data = {};
    try {
      // IMPORTANT: use Auth.fetch (adds Authorization). API.fetch does not exist in this project.
      const res = await Auth.fetch(`/api/summary/current-year?${qs}&t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) data = await res.json();
      else throw new Error(`Summary ${res.status}`);
    } catch (e) {
      console.warn('Summary API failed:', e);
      softError('Summary API failed.');
      return;
    }

    // Charts/tiles
    try { renderWaterfall('chart-waterfall', data.waterfall || []); } catch (e) { console.error('Waterfall render:', e); }
    try { renderEMTR('chart-emtr', data.emtr || []); } catch (e) { console.error('EMTR render:', e); }
    try { renderGauges('gauges', data.gauges || {}); } catch (e) { console.error('Gauges render:', e); }

    // KPIs (if their tiles exist in DOM)
    if (data.kpis) {
      setText('kpi-tax-band', data.kpis.taxBand || '—');
      const pos = data.kpis.hmrc || {};
      if (byId('kpi-tax-pos')) {
        const net = Number(pos.netForRange || 0);
        const nice = (n)=>'£'+Number(Math.abs(n)).toLocaleString();
        byId('kpi-tax-pos').textContent = net > 0 ? `Owe ${nice(net)}` : net < 0 ? `Due ${nice(net)}` : 'Settled';
        const sub = `Est. tax: £${Number(pos.estTaxForRange||0).toLocaleString()} · Payments: £${Number(pos.paymentsInRange||0).toLocaleString()}`;
        setText('kpi-tax-pos-sub', sub);
      }
      setText('kpi-income', money(data.kpis.incomeTotal));
      setText('kpi-spend',  money(data.kpis.spendTotal));
    }

    // Events
    try {
      const defaults = defaultUkEvents2025_26();
      const userEvents = loadUserEvents();
      renderEventsTable(defaults, userEvents);
    } catch (e) { console.error('Events render:', e); }

    // Financial Posture
    try {
      if (data.financialPosture) renderFinancialPosture(data.financialPosture, data.trends);
    } catch (e) { console.error('Financial Posture render:', e); }

    updateRangeLabel(st);
  }

  // ---------------- Charts ----------------
  function themeColors(n) {
    const root = getComputedStyle(document.documentElement);
    const list = ['--chart-1','--chart-2','--chart-3','--chart-4','--chart-5','--chart-6','--chart-7','--chart-8']
      .map(v => root.getPropertyValue(v).trim()).filter(Boolean);
    const fallback = ['#4a78ff','#60c8ff','#7dd3a8','#f5a524','#ef4d72','#8b5cf6','#f59e0b','#10b981'];
    const base = list.length ? list : fallback;
    const out = [];
    for (let i=0; i<n; i++) out.push(base[i % base.length]);
    return out;
  }

  // ---- Waterfall (positive-only bars, themed colors)
  function renderWaterfall(canvasId, steps) {
    const el = document.getElementById(canvasId);
    if (!el || !Array.isArray(steps) || steps.length === 0 || !window.Chart) return;
    if (el._chart) el._chart.destroy();

    const labels = steps.map(s => s.label);
    const values = steps.map(s => Math.max(0, Number(s.amount || 0))); // force positive
    const colors = themeColors(values.length);

    el._chart = new Chart(el, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `£${Number(c.parsed.y || 0).toLocaleString()}` } }
        },
        scales: {
          x: { stacked: false },
          y: { beginAtZero: true, ticks: { callback: (v) => '£' + Number(v).toLocaleString() } }
        }
      }
    });
  }

  function renderEMTR(canvasId, points) {
    const el = document.getElementById(canvasId);
    if (!el || !Array.isArray(points) || points.length === 0 || !window.Chart) return;
    if (el._chart) el._chart.destroy();

    const xs = points.map(p => p.income || 0);
    const ys = points.map(p => (p.rate || 0) * 100);

    el._chart = new Chart(el, {
      type: 'line',
      data: { labels: xs, datasets: [{ data: ys, borderWidth: 2, fill: false, tension: 0.2 }] },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.parsed.y.toFixed(1)}% EMTR` } }
        },
        scales: {
          x: { title: { display: true, text: 'Annualised income (£)' }, ticks: { callback: (v, i) => '£' + Number(xs[i]).toLocaleString() } },
          y: { title: { display: true, text: 'Rate (%)' }, min: 0, max: 70 }
        }
      }
    });
  }

  // ---- Gauges
  function renderGauges(containerId, gauges) {
    const c = document.getElementById(containerId);
    if (!c) return; c.innerHTML = '';
    const entries = [
      ['Personal allowance', gauges.personalAllowance],
      ['Dividend allowance', gauges.dividendAllowance],
      ['CGT allowance',      gauges.cgtAllowance],
      ['Pension annual',     gauges.pensionAnnual],
      ['ISA',                gauges.isa]
    ];
    for (const [label, g] of entries) {
      const used = Math.max(0, Number(g?.used || 0));
      const total = Math.max(1, Number(g?.total || 1));
      const pct = Math.min(100, Math.round((used / total) * 100));
      const pretty = (n) => '£' + Number(n).toLocaleString();
      const tile = document.createElement('div');
      tile.className = 'col-12 col-md-6';
      tile.innerHTML = `
        <div class="border rounded p-3 h-100">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <div class="fw-semibold">${label}</div>
            <div class="text-muted small">${pretty(used)} / ${pretty(total)}</div>
          </div>
          <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar" style="width:${pct}%"></div>
          </div>
        </div>`;
      c.appendChild(tile);
    }
  }

  // ---- Events
  const USER_EVENTS_KEY = 'userEvents';
  function loadUserEvents(){ try { return JSON.parse(localStorage.getItem(USER_EVENTS_KEY) || '[]'); } catch { return []; } }
  function renderEventsTable(defaults, userEvents) {
    const tbody = byId('events-tbody'), empty = byId('events-empty');
    if (!tbody) return; tbody.innerHTML = '';
    const now = new Date();
    const combined = [...defaults.map(d => ({...d, kind:'default'})), ...userEvents.map(u => ({...u, kind:'user'}))]
      .filter(ev => !ev.date || new Date(ev.date) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
      .sort((a,b)=> new Date(a.date) - new Date(b.date));
    if (combined.length === 0) { if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';
    for (const ev of combined) {
      const tr = document.createElement('tr');
      const d = ev.date ? new Date(ev.date) : null;
      const dateStr = d ? d.toLocaleDateString() : '—';
      tr.className = ev.kind === 'user' ? 'event-user' : 'event-default';
      tr.innerHTML = `
        <td class="text-nowrap">${dateStr}</td>
        <td><span class="event-title" title="${escapeHtml(ev.description || '')}">${escapeHtml(ev.title || 'Event')}</span></td>
        <td class="text-end">${ev.kind==='user'?`<button class="btn btn-sm btn-link text-danger p-0" title="Delete"><i class="bi bi-x-circle"></i></button>`:''}</td>`;
      if (ev.kind === 'user') tr.querySelector('button')?.addEventListener('click', () => {
        const next = loadUserEvents().filter(x => x.id !== ev.id);
        localStorage.setItem(USER_EVENTS_KEY, JSON.stringify(next));
        renderEventsTable(defaults, next);
      });
      tbody.appendChild(tr);
    }
  }
  function defaultUkEvents2025_26(){
    return [
      { title: 'Second payment on account (2024/25) due', date: '2025-07-31', description: 'HMRC SA 2nd payment on account (if applicable).' },
      { title: 'Register for Self Assessment (new filers)', date: '2025-10-05', description: 'Deadline to register if you need to file for 2024/25.' },
      { title: 'Paper tax return deadline (2024/25)', date: '2025-10-31', description: 'Submit paper SA return by midnight.' },
      { title: 'PAYE coding via online SA (if applicable)', date: '2025-12-30', description: 'Deadline to have tax collected via PAYE through return.' },
      { title: 'Online SA return + balancing payment (2024/25)', date: '2026-01-31', description: 'Online filing; balancing payment and 1st POA (2025/26).' },
      { title: 'End of tax year (2025/26)', date: '2026-04-05', description: 'Last day to use ISA & pension allowances and CGT AE for 2025/26.' },
      { title: 'New tax year (2026/27) starts', date: '2026-04-06', description: 'Reset allowances; update planning.' }
    ];
  }

  // ---- Financial Posture render
  function renderFinancialPosture(fp, trends) {
    setText('fp-networth-date', fp.asOf);
    setText('fp-networth-total', money(fp.netWorth.total));
    const ul = byId('fp-networth-breakdown');
    if (ul) {
      ul.innerHTML = '';
      for (const row of [
        ['Savings', fp.netWorth.savings],
        ['Investments', fp.netWorth.investments],
        ['Assets', fp.netWorth.assets],
        ['Credit (owed)', -Math.abs(fp.netWorth.credit)],
        ['Loans (owed)', -Math.abs(fp.netWorth.loans)]
      ]) {
        const li = document.createElement('li');
        li.innerHTML = `<span>${row[0]}</span> <span class="float-end fw-semibold">${money(row[1])}</span>`;
        ul.appendChild(li);
      }
    }
    // Networth doughnut
    if (window.Chart) {
      const nw = byId('fp-networth-chart');
      if (nw) { if (nw._chart) nw._chart.destroy(); nw._chart = new Chart(nw, {
        type: 'doughnut',
        data: {
          labels: ['Savings','Investments','Assets','Credit','Loans'],
          datasets: [{ data: [
            fp.netWorth.savings,
            fp.netWorth.investments,
            fp.netWorth.assets,
            Math.abs(fp.netWorth.credit),
            Math.abs(fp.netWorth.loans)
          ]}]
        },
        options: { plugins: { legend: { display: true, position: 'bottom' } }, cutout: '60%' }
      });}
    }
    // Inc/Spend KPIs + bar
    setText('fp-inc-total', money(fp.lastMonth.incomeTotal));
    setText('fp-spend-total', money(fp.lastMonth.spendTotal));
    setText('fp-spend-notes', fp.lastMonth.spendNote || '');
    if (window.Chart) {
      const isEl = byId('fp-incspend-chart');
      if (isEl) { if (isEl._chart) isEl._chart.destroy(); isEl._chart = new Chart(isEl, {
        type: 'bar',
        data: { labels: fp.lastMonth.categories.map(c => c.name), datasets: [{ data: fp.lastMonth.categories.map(c => c.amount) }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '£'+Number(v).toLocaleString() } } } }
      });}
    }
    // Allocation donut
    if (window.Chart) {
      const alloc = byId('fp-allocation-chart');
      if (alloc && fp.investments && Array.isArray(fp.investments.allocation)) {
        if (alloc._chart) alloc._chart.destroy();
        alloc._chart = new Chart(alloc, {
          type: 'doughnut',
          data: { labels: fp.investments.allocation.map(a=>a.label), datasets: [{ data: fp.investments.allocation.map(a=>a.pct) }] },
          options: { plugins: { legend: { display: true, position: 'bottom' } }, cutout: '60%' }
        });
      }
      const line = byId('fp-portfolio-line');
      if (line && fp.investments && Array.isArray(fp.investments.history)) {
        if (line._chart) line._chart.destroy();
        line._chart = new Chart(line, {
          type: 'line',
          data: { labels: fp.investments.history.map(h=>h.label), datasets: [{ data: fp.investments.history.map(h=>h.value), borderWidth:2, fill:false, tension:.2 }] },
          options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '£'+Number(v).toLocaleString() } } } }
        });
      }
    }
    // Top costs table with trend
    const tbody = byId('fp-top-costs-body');
    if (tbody && trends?.expensesTop) {
      tbody.innerHTML = '';
      for (const c of trends.expensesTop) {
        const ch = Number(c.changePct || 0);
        const cls = ch > 0 ? 'text-danger' : ch < 0 ? 'text-success' : 'text-muted';
        const arrow = ch > 0 ? '▲' : ch < 0 ? '▼' : '•';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(c.name)}</td>
          <td class="text-end">${money(c.amount)}</td>
          <td class="text-end ${cls}"><span class="fw-semibold">${arrow} ${Math.abs(ch)}%</span></td>
        `;
        tbody.appendChild(tr);
      }
    }
  }

  // ---- utils
  function byId(id){ return document.getElementById(id); }
  function setText(id, txt) { const el = byId(id); if (el) el.textContent = txt; }
  function softError(msg) {
    const wf = byId('chart-waterfall');
    if (wf) wf.insertAdjacentHTML('beforebegin', `<div class="text-danger small">${escapeHtml(msg)}</div>`);
  }
  function safeTaxYearLabel(d) {
    const y = d.getFullYear(), start = new Date(y, 3, 6);
    return d >= start ? `${y}/${String((y+1)%100).padStart(2,'0')}` : `${y-1}/${String(y%100).padStart(2,'0')}`;
  }
  function money(n){ return '£' + Number(n || 0).toLocaleString(); }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
})();
