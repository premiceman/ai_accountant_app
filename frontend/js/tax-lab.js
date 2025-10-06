// frontend/js/tax-lab.js
(function () {
  const state = {
    snapshot: null,
    scenarios: null,
    ai: {
      busy: false,
      lastPrompt: null,
    },
  };

  const byId = (id) => document.getElementById(id);

  init().catch((err) => {
    console.error('Failed to initialise tax lab', err);
    showError('Unable to load HMRC snapshot. Please refresh.');
  });

  async function init() {
    Auth.setBannerTitle('Tax Lab');
    await Auth.requireAuth();
    await loadData();
    bindEvents();
    render();
  }

  async function loadData() {
    const [snapRes, scenariosRes] = await Promise.all([
      Auth.fetch('/api/tax/snapshot', { cache: 'no-store' }),
      Auth.fetch('/api/tax/scenarios', { cache: 'no-store' }).catch(() => null),
    ]);

    if (!snapRes?.ok) {
      const detail = await snapRes?.text?.().catch(() => '');
      throw new Error(detail || 'snapshot failed');
    }

    state.snapshot = await snapRes.json();

    if (scenariosRes && scenariosRes.ok) {
      state.scenarios = await scenariosRes.json();
    } else {
      state.scenarios = { baseline: null, deltas: [] };
    }
  }

  function bindEvents() {
    const quickRoot = byId('ai-quick-actions');
    if (quickRoot) {
      quickRoot.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-prompt]');
        if (!btn) return;
        ev.preventDefault();
        if (state.ai.busy) return;
        runQuickAction(btn.dataset.prompt, btn);
      });
    }
  }

  function render() {
    if (!state.snapshot) return;
    renderHeader();
    renderSummaryCards();
    renderAllowances();
    renderPayments();
    renderObligations();
    renderDocuments();
    renderScenarios();
    renderQuickActions();
  }

  function renderHeader() {
    const label = byId('hmrc-sync-label');
    const sub = byId('hmrc-sync-sub');
    const snap = state.snapshot;
    const connected = snap.integrations?.hmrcConnected;
    if (label) {
      label.textContent = connected ? 'HMRC sync active' : 'Using estimates';
      label.classList.toggle('text-bg-light', !connected);
      label.classList.toggle('text-bg-warning', !connected);
      label.classList.toggle('text-bg-success', !!connected);
      label.classList.toggle('border', !connected);
    }
    if (sub) {
      const ts = snap.integrations?.lastSync || snap.updatedAt;
      sub.textContent = ts ? `Last updated ${formatDate(ts)}` : 'No sync recorded yet.';
    }
  }

  function renderSummaryCards() {
    const snap = state.snapshot;
    setText('tax-code-value', snap.personalTaxCode?.code || '—');
    setText('tax-code-sub', snap.personalTaxCode?.source === 'hmrc' ? 'From HMRC portal' : 'Estimated from records');

    const net = Number(snap.hmrcBalances?.net ?? 0);
    setText('tax-net-value', formatMoney(net));
    setText('tax-net-sub', snap.hmrcBalances?.label || '—');

    const next = (snap.obligations || [])[0];
    setText('tax-next-label', next ? formatDate(next.dueDate) : '—');
    setText('tax-next-sub', next ? next.label : 'No upcoming obligations');

    const docs = snap.documents || [];
    const completed = docs.filter((d) => d.status === 'complete').length;
    const required = docs.length || 0;
    setText('tax-doc-progress', required ? `${completed}/${required}` : '—');
    setText('tax-doc-sub', required ? 'Required items uploaded' : 'No required documents listed');
  }

  function renderAllowances() {
    const wrap = byId('allowance-list');
    if (!wrap) return;
    const allowances = state.snapshot.allowances || [];
    const updated = state.snapshot.allowances?.[0]?.updatedAt || state.snapshot.updatedAt;
    setText('allowance-updated', updated ? `Updated ${formatDate(updated)}` : 'No update timestamp');

    if (!allowances.length) {
      wrap.innerHTML = '<div class="text-muted small">No allowance data available. Connect HMRC to populate this view.</div>';
      return;
    }

    wrap.innerHTML = '';
    allowances.forEach((a) => {
      const row = document.createElement('div');
      row.className = 'allowance-row';
      row.innerHTML = `
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <div class="label">${escapeHtml(a.label)}</div>
            <div class="meta">${formatMoney(a.used)} used of ${formatMoney(a.total)} (${a.percentUsed}% used)</div>
          </div>
          <span class="badge bg-${badgeFromStatus(a.status)}">${statusLabel(a.status)}</span>
        </div>
        <div class="progress mt-2" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${a.percentUsed}">
          <div class="progress-bar bg-${barFromStatus(a.status)}" style="width:${a.percentUsed}%"></div>
        </div>
      `;
      wrap.appendChild(row);
    });
  }

  function renderPayments() {
    const tbody = byId('payments-body');
    if (!tbody) return;
    const list = state.snapshot.paymentsOnAccount || [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted small">No payments scheduled.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    list.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.reference || '—')}</td>
        <td class="text-end">${formatMoney(item.amount)}</td>
        <td>${formatDate(item.dueDate)}</td>
        <td><span class="badge bg-${badgeFromStatus(item.status)}">${statusLabel(item.status)}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderObligations() {
    const list = byId('obligation-list');
    if (!list) return;
    const data = state.snapshot.obligations || [];
    if (!data.length) {
      list.innerHTML = '<li><span class="text-muted small">No obligations on file.</span></li>';
      return;
    }
    list.innerHTML = '';
    data.forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="fw-semibold">${escapeHtml(item.label)}</div>
        <div class="text-muted small">${formatDate(item.dueDate)} · ${escapeHtml(item.period || item.type || '')}</div>
        ${item.note ? `<div class="small">${escapeHtml(item.note)}</div>` : ''}
      `;
      list.appendChild(li);
    });
  }

  function renderDocuments() {
    const wrap = byId('documents-list');
    if (!wrap) return;
    const docs = state.snapshot.documents || [];
    if (!docs.length) {
      wrap.innerHTML = '<div class="text-muted small">No required documents defined.</div>';
      return;
    }
    wrap.innerHTML = '';
      docs.forEach((doc) => {
        const div = document.createElement('div');
        div.className = `doc-status ${doc.status}`;
        div.innerHTML = `
          <div>
            <div class="label">${escapeHtml(doc.label)}</div>
          <div class="small text-muted">${doc.lastUploadedAt ? `Last uploaded ${formatDate(doc.lastUploadedAt)}` : 'No upload yet'}</div>
          ${doc.sourceNote ? `<div class="small text-muted">Sources: ${escapeHtml(doc.sourceNote)}</div>` : ''}
          </div>
          <span class="badge bg-${badgeFromStatus(doc.status)}">${statusLabel(doc.status)}</span>
        `;
        wrap.appendChild(div);
      });
  }

  function renderScenarios() {
    const label = byId('scenario-baseline-label');
    const desc = byId('scenario-baseline-desc');
    const grid = byId('scenario-grid');
    if (!grid) return;

    const baseline = state.scenarios?.baseline;
    if (label) label.textContent = baseline ? `${baseline.label}: tax £${formatNumber(baseline.totalTax)}` : 'Baseline unavailable';
    if (desc) desc.textContent = baseline?.description || 'Connect HMRC to populate projections.';

    const deltas = state.scenarios?.deltas || [];
    if (!deltas.length) {
      grid.innerHTML = '<div class="text-muted small">No scenarios computed yet.</div>';
      return;
    }

    grid.innerHTML = '';
    deltas.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'scenario-card';
      card.innerHTML = `
        <h3 class="h6">${escapeHtml(item.label)}</h3>
        <div class="small text-muted mb-2">${item.summary ? escapeHtml(item.summary) : 'Scenario impact overview.'}</div>
        <div class="d-flex flex-column gap-1">
          <div><span class="fw-semibold">Tax delta:</span> ${formatMoney(item.taxDelta)}</div>
          <div><span class="fw-semibold">Take-home delta:</span> ${formatMoney(item.takeHomeDelta)}</div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function renderQuickActions() {
    const wrap = byId('ai-quick-actions');
    if (!wrap) return;
    const actions = state.snapshot.quickActions || [];
    if (!actions.length) {
      wrap.innerHTML = '<div class="text-muted small">No quick actions available.</div>';
      return;
    }
    wrap.innerHTML = '';
    actions.forEach((action) => {
      const tile = document.createElement('div');
      tile.className = 'quick-btn';
      tile.innerHTML = `
        <div class="fw-semibold">${escapeHtml(action.label)}</div>
        <button class="btn btn-sm btn-primary" data-prompt="${escapeAttribute(action.prompt)}">Ask now</button>
      `;
      wrap.appendChild(tile);
    });
  }

  async function runQuickAction(prompt, button) {
    const output = byId('ai-quick-output');
    if (!prompt || !output) return;
    state.ai.busy = true;
    state.ai.lastPrompt = prompt;
    output.textContent = 'Thinking…';
    const original = button?.innerHTML;
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Running';
    }

    const messages = [
      {
        role: 'system',
        content: `You are the AI Accountant tax assistant. Stay concise, actionable, and cite HMRC processes when relevant. Here is the latest snapshot to ground your answer:\n\n${state.snapshot.aiPromptSeed || ''}`,
      },
      { role: 'user', content: prompt },
    ];

    try {
      const resp = await Auth.fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      if (!resp.ok || !resp.body) {
        output.textContent = 'Unable to contact AI service right now.';
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let text = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const chunk of parts) {
          if (!chunk.startsWith('data:')) continue;
          const payload = chunk.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            if (json.error) {
              output.textContent = json.error;
              continue;
            }
            if (json.delta) {
              text += json.delta;
              output.textContent = text.trim();
            }
          } catch (err) {
            console.warn('Failed to parse AI chunk', err, payload);
          }
        }
      }
      if (!text) output.textContent = 'No response received.';
    } catch (err) {
      console.error('AI quick action failed', err);
      output.textContent = 'Quick action failed. Please try again later.';
    } finally {
      state.ai.busy = false;
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }

  function showError(msg) {
    const box = byId('tax-error');
    if (!box) return;
    box.textContent = msg;
    box.classList.remove('d-none');
  }

  function setText(id, value) {
    const el = byId(id);
    if (!el) return;
    el.textContent = value == null ? '—' : value;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '£—';
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
  }

  function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function statusLabel(status) {
    switch (status) {
      case 'complete':
        return 'Complete';
      case 'stale':
        return 'Refresh soon';
      case 'missing':
        return 'Missing';
      case 'projected':
        return 'Projected';
      case 'due':
        return 'Due';
      case 'attention':
        return 'Attention';
      case 'exhausted':
        return 'Exhausted';
      case 'tracking':
        return 'On track';
      case 'available':
        return 'Available';
      default:
        return (status || 'Unknown').replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  function badgeFromStatus(status) {
    switch (status) {
      case 'complete':
      case 'available':
        return 'success';
      case 'stale':
      case 'attention':
      case 'projected':
        return 'warning text-dark';
      case 'exhausted':
      case 'missing':
        return 'danger';
      default:
        return 'secondary';
    }
  }

  function barFromStatus(status) {
    switch (status) {
      case 'complete':
      case 'available':
        return 'success';
      case 'stale':
      case 'attention':
        return 'warning';
      case 'exhausted':
        return 'danger';
      default:
        return 'secondary';
    }
  }
})();
