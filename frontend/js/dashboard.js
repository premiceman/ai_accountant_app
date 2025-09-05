// frontend/js/dashboard.js
(function () {
  init().catch(err => {
    console.error('Dashboard init failed:', err);
    softError('Could not load dashboard: ' + (err?.message || err));
  });

  async function init() {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Dashboard');
    const g = document.getElementById('greeting-name');
    if (g && me?.firstName) g.textContent = me.firstName;

    // fetch summary (best effort)
    let data = {};
    try {
      const res = await API.fetch('/api/summary/current-year', { headers: { Authorization: `Bearer ${Auth.getToken()}` } });
      if (res.ok) data = await res.json();
    } catch (e) {
      console.warn('Summary API failed, using fallbacks.', e);
    }

    // Year label
    setText('dash-year', `Tax year ${data?.year || safeTaxYearLabel(new Date())}`);

    // Render parts (never let one failure kill the rest)
    try { renderWaterfall('chart-waterfall', data.waterfall || mockWaterfall(), data.currency || 'GBP'); } catch (e) { console.error('Waterfall render:', e); }
    try { renderEMTR('chart-emtr', data.emtr || mockEMTR()); } catch (e) { console.error('EMTR render:', e); }
    try { renderGauges('gauges', data.gauges || mockGauges()); } catch (e) { console.error('Gauges render:', e); }

    // Events (API may not provide — always show defaults + user events)
    try {
      const defaults = defaultUkEvents2025_26();
      const userEvents = loadUserEvents();
      renderEventsTable(defaults, userEvents);
      wireAddEvent(defaults, userEvents);
    } catch (e) {
      console.error('Events render:', e);
    }

    // Financial Posture (mock analytics)
    try { renderFinancialPosture(mockFinancialPosture()); } catch (e) { console.error('Financial Posture render:', e); }
  }

  // ---------------- Utilities ----------------
  function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
  function softError(msg) {
    const wf = document.getElementById('chart-waterfall');
    if (wf) wf.insertAdjacentHTML('beforebegin', `<div class="text-danger small">${msg}</div>`);
  }
  function safeTaxYearLabel(d) {
    const y = d.getFullYear(); const start = new Date(y, 3, 6);
    const ty = d >= start ? `${y}/${String((y+1)%100).padStart(2,'0')}` : `${y-1}/${String(y%100).padStart(2,'0')}`;
    return ty;
  }

  // ---------------- Charts ----------------
  function renderWaterfall(canvasId, steps, currency = 'GBP') {
    const el = document.getElementById(canvasId);
    if (!el || !Array.isArray(steps) || steps.length === 0 || !window.Chart) return;
    const labels = steps.map(s => s.label);
    const values = steps.map(s => s.amount || 0);
    new Chart(el, {
      type: 'bar',
      data: { labels, datasets: [{ label: '£', data: values, borderWidth: 1 }] },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `£${(ctx.parsed.y || 0).toLocaleString()}` } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => '£' + Number(v).toLocaleString() } }
        }
      }
    });
  }

  function renderEMTR(canvasId, points) {
    const el = document.getElementById(canvasId);
    if (!el || !Array.isArray(points) || points.length === 0 || !window.Chart) return;
    const xs = points.map(p => p.income || 0);
    const ys = points.map(p => (p.rate || 0) * 100);
    new Chart(el, {
      type: 'line',
      data: { labels: xs, datasets: [{ data: ys, borderWidth: 2, fill: false, tension: 0.2 }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y.toFixed(1)}% EMTR` } } },
        scales: {
          x: { title: { display: true, text: 'Income (£)' }, ticks: { callback: (v, i) => '£' + Number(xs[i]).toLocaleString() } },
          y: { title: { display: true, text: 'Rate (%)' }, min: 0, max: 100 }
        }
      }
    });
  }

  function renderGauges(containerId, gauges) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
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

  // ---------------- Events ----------------
  const USER_EVENTS_KEY = 'userEvents';

  function loadUserEvents() {
    try { return JSON.parse(localStorage.getItem(USER_EVENTS_KEY) || '[]'); } catch { return []; }
  }
  function saveUserEvents(arr) {
    try { localStorage.setItem(USER_EVENTS_KEY, JSON.stringify(arr || [])); } catch {}
  }
  function renderEventsTable(defaults, userEvents) {
    const tbody = document.getElementById('events-tbody');
    const empty = document.getElementById('events-empty');
    if (!tbody) return;

    const rows = [];
    const now = new Date();
    const combined = [...defaults.map(d => ({...d, kind: 'default'})), ...userEvents.map(u => ({...u, kind:'user'}))];
    combined
      .filter(ev => !ev.date || new Date(ev.date) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
      .sort((a,b)=> new Date(a.date)-new Date(b.date));

    tbody.innerHTML = '';
    if (combined.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    for (const ev of combined) {
      const tr = document.createElement('tr');
      const d = ev.date ? new Date(ev.date) : null;
      const dateStr = d ? d.toLocaleDateString() : '—';
      tr.className = ev.kind === 'user' ? 'event-user' : 'event-default';
      tr.innerHTML = `
        <td class="text-nowrap">${dateStr}</td>
        <td><span class="event-title" title="${escapeHtml(ev.description || '')}">${escapeHtml(ev.title || 'Event')}</span></td>
        <td class="text-end">
          ${ev.kind === 'user' ? `<button class="btn btn-sm btn-link text-danger p-0" title="Delete" aria-label="Delete"><i class="bi bi-x-circle"></i></button>` : ''}
        </td>
      `;

      if (ev.kind === 'user') {
        tr.querySelector('button')?.addEventListener('click', () => {
          const next = loadUserEvents().filter(x => x.id !== ev.id);
          saveUserEvents(next);
          renderEventsTable(defaults, next);
        });
      }
      tbody.appendChild(tr);
    }
  }

  function wireAddEvent(defaults, currentUserEvents) {
    const btn = document.getElementById('btn-add-event');
    if (!btn) return;
    const modalEl = document.getElementById('eventModal');
    const form = document.getElementById('event-form');
    const modal = modalEl ? new bootstrap.Modal(modalEl) : null;

    btn.addEventListener('click', () => {
      if (!modal) return;
      form.reset();
      modal.show();
    });

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('event-title').value.trim();
      const date  = document.getElementById('event-date').value;
      const repeat = document.getElementById('event-repeat').value;
      const desc  = document.getElementById('event-desc').value.trim();
      if (!title || !date) return;

      const id = cryptoId();
      const first = { id, title, date, description: desc };
      let toSave = [first];

      if (repeat === 'monthly') {
        let dt = new Date(date);
        for (let i=1;i<12;i++){ const n=new Date(dt); n.setMonth(n.getMonth()+i); toSave.push({ id: cryptoId(), title, date: isoDate(n), description: desc }); }
      } else if (repeat === 'quarterly') {
        let dt = new Date(date);
        for (let i=1;i<4;i++){ const n=new Date(dt); n.setMonth(n.getMonth()+i*3); toSave.push({ id: cryptoId(), title, date: isoDate(n), description: desc }); }
      } else if (repeat === 'yearly') {
        let dt = new Date(date); const n=new Date(dt); n.setFullYear(n.getFullYear()+1); toSave.push({ id: cryptoId(), title, date: isoDate(n), description: desc });
      }

      const all = [...loadUserEvents(), ...toSave];
      saveUserEvents(all);
      renderEventsTable(defaults, all);
      modal?.hide();
    });
  }

  function defaultUkEvents2025_26() {
    // UK highlights spanning TY 2025/26 context, plus key SA deadlines
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

  // ---------------- Financial Posture ----------------
  function renderFinancialPosture(fp) {
    // Net worth totals & chart
    setText('fp-networth-date', fp.asOf);
    setText('fp-networth-total', money(fp.netWorth.total));
    const ul = document.getElementById('fp-networth-breakdown');
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
    if (window.Chart) {
      const nw = document.getElementById('fp-networth-chart');
      if (nw) new Chart(nw, {
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
      });
    }

    // Income & spend
    setText('fp-inc-total', money(fp.lastMonth.incomeTotal));
    setText('fp-inc-notes', fp.lastMonth.incomeNote);
    setText('fp-spend-total', money(fp.lastMonth.spendTotal));
    setText('fp-spend-notes', fp.lastMonth.spendNote);
    if (window.Chart) {
      const isEl = document.getElementById('fp-incspend-chart');
      if (isEl) new Chart(isEl, {
        type: 'bar',
        data: {
          labels: fp.lastMonth.categories.map(c => c.name),
          datasets: [{ data: fp.lastMonth.categories.map(c => c.amount) }]
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '£'+Number(v).toLocaleString() } } } }
      });
    }

    // Top costs
    const tbody = document.getElementById('fp-top-costs-body');
    if (tbody) {
      tbody.innerHTML = '';
      fp.lastMonth.categories
        .slice().sort((a,b)=> b.amount - a.amount).slice(0,5)
        .forEach(c => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${escapeHtml(c.name)}</td><td class="text-end fw-semibold">${money(c.amount)}</td>`;
          tbody.appendChild(tr);
        });
    }

    // Investments perf + allocation
    setText('fp-perf-ytd', `YTD ${fp.investments.ytdReturnPct > 0 ? '+' : ''}${fp.investments.ytdReturnPct.toFixed(1)}%`);
    if (window.Chart) {
      const alloc = document.getElementById('fp-allocation-chart');
      if (alloc) new Chart(alloc, { type: 'doughnut', data: {
        labels: fp.investments.allocation.map(a=>a.label),
        datasets: [{ data: fp.investments.allocation.map(a=>a.pct) }]
      }, options: { plugins: { legend: { display: true, position: 'bottom' } }, cutout: '60%'} });

      const line = document.getElementById('fp-portfolio-line');
      if (line) new Chart(line, {
        type: 'line',
        data: { labels: fp.investments.history.map(h=>h.label), datasets: [{ data: fp.investments.history.map(h=>h.value), borderWidth:2, fill:false, tension:.2 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '£'+Number(v).toLocaleString() } } } }
      });
    }
  }

  // ---------------- Mock data ----------------
  function mockWaterfall() {
    return [
      { label: 'Gross pay', amount: 65000 },
      { label: 'Income tax', amount: -12000 },
      { label: 'NI', amount: -5200 },
      { label: 'Pension', amount: -6000 },
      { label: 'Take-home', amount: 41800 }
    ];
  }
  function mockEMTR() {
    const pts = [];
    for (let i=0;i<=8;i++){ const inc = 20000 + i*7500; pts.push({ income: inc, rate: 0.1 + (i*0.03) }); }
    return pts;
  }
  function mockGauges() {
    return {
      personalAllowance: { used: 12570, total: 12570 },
      dividendAllowance: { used: 300, total: 500 },
      cgtAllowance:      { used: 1500, total: 3000 },
      pensionAnnual:     { used: 12000, total: 60000 },
      isa:               { used: 6000, total: 20000 }
    };
  }
  function mockFinancialPosture() {
    const today = new Date();
    const asOf = today.toLocaleDateString();
    // Net worth
    const savings = 22000, investments = 68000, assets = 15000, credit = 2500, loans = 12000;
    // Last month
    const categories = [
      { name: 'Rent/Mortgage', amount: 1500 },
      { name: 'Food & Groceries', amount: 520 },
      { name: 'Transport', amount: 210 },
      { name: 'Utilities', amount: 190 },
      { name: 'Insurance', amount: 110 },
      { name: 'Entertainment', amount: 160 },
      { name: 'Shopping', amount: 230 }
    ];
    const spendTotal = categories.reduce((a,b)=>a+b.amount,0);
    const incomeTotal = 5100;
    // Investments
    const allocation = [
      { label: 'Equities', pct: 60 },
      { label: 'Bonds',    pct: 20 },
      { label: 'Cash',     pct: 10 },
      { label: 'Alt',      pct: 10 }
    ];
    const history = [];
    let v = 72000;
    for (let i=11; i>=0; i--) {
      const d = new Date(today); d.setMonth(d.getMonth()-i);
      v += (Math.random()-0.4)*1200;
      history.push({ label: d.toLocaleDateString(undefined, { month:'short' }), value: Math.max(55000, Math.round(v)) });
    }
    const ytd = ((history.at(-1).value / history[0].value) - 1) * 100;

    return {
      asOf,
      netWorth: {
        total: savings + investments + assets - credit - loans,
        savings, investments, assets, credit, loans
      },
      lastMonth: {
        incomeTotal, spendTotal,
        incomeNote: 'Incl. salary + dividends',
        spendNote:  'All card & bank tx',
        categories
      },
      investments: {
        ytdReturnPct: ytd,
        allocation,
        history
      }
    };
  }

  // --------------- helpers ---------------
  function money(n){ return '£' + Number(n || 0).toLocaleString(); }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function isoDate(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${da}`; }
  function cryptoId(){ return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); }
})();
