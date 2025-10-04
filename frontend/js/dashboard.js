// frontend/js/dashboard.js
(function () {
  const RANGE_KEY = 'dashboardRangeV2';
  const DELTA_KEY = 'dashboardDeltaModeV1';
  const tierOrder = { free: 0, starter: 1, growth: 2, premium: 3 };

  init().catch((err) => {
    console.error('Dashboard failed to initialise', err);
    softError('Unable to load dashboard. Please refresh.');
  });

  async function init() {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Intelligence Dashboard');
    applyTierLocks(me);
    wireRangePicker();
    wireDeltaButtons(me);
    await reloadDashboard();
  }

  function applyTierLocks(me) {
    const tierLevel = tierOrder[me?.licenseTier] ?? 0;
    document.querySelectorAll('[data-required-tier]').forEach((section) => {
      const required = tierOrder[section.dataset.requiredTier] ?? Infinity;
      const overlay = section.querySelector('[data-tier-lock]');
      const cards = section.querySelectorAll('.card');
      if (tierLevel < required) {
        overlay?.classList.remove('d-none');
        cards.forEach((c) => c.classList.add('locked'));
      } else {
        overlay?.classList.add('d-none');
        cards.forEach((c) => c.classList.remove('locked'));
      }
    });
  }

  function defaultRange() {
    return { mode: 'preset', preset: 'last-quarter', start: null, end: null };
  }
  function loadRange() {
    try { return JSON.parse(localStorage.getItem(RANGE_KEY) || 'null') || defaultRange(); }
    catch { return defaultRange(); }
  }
  function saveRange(st) {
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(st)); } catch {}
  }

  function loadDeltaMode() {
    return localStorage.getItem(DELTA_KEY) || 'absolute';
  }
  function saveDeltaMode(mode) {
    localStorage.setItem(DELTA_KEY, mode);
  }

  function wireDeltaButtons(me) {
    const mode = (me?.preferences?.deltaMode || loadDeltaMode());
    const btnAbs = byId('delta-absolute');
    const btnPct = byId('delta-percent');
    setDeltaActive(mode);

    [btnAbs, btnPct].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const newMode = btn.id === 'delta-percent' ? 'percent' : 'absolute';
        setDeltaActive(newMode);
        saveDeltaMode(newMode);
        try {
          await Auth.fetch('/api/user/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deltaMode: newMode })
          });
        } catch (err) {
          console.warn('Failed to persist delta mode', err);
        }
        await reloadDashboard();
      });
    });
  }

  function setDeltaActive(mode) {
    document.querySelectorAll('#delta-absolute,#delta-percent').forEach((btn) => {
      if (!btn) return;
      const active = (mode === 'percent' ? btn.id === 'delta-percent' : btn.id === 'delta-absolute');
      btn.classList.toggle('active', active);
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn-outline-primary', !active);
    });
  }

  function wireRangePicker() {
    const st = loadRange();
    const quickBtn = byId('rng-btn-quick');
    const customBtn = byId('rng-btn-custom');
    const quickPane = byId('rng-quick');
    const customPane = byId('rng-custom');

    function setMode(mode) {
      st.mode = mode;
      saveRange(st);
      quickPane.style.display = mode === 'preset' ? '' : 'none';
      customPane.style.display = mode === 'custom' ? '' : 'none';
      quickBtn.classList.toggle('active', mode === 'preset');
      customBtn.classList.toggle('active', mode === 'custom');
    }

    quickBtn?.addEventListener('click', () => setMode('preset'));
    customBtn?.addEventListener('click', () => setMode('custom'));

    document.querySelectorAll('input[name="rngQuick"]').forEach((el) => {
      el.addEventListener('change', () => {
        st.preset = el.value;
        saveRange(st);
      });
    });

    byId('rng-apply-quick')?.addEventListener('click', () => reloadDashboard());
    byId('rng-apply-custom')?.addEventListener('click', () => {
      const start = byId('rng-start').value;
      const end = byId('rng-end').value;
      if (!start || !end) return alert('Select a start and end date.');
      if (new Date(start) > new Date(end)) return alert('Start date must be before end date.');
      st.start = start;
      st.end = end;
      saveRange(st);
      reloadDashboard();
    });

    setMode(st.mode || 'preset');
    const presetEl = byId(`rng-${st.preset || 'last-quarter'}`) || byId('rng-last-quarter');
    if (presetEl) presetEl.checked = true;
    if (st.start) byId('rng-start').value = st.start;
    if (st.end) byId('rng-end').value = st.end;
  }

  async function reloadDashboard() {
    setText('dash-year', `Tax year ${safeTaxYearLabel(new Date())}`);
    const st = loadRange();
    const params = new URLSearchParams();
    if (st.mode === 'custom' && st.start && st.end) {
      params.set('start', st.start);
      params.set('end', st.end);
    } else {
      params.set('preset', st.preset || 'last-quarter');
    }
    params.set('t', Date.now());

    let data = null;
    try {
      const res = await Auth.fetch(`/api/analytics/dashboard?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Analytics ${res.status}`);
      data = await res.json();
    } catch (err) {
      console.error('Analytics load error', err);
      softError('Unable to load analytics data.');
      return;
    }

    updateRangeLabel(data.range);
    renderSuggestions(data);
    renderAccounting(data);
    renderFinancialPosture(data);
    renderSalaryNavigator(data);
    renderWealthLab(data);
  }

  function updateRangeLabel(range) {
    const label = range?.label || '—';
    setText('range-current', label);
  }

  function renderSuggestions(data) {
    const wrap = byId('ai-suggestions');
    const empty = byId('ai-suggestions-empty');
    if (!wrap) return;
    wrap.innerHTML = '';
    const insights = Array.isArray(data.aiInsights) ? data.aiInsights : [];
    if (!insights.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    for (const insight of insights) {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-xl-4';
      col.innerHTML = `
        <div class="border rounded h-100 p-3 bg-light">
          <div class="d-flex align-items-center gap-2 mb-2">
            <i class="bi bi-stars text-primary"></i>
            <span class="fw-semibold">${escapeHtml(insight.title || 'Insight')}</span>
          </div>
          <p class="small mb-2">${escapeHtml(insight.body || 'Connect your accounts to unlock personalised commentary.')}</p>
          ${insight.action ? `<button class="btn btn-sm btn-outline-primary">${escapeHtml(insight.action)}</button>` : ''}
        </div>`;
      wrap.appendChild(col);
    }
  }

  function renderAccounting(data) {
    const metrics = data.accounting?.metrics || [];
    applyMetric('kpi-tax-band', metrics.find((m) => m.key === 'taxBand'));
    applyMetric('kpi-tax-pos', metrics.find((m) => m.key === 'hmrcBalance'), { subId: 'kpi-tax-pos-sub' });
    applyMetric('kpi-income', metrics.find((m) => m.key === 'income'), { deltaId: 'kpi-income-delta' });
    applyMetric('kpi-spend', metrics.find((m) => m.key === 'spend'), { deltaId: 'kpi-spend-delta' });
    setText('comparison-label', data.accounting?.comparatives?.label || 'Comparing to previous period');

    renderWaterfall('chart-waterfall', data.accounting?.waterfall || []);
    renderEMTR('chart-emtr', data.accounting?.emtr || []);
    renderGauges('gauges', data.accounting?.allowances || {});

    const defaults = defaultUkEvents2025_26();
    const userEvents = loadUserEvents();
    renderEventsTable(defaults, userEvents, data.hasData);
  }

  function applyMetric(id, metric, opts = {}) {
    const el = byId(id);
    if (!el) return;
    if (!metric) {
      el.textContent = '—';
      if (opts.subId) setText(opts.subId, 'No data — set up your integrations to get started.');
      if (opts.deltaId) setText(opts.deltaId, '');
      return;
    }
    if (metric.format === 'currency') el.textContent = money(metric.value);
    else el.textContent = metric.value ?? '—';

    if (opts.subId) setText(opts.subId, metric.subLabel || '');
    if (opts.deltaId) setText(opts.deltaId, formatDelta(metric.delta, metric.deltaMode));
    if (opts.noteId) setText(opts.noteId, metric.note || '');
    if (opts.subtleId) setText(opts.subtleId, metric.subtle || '');
  }

  function formatDelta(delta, mode) {
    if (delta == null) return '';
    const positive = delta > 0;
    const symbol = positive ? '▲' : delta < 0 ? '▼' : '•';
    if (mode === 'percent') {
      return `${symbol} ${Math.abs(delta).toFixed(1)}%`;
    }
    return `${symbol} £${Math.abs(delta).toLocaleString()}`;
  }

  function renderFinancialPosture(data) {
    const fp = data.financialPosture || {};
    setText('fp-networth-date', fp.asOf || '—');
    setText('fp-networth-total', money(fp.netWorth?.total));
    const breakdown = Array.isArray(fp.breakdown) ? fp.breakdown : [];
    const list = byId('fp-networth-breakdown');
    if (list) {
      list.innerHTML = '';
      breakdown.forEach((row) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${escapeHtml(row.label || '')}</span><span class="float-end fw-semibold">${money(row.value)}</span>`;
        list.appendChild(li);
      });
    }
    toggleEmpty('fp-networth-empty', !breakdown.length);

    setText('fp-inc-total', money(fp.income?.total));
    setText('fp-inc-notes', fp.income?.note || '');
    setText('fp-spend-total', money(fp.spend?.total));
    setText('fp-spend-notes', fp.spend?.note || '');
    toggleEmpty('fp-income-empty', !Array.isArray(fp.income?.series) || !fp.income.series.length);

    renderDonut('fp-networth-chart', breakdown.map((b) => b.value), breakdown.map((b) => b.label));
    renderBar('fp-incspend-chart', (fp.income?.series || []).map((d) => d.label), (fp.income?.series || []).map((d) => d.value));
    renderDonut('fp-allocation-chart', (fp.investments?.allocation || []).map((a) => a.value), (fp.investments?.allocation || []).map((a) => a.label));
    renderLine('fp-portfolio-line', (fp.investments?.history || []).map((h) => h.label), (fp.investments?.history || []).map((h) => h.value));

    const topCostsBody = byId('fp-top-costs-body');
    if (topCostsBody) {
      topCostsBody.innerHTML = '';
      (data.financialPosture?.topCosts || []).forEach((item) => {
        const ch = Number(item.change || 0);
        const cls = ch > 0 ? 'text-danger' : ch < 0 ? 'text-success' : 'text-muted';
        const arrow = ch > 0 ? '▲' : ch < 0 ? '▼' : '•';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(item.label || '')}</td>
          <td class="text-end">${money(item.value)}</td>
          <td class="text-end ${cls}"><span class="fw-semibold">${arrow} ${Math.abs(ch)}%</span></td>`;
        topCostsBody.appendChild(tr);
      });
    }

    setText('fp-perf-ytd', fp.investments?.ytd != null ? `YTD ${Number(fp.investments.ytd).toFixed(1)}%` : 'YTD —%');
  }

  function renderSalaryNavigator(data) {
    const nav = data.salaryNavigator || {};
    setText('salary-current', money(nav.currentSalary));
    setText('salary-target', money(nav.targetSalary));
    const slider = byId('salary-target-slider');
    if (slider) {
      slider.value = Math.min(Math.max(Number(nav.targetSalary || nav.currentSalary || 0), slider.min), slider.max);
      slider.addEventListener('change', () => {
        const newVal = Number(slider.value);
        setText('salary-target', money(newVal));
        const alert = document.createElement('div');
        alert.className = 'alert alert-info mt-2';
        alert.textContent = 'Save pending — connect your HR integration to store this target automatically.';
        slider.closest('.card-body')?.appendChild(alert);
      }, { once: true });
    }

    setText('salary-next-review', nav.nextReviewAt ? new Date(nav.nextReviewAt).toLocaleDateString() : 'Set review date');
    const pct = Math.min(100, Math.max(0, Number(nav.progress || 0)));
    const bar = byId('salary-review-progress');
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.textContent = `${pct}%`;
    }

    const list = byId('salary-achievements');
    if (list) {
      list.innerHTML = '';
      (nav.achievements || []).forEach((ach) => {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        li.innerHTML = `<div class="fw-semibold">${escapeHtml(ach.title || 'Achievement')}</div><div class="small text-muted">${escapeHtml(ach.detail || '')}</div>`;
        list.appendChild(li);
      });
      if (!nav.achievements?.length) {
        list.innerHTML = '<li class="list-group-item text-muted">Add SMART objectives to build your promotion dossier.</li>';
      }
    }
  }

  function renderWealthLab(data) {
    const wealth = data.wealthPlan || {};
    renderList('wealth-assets', wealth.assets, 'Add your assets to calculate net worth.');
    renderList('wealth-liabilities', wealth.liabilities, 'Record liabilities to build a payoff plan.');
    const ctxValues = [wealth.summary?.strength || 0, 100 - (wealth.summary?.strength || 0)];
    renderDonut('wealth-strength-chart', ctxValues, ['Strength', 'Headroom']);
    setText('wealth-strategy', wealth.strategy?.summary || 'Connect your banks and upload statements to generate a tailored strategy.');
  }

  function renderList(id, items, emptyMsg) {
    const el = byId(id);
    if (!el) return;
    el.innerHTML = '';
    if (!Array.isArray(items) || !items.length) {
      el.innerHTML = `<li class="list-group-item text-muted">${escapeHtml(emptyMsg)}</li>`;
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-start gap-2';
      li.innerHTML = `
        <div>
          <div class="fw-semibold">${escapeHtml(item.label || 'Item')}</div>
          <div class="small text-muted">${escapeHtml(item.note || '')}</div>
        </div>
        <div class="fw-semibold">${money(item.value)}</div>`;
      el.appendChild(li);
    });
  }

  // ----- Charts -----
  function renderWaterfall(canvasId, steps) {
    const el = byId(canvasId);
    if (!el || !window.Chart) return;
    if (el._chart) el._chart.destroy();
    if (!Array.isArray(steps) || !steps.length) {
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
      return;
    }
    const labels = steps.map((s) => s.label);
    const values = steps.map((s) => Math.max(0, Number(s.amount || 0)));
    el._chart = new Chart(el, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: themeColors(values.length), borderWidth: 0 }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.parsed.y) } } },
        scales: {
          x: { stacked: false },
          y: { beginAtZero: true, ticks: { callback: (v) => money(v) } }
        }
      }
    });
  }

  function renderEMTR(canvasId, points) {
    const el = byId(canvasId);
    if (!el || !window.Chart) return;
    if (el._chart) el._chart.destroy();
    if (!Array.isArray(points) || !points.length) {
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
      return;
    }
    const xs = points.map((p) => p.income || 0);
    const ys = points.map((p) => (p.rate || 0) * 100);
    el._chart = new Chart(el, {
      type: 'line',
      data: { labels: xs, datasets: [{ data: ys, borderWidth: 2, fill: false, tension: 0.2 }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y.toFixed(1)}%` } } },
        scales: {
          x: { title: { display: true, text: 'Annualised income (£)' }, ticks: { callback: (v, i) => money(xs[i]) } },
          y: { title: { display: true, text: 'Rate (%)' }, min: 0, max: 70 }
        }
      }
    });
  }

  function renderGauges(containerId, gauges) {
    const container = byId(containerId);
    if (!container) return;
    container.innerHTML = '';
    const entries = Array.isArray(gauges) ? gauges : [];
    if (!entries.length) {
      container.innerHTML = '<div class="col-12 text-muted small">No data — set up your integrations to get started.</div>';
      return;
    }
    entries.forEach((g) => {
      const pct = Math.min(100, Math.round((Number(g.used || 0) / Math.max(1, Number(g.total || 1))) * 100));
      const pretty = (n) => money(n).replace('£-', '-£');
      const tile = document.createElement('div');
      tile.className = 'col-12 col-md-6';
      tile.innerHTML = `
        <div class="border rounded p-3 h-100">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <div class="fw-semibold">${escapeHtml(g.label || 'Allowance')}</div>
            <div class="text-muted small">${pretty(g.used)} / ${pretty(g.total)}</div>
          </div>
          <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar" style="width:${pct}%"></div>
          </div>
        </div>`;
      container.appendChild(tile);
    });
  }

  function renderDonut(id, data, labels) {
    const el = byId(id);
    if (!el || !window.Chart) return;
    if (el._chart) el._chart.destroy();
    if (!Array.isArray(data) || !data.length) {
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
      return;
    }
    el._chart = new Chart(el, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: themeColors(data.length) }] },
      options: { plugins: { legend: { display: true, position: 'bottom' } }, cutout: '60%' }
    });
  }

  function renderBar(id, labels, values) {
    const el = byId(id);
    if (!el || !window.Chart) return;
    if (el._chart) el._chart.destroy();
    if (!values.length) {
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
      return;
    }
    el._chart = new Chart(el, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: themeColors(values.length) }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => money(v) } } } }
    });
  }

  function renderLine(id, labels, values) {
    const el = byId(id);
    if (!el || !window.Chart) return;
    if (el._chart) el._chart.destroy();
    if (!values.length) {
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
      return;
    }
    el._chart = new Chart(el, {
      type: 'line',
      data: { labels, datasets: [{ data: values, borderWidth: 2, fill: false, tension: 0.2 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => money(v) } } } }
    });
  }

  // ----- Events -----
  const USER_EVENTS_KEY = 'userEvents';
  function loadUserEvents() {
    try { return JSON.parse(localStorage.getItem(USER_EVENTS_KEY) || '[]'); }
    catch { return []; }
  }
  function renderEventsTable(defaults, userEvents, hasData) {
    const tbody = byId('events-tbody');
    const empty = byId('events-empty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const combined = [...defaults.map((d) => ({ ...d, kind: 'default' })), ...userEvents.map((u) => ({ ...u, kind: 'user' }))]
      .filter((ev) => !ev.date || new Date(ev.date) >= new Date())
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!combined.length) {
      empty?.classList.remove('d-none');
      empty.textContent = hasData ? 'No upcoming events yet.' : 'No data — set up your integrations to get started.';
      return;
    }
    empty?.classList.add('d-none');

    combined.forEach((ev) => {
      const tr = document.createElement('tr');
      const date = ev.date ? new Date(ev.date) : null;
      tr.className = ev.kind === 'user' ? 'event-user' : 'event-default';
      tr.innerHTML = `
        <td class="text-nowrap">${date ? date.toLocaleDateString() : '—'}</td>
        <td><span class="event-title" title="${escapeHtml(ev.description || '')}">${escapeHtml(ev.title || 'Event')}</span></td>
        <td class="text-end">${ev.kind === 'user' ? '<button class="btn btn-sm btn-link text-danger p-0" title="Delete"><i class="bi bi-x-circle"></i></button>' : ''}</td>`;
      if (ev.kind === 'user') {
        tr.querySelector('button')?.addEventListener('click', () => {
          const next = loadUserEvents().filter((x) => x.id !== ev.id);
          localStorage.setItem(USER_EVENTS_KEY, JSON.stringify(next));
          renderEventsTable(defaults, next, hasData);
        });
      }
      tbody.appendChild(tr);
    });
  }

  function defaultUkEvents2025_26() {
    return [
      { title: 'Second payment on account due', date: '2025-07-31', description: 'HMRC self assessment payment on account.' },
      { title: 'Register for self assessment', date: '2025-10-05', description: 'Deadline to register if you need to file a return.' },
      { title: 'Paper tax return deadline', date: '2025-10-31', description: 'Submit paper tax return for 2024/25.' },
      { title: 'PAYE coding deadline', date: '2025-12-30', description: 'Have tax collected via PAYE through your return.' },
      { title: 'Online SA & payment deadline', date: '2026-01-31', description: 'Online filing and balancing payment deadline.' },
      { title: 'Tax year ends', date: '2026-04-05', description: 'Last day to use ISA, pension allowances, CGT AE.' },
      { title: 'New tax year begins', date: '2026-04-06', description: 'Reset allowances and begin planning.' }
    ];
  }

  // ----- Utilities -----
  function byId(id) { return document.getElementById(id); }
  function setText(id, value) { const el = byId(id); if (el) el.textContent = value ?? '—'; }
  function toggleEmpty(id, show) {
    const el = byId(id);
    if (!el) return;
    el.classList.toggle('d-none', !show);
  }
  function softError(message) {
    const container = document.querySelector('.page-title');
    if (container) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-danger mt-3';
      alert.textContent = message;
      container.insertAdjacentElement('afterend', alert);
    }
  }
  function safeTaxYearLabel(date) {
    const y = date.getFullYear();
    const start = new Date(y, 3, 6);
    return date >= start ? `${y}/${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}/${String(y % 100).padStart(2, '0')}`;
  }
  function money(value) {
    const num = Number(value || 0);
    const prefix = num < 0 ? '-£' : '£';
    return `${prefix}${Math.abs(num).toLocaleString()}`;
  }
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function themeColors(n) {
    const root = getComputedStyle(document.documentElement);
    const palette = ['--chart-1','--chart-2','--chart-3','--chart-4','--chart-5','--chart-6','--chart-7','--chart-8']
      .map((v) => root.getPropertyValue(v).trim())
      .filter(Boolean);
    const fallback = ['#4a78ff','#60c8ff','#7dd3a8','#f5a524','#ef4d72','#8b5cf6','#f59e0b','#10b981'];
    const base = palette.length ? palette : fallback;
    return Array.from({ length: n }, (_, i) => base[i % base.length]);
  }
})();
