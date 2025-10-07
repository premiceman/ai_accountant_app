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
    return { mode: 'preset', preset: 'current-month', start: null, end: null };
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
        if (!el.checked) return;
        st.mode = 'preset';
        st.preset = el.value;
        st.start = null;
        st.end = null;
        saveRange(st);
        reloadDashboard();
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
    const presetEl = byId(`rng-${st.preset || 'current-month'}`) || byId('rng-current-month');
    if (presetEl) presetEl.checked = true;
    if (st.start) byId('rng-start').value = st.start;
    if (st.end) byId('rng-end').value = st.end;
  }

  async function reloadDashboard() {
    // TODO(analytics-cache): Once worker-backed cache is live, detect stale payloads and
    // surface a "refreshing" indicator while background recompute runs.
    setText('dash-year', `Tax year ${safeTaxYearLabel(new Date())}`);
    const st = loadRange();
    const params = new URLSearchParams();
    if (st.mode === 'custom' && st.start && st.end) {
      params.set('start', st.start);
      params.set('end', st.end);
    } else {
      params.set('preset', st.preset || 'current-month');
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

    toggleDashboardEmpty(data.hasData);
    updateRangeLabel(data.range);
    renderSuggestions(data);
    renderAccounting(data);
    renderFinancialPosture(data);
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
    setAccountingLoading(data.accounting?.processing);
    const metrics = data.accounting?.metrics || [];
    applyMetric('kpi-savings', metrics.find((m) => m.key === 'savingsCapacity'), { subId: 'kpi-savings-sub', deltaId: 'kpi-savings-delta' });
    applyMetric('kpi-hmrc', metrics.find((m) => m.key === 'hmrcBalance'), { subId: 'kpi-hmrc-sub' });
    applyMetric('kpi-income', metrics.find((m) => m.key === 'income'), { deltaId: 'kpi-income-delta' });
    applyMetric('kpi-spend', metrics.find((m) => m.key === 'spend'), { deltaId: 'kpi-spend-delta' });
    const comparatives = data.accounting?.comparatives || {};
    setText('comparison-label', comparatives.label || 'Comparing to previous period');

    renderPayslipAnalytics(data.accounting?.payslipAnalytics || null, data.accounting?.rangeStatus || {});
    renderStatementHighlights(data.accounting?.statementHighlights || null, data.accounting?.rangeStatus || {});
    renderSpendCategory(
      data.accounting?.spendingCanteorgies || data.accounting?.spendByCategory || [],
      data.accounting?.rangeStatus || {}
    );
    renderInflationTrend(data.accounting?.inflationTrend || []);
    renderLargestExpenses(data.accounting?.largestExpenses || [], data.accounting?.rangeStatus || {});
    renderDuplicates(data.accounting?.duplicates || []);
    renderGauges('gauges', data.accounting?.allowances || []);
    renderObligations(data.accounting?.obligations || [], data.accounting?.hmrcBalance);
    renderAlerts(data.accounting?.alerts || []);
  }

  function renderSpendCategory(categories, rangeStatus = {}) {
    const total = categories.reduce((acc, item) => acc + Number(item.amount || 0), 0);
    setText('spend-category-total', categories.length ? money(total) : '£—');
    renderDonut('chart-spend-category', categories.map((c) => Math.round(Number(c.amount || 0))), categories.map((c) => c.label || c.category));
    const tbody = byId('spend-category-table');
    const empty = byId('spend-category-empty');
    if (tbody) {
      tbody.innerHTML = '';
      categories.forEach((cat) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(cat.label || cat.category || 'Category')}</td>
          <td class="text-end">${money(cat.amount)}</td>
          <td class="text-end">${((cat.share || 0) * 100).toFixed(1)}%</td>`;
        tbody.appendChild(tr);
      });
    }
    if (!categories.length) {
      empty?.classList.remove('d-none');
      if (empty) empty.textContent = rangeStatus.statements || 'No spending captured for this range.';
    } else {
      empty?.classList.add('d-none');
    }
  }

  function renderInflationTrend(points) {
    const labels = points.map((p) => p.label);
    const nominal = points.map((p) => p.nominal);
    const real = points.map((p) => p.real);
    renderLineMulti('chart-inflation-trend', labels, [
      { label: 'Nominal', data: nominal },
      { label: 'Real', data: real }
    ]);
  }

  function renderPayslipAnalytics(analytics, rangeStatus = {}) {
    const empty = byId('payslip-empty');
    const grossEl = byId('payslip-gross');
    const grossYtdEl = byId('payslip-gross-ytd');
    const netEl = byId('payslip-net');
    const netYtdEl = byId('payslip-net-ytd');
    const dedEl = byId('payslip-deductions');
    const taxCodeEl = byId('payslip-tax-code');
    const emtrEl = byId('payslip-emtr');
    const emtrCompareEl = byId('payslip-emtr-compare');
    const notesEl = byId('payslip-notes');
    const freqEl = byId('payslip-frequency');
    const earningsTable = byId('payslip-earnings-table')?.querySelector('tbody');
    const deductionsTable = byId('payslip-deductions-table')?.querySelector('tbody');

    if (!analytics || Object.keys(analytics).length === 0) {
      if (grossEl) grossEl.textContent = '£—';
      if (grossYtdEl) grossYtdEl.textContent = '';
      if (netEl) netEl.textContent = '£—';
      if (netYtdEl) netYtdEl.textContent = '';
      if (dedEl) dedEl.textContent = '£—';
      if (taxCodeEl) taxCodeEl.textContent = '';
      if (emtrEl) emtrEl.textContent = '—%';
      if (emtrCompareEl) emtrCompareEl.textContent = '';
      if (freqEl) freqEl.textContent = '—';
      if (earningsTable) earningsTable.innerHTML = '';
      if (deductionsTable) deductionsTable.innerHTML = '';
      if (notesEl) notesEl.textContent = '';
      if (empty) {
        empty.textContent = rangeStatus.payslip || 'Upload a current payslip to unlock granular analytics.';
        empty.classList.remove('d-none');
      }
      return;
    }

    empty?.classList.add('d-none');
    if (grossEl) grossEl.textContent = analytics.gross != null ? money(analytics.gross) : '£—';
    if (grossYtdEl) grossYtdEl.textContent = analytics.grossYtd != null ? `YTD ${money(analytics.grossYtd)}` : '';
    if (netEl) netEl.textContent = analytics.net != null ? money(analytics.net) : '£—';
    if (netYtdEl) netYtdEl.textContent = analytics.netYtd != null ? `YTD ${money(analytics.netYtd)}` : '';
    if (dedEl) dedEl.textContent = analytics.totalDeductions != null ? money(analytics.totalDeductions) : '£—';
    if (taxCodeEl) taxCodeEl.textContent = analytics.taxCode ? `Tax code ${analytics.taxCode}` : '';
    const emtr = typeof analytics.effectiveMarginalRate === 'number' ? analytics.effectiveMarginalRate : null;
    if (emtrEl) emtrEl.textContent = emtr != null ? `${(emtr * 100).toFixed(1)}%` : '—%';
    if (emtrCompareEl) {
      emtrCompareEl.classList.remove('text-danger', 'text-success', 'text-muted');
      emtrCompareEl.classList.add('small');
      const expected = typeof analytics.expectedMarginalRate === 'number' ? analytics.expectedMarginalRate : null;
      if (expected != null && emtr != null) {
        const delta = analytics.marginalRateDelta != null ? analytics.marginalRateDelta : emtr - expected;
        const arrow = delta > 0.02 ? '▲' : delta < -0.02 ? '▼' : '•';
        emtrCompareEl.textContent = `${arrow} expected ${(expected * 100).toFixed(1)}%`;
        emtrCompareEl.classList.add(Math.abs(delta) <= 0.02 ? 'text-muted' : delta > 0.02 ? 'text-danger' : 'text-success');
      } else {
        emtrCompareEl.textContent = '';
        emtrCompareEl.classList.add('text-muted');
      }
    }
    if (freqEl) freqEl.textContent = analytics.payFrequency || '—';

    const renderRows = (tbody, rows) => {
      if (!tbody) return;
      tbody.innerHTML = '';
      if (!Array.isArray(rows) || !rows.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="2" class="text-muted small">No data</td>';
        tbody.appendChild(tr);
        return;
      }
      rows.slice(0, 6).forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(row.label || row.category || 'Item')}</td>
          <td class="text-end">${money(row.amount)}</td>`;
        tbody.appendChild(tr);
      });
    };

    renderRows(earningsTable, analytics.earnings || []);
    renderRows(deductionsTable, analytics.deductions || []);

    const notes = [];
    if (Array.isArray(analytics.notes) && analytics.notes.length) {
      notes.push(...analytics.notes);
    }
    if (Array.isArray(analytics.allowances) && analytics.allowances.length) {
      notes.push(`Allowances: ${analytics.allowances.map((a) => `${a.label || 'Allowance'} ${money(a.amount)}`).join(', ')}`);
    }
    if (Array.isArray(analytics.earnings) && analytics.earnings.length && analytics.takeHomePercent != null) {
      notes.push(`Take-home ${(analytics.takeHomePercent * 100).toFixed(1)}% of gross.`);
    }
    if (notesEl) notesEl.textContent = notes.join(' ');
  }

  function renderStatementHighlights(highlights, rangeStatus = {}) {
    setMoneyOrDash('statement-income', highlights?.totalIncome);
    setMoneyOrDash('statement-spend', highlights?.totalSpend);
    const topList = byId('statement-top-categories');
    const topEmpty = byId('statement-top-empty');
    const expenseList = byId('statement-largest-expenses');
    const expenseEmpty = byId('statement-expense-empty');
    const accountsList = byId('statement-account-summary');
    const accountsEmpty = byId('statement-account-empty');
    const transferNote = byId('statement-transfer-note');
    if (topList) {
      topList.innerHTML = '';
      const items = Array.isArray(highlights?.topCategories) ? highlights.topCategories : [];
      if (!items.length) {
        if (topEmpty) {
          topEmpty.textContent = rangeStatus.statements || 'No spending categories identified.';
          topEmpty.classList.remove('d-none');
        }
      } else {
        topEmpty?.classList.add('d-none');
        items.slice(0, 5).forEach((item) => {
          const li = document.createElement('li');
          li.className = 'd-flex justify-content-between align-items-center mb-2';
          li.innerHTML = `
            <span>${escapeHtml(item.category || 'Category')}</span>
            <span class="fw-semibold">${money(item.outflow ?? item.amount)}</span>`;
          topList.appendChild(li);
        });
      }
    }
    if (expenseList) {
      expenseList.innerHTML = '';
      const items = Array.isArray(highlights?.largestExpenses) ? highlights.largestExpenses : [];
      if (!items.length) {
        if (expenseEmpty) {
          expenseEmpty.textContent = rangeStatus.statements || 'No major outgoings detected.';
          expenseEmpty.classList.remove('d-none');
        }
      } else {
        expenseEmpty?.classList.add('d-none');
        items.slice(0, 5).forEach((item) => {
          const li = document.createElement('li');
          li.className = 'd-flex justify-content-between align-items-center mb-2';
          const dateLabel = item.date ? new Date(item.date).toLocaleDateString() : '—';
          li.innerHTML = `
            <div>
              <div class="fw-semibold">${escapeHtml(item.description || 'Transaction')}</div>
              <div class="text-muted small">${escapeHtml(item.category || '—')} · ${dateLabel}</div>
            </div>
            <span class="fw-semibold">${money(item.amount)}</span>`;
          expenseList.appendChild(li);
        });
      }
    }
    if (accountsList) {
      accountsList.innerHTML = '';
      const accounts = Array.isArray(highlights?.accounts) ? highlights.accounts : [];
      if (!accounts.length) {
        if (accountsEmpty) {
          accountsEmpty.textContent = rangeStatus.statements || 'No accounts captured in this range.';
          accountsEmpty.classList.remove('d-none');
        }
      } else {
        accountsEmpty?.classList.add('d-none');
        accounts.slice(0, 6).forEach((account) => {
          const li = document.createElement('li');
          li.className = 'd-flex justify-content-between align-items-center mb-1';
          const label = [account.bankName, account.accountName].filter(Boolean).join(' · ') || account.accountName || 'Account';
          const masked = account.accountNumberMasked ? ` · ${escapeHtml(account.accountNumberMasked)}` : '';
          li.innerHTML = `
            <div>
              <div class="fw-semibold">${escapeHtml(label)}${masked}</div>
              <div class="text-muted small">Income ${money(account.totals?.income || 0)} · Spend ${money(account.totals?.spend || 0)}</div>
            </div>`;
          accountsList.appendChild(li);
        });
      }
    }
    if (transferNote) {
      const count = Number(highlights?.transferCount || 0);
      if (count > 0) {
        transferNote.textContent = `${count} potential transfers omitted from spending totals.`;
        transferNote.classList.remove('d-none');
      } else {
        transferNote.classList.add('d-none');
      }
    }
  }

  function renderLargestExpenses(expenses, rangeStatus = {}) {
    const table = byId('largest-expense-table');
    const tbody = table?.querySelector('tbody');
    const empty = byId('largest-expense-empty');
    if (tbody) tbody.innerHTML = '';
    if (!Array.isArray(expenses) || !expenses.length) {
      if (empty) {
        empty.textContent = rangeStatus.statements || 'No significant spending detected.';
        empty.classList.remove('d-none');
      }
      return;
    }
    empty?.classList.add('d-none');
    expenses.slice(0, 8).forEach((expense) => {
      const tr = document.createElement('tr');
      const date = expense.date ? new Date(expense.date).toLocaleDateString() : '—';
      tr.innerHTML = `
        <td>${escapeHtml(expense.description || 'Transaction')}</td>
        <td>${date}</td>
        <td class="text-end">${money(expense.amount)}</td>
        <td class="text-end">${escapeHtml(expense.category || '—')}</td>`;
      tbody?.appendChild(tr);
    });
  }

  function setAccountingLoading(processing) {
    const section = byId('accounting-section');
    const overlay = byId('accounting-loading');
    if (!section || !overlay) return;
    const active = Boolean(processing?.active);
    section.classList.toggle('is-loading', active);
    overlay.classList.toggle('d-none', !active);
    const msgEl = overlay.querySelector('[data-loading-message]');
    if (msgEl) msgEl.textContent = processing?.message || 'Updating…';
  }

  function renderDuplicates(duplicates) {
    const table = byId('duplicates-table');
    const empty = byId('duplicates-empty');
    const tbody = table?.querySelector('tbody');
    if (tbody) tbody.innerHTML = '';
    if (!Array.isArray(duplicates) || !duplicates.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    duplicates.slice(0, 8).forEach((dup) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(dup.date || '')}</td>
        <td>${escapeHtml(dup.description || 'Transaction')}</td>
        <td class="text-end">${money(dup.amount)}</td>
        <td class="text-end">${dup.count || 0}</td>`;
      tbody?.appendChild(tr);
    });
  }

  function renderObligations(obligations, hmrcBalance) {
    const badge = byId('hmrc-balance');
    if (badge) badge.textContent = hmrcBalance ? money(hmrcBalance.value) : '£—';
    const tbody = byId('obligations-table')?.querySelector('tbody');
    const empty = byId('obligations-empty');
    if (tbody) tbody.innerHTML = '';
    if (!Array.isArray(obligations) || !obligations.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    obligations.forEach((item) => {
      const tr = document.createElement('tr');
      const due = item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—';
      tr.innerHTML = `
        <td>${due}</td>
        <td>${escapeHtml(item.title || 'Obligation')}</td>
        <td class="text-end">${money(item.amountDue)}</td>`;
      tbody?.appendChild(tr);
    });
  }

  function renderAlerts(alerts) {
    const wrap = byId('alert-queue');
    const empty = byId('alerts-empty');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!Array.isArray(alerts) || !alerts.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    const severityClass = (sev) => ({ danger: 'alert-danger', warning: 'alert-warning', info: 'alert-info', success: 'alert-success' }[sev] || 'alert-secondary');
    alerts.forEach((alert) => {
      const div = document.createElement('div');
      div.className = `alert ${severityClass(alert.severity)} mb-0`;
      div.innerHTML = `
        <div class="fw-semibold">${escapeHtml(alert.title || 'Alert')}</div>
        <div class="small mb-0">${escapeHtml(alert.body || '')}</div>`;
      wrap.appendChild(div);
    });
  }

  function applyMetric(id, metric, opts = {}) {
    const el = byId(id);
    if (!el) return;
    if (!metric) {
      el.textContent = '—';
      if (opts.subId) setText(opts.subId, 'No data — upload documents in the vault to get started.');
      if (opts.deltaId) setText(opts.deltaId, '');
      return;
    }
    if (metric.format === 'currency') el.textContent = money(metric.value);
    else el.textContent = metric.value ?? '—';

    if (opts.subId) setText(opts.subId, metric.subLabel || '');
    if (opts.deltaId) setText(opts.deltaId, formatDelta(metric.delta, metric.deltaMode));
    if (opts.noteId) setText(opts.noteId, metric.note || '');
    if (opts.subtleId) setText(opts.subtleId, metric.subtle || '');

    const card = el.closest('[data-metric-card]');
    if (card) {
      if (metric.sourceNote) {
        card.setAttribute('title', metric.sourceNote);
      } else {
        card.removeAttribute('title');
      }
    }
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
    setText('fp-networth-date', fp.netWorth?.asOf || '—');
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
    renderDonut('fp-networth-chart', breakdown.map((b) => b.value), breakdown.map((b) => b.label));
    renderDonut('fp-allocation-chart', (fp.assetMix || []).map((a) => a.value), (fp.assetMix || []).map((a) => a.label));
    setText('liquidity-note', fp.liquidity?.label || '—');

    setMoneyOrDash('savings-monthly', fp.savings?.monthlyCapacity);
    const note = byId('savings-note');
    if (note) note.textContent = fp.savings?.note || 'Connect accounts to track affordability.';
    setMoneyOrDash('savings-essentials', fp.savings?.essentials);
    setMoneyOrDash('savings-discretionary', fp.savings?.discretionary);
    setMoneyOrDash('savings-contributions', fp.savings?.contributions);
    const rateEl = byId('savings-rate');
    if (rateEl) rateEl.textContent = fp.savings?.savingsRate != null ? `${(fp.savings.savingsRate * 100).toFixed(1)}%` : '—%';
    toggleEmpty('savings-empty', !data.hasData);

    const topCostsBody = byId('fp-top-costs-body');
    if (topCostsBody) {
      topCostsBody.innerHTML = '';
      (fp.topCosts || []).forEach((item) => {
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
  }

  function toggleDashboardEmpty(hasData) {
    const el = byId('dashboard-empty-state');
    if (!el) return;
    if (hasData) el.classList.add('d-none');
    else el.classList.remove('d-none');
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
      container.innerHTML = '<div class="col-12 text-muted small">No data — upload documents in the vault to get started.</div>';
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

  function renderLineMulti(id, labels, datasets) {
    const el = byId(id);
    if (!el || !window.Chart) return;
    if (el._chart) el._chart.destroy();
    if (!Array.isArray(datasets) || !datasets.length || !labels.length) {
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
      return;
    }
    const palette = themeColors(datasets.length);
    const ds = datasets.map((series, idx) => ({
      label: series.label || `Series ${idx + 1}`,
      data: Array.isArray(series.data) ? series.data : [],
      borderColor: series.borderColor || palette[idx % palette.length],
      backgroundColor: 'transparent',
      borderWidth: 2,
      tension: 0.2,
      fill: false,
    }));
    el._chart = new Chart(el, {
      type: 'line',
      data: { labels, datasets: ds },
      options: {
        responsive: true,
        plugins: { legend: { display: true, position: 'bottom' } },
        scales: { y: { ticks: { callback: (v) => money(v) } } }
      }
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
      empty.textContent = hasData ? 'No upcoming events yet.' : 'No data — upload documents in the vault to get started.';
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
  function setMoneyOrDash(id, value) {
    const el = byId(id);
    if (!el) return;
    el.textContent = value == null ? '£—' : money(value);
  }
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
