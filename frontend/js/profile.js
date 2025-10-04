// frontend/js/profile.js
(function () {
  let USER = null;
  let SUBSCRIPTION = null;
  let PLANS = [];
  let PLAN_BY_ID = {};
  let PAYMENT_METHODS = [];
  let INTEGRATIONS = [];
  let INTEGRATION_CATALOG = [];
  let ACTIVE_INTEGRATION = null;
  let SHEET_MODE = 'edit';

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const normaliseKey = (key='') => String(key).toLowerCase();
  const slugify = (text='') => String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const escapeHtml = (str='') => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const escapeAttr = (str='') => escapeHtml(str);

  const fmtMoney = (n, curr='GBP') => {
    const sym = curr === 'GBP' ? '£' : (curr === 'EUR' ? '€' : '$');
    const val = Number(n || 0);
    return `${sym}${val.toFixed(2)}`;
  };
  const isoToNice = (d) => d ? new Date(d).toLocaleString() : '—';
  const isoToDate = (d) => d ? new Date(d).toLocaleDateString() : '—';
  const daysBetween = (a, b) => {
    const ms = Math.abs(new Date(b).getTime() - new Date(a).getTime());
    return Math.floor(ms / (1000*60*60*24));
  };
  const cap = (s) => String(s || '').slice(0,1).toUpperCase() + String(s || '').slice(1);

  const STATUS_META = {
    not_connected: {
      label: 'Not connected',
      dot: 'status-red',
      summary: 'Red indicator — integration is not yet configured.'
    },
    pending: {
      label: 'Action required',
      dot: 'status-amber',
      summary: 'Amber indicator — needs attention before data can sync.'
    },
    error: {
      label: 'Attention needed',
      dot: 'status-amber',
      summary: 'Amber indicator — connection reported an error.'
    },
    connected: {
      label: 'Connected',
      dot: 'status-green',
      summary: 'Green indicator — everything is syncing as expected.'
    }
  };
  const STATUS_ORDER = { connected: 0, pending: 1, error: 1, not_connected: 2 };

  function setTileGrid(stats) {
    const wrap = $('#stat-tiles');
    wrap.innerHTML = '';

    const tiles = [
      { k: 'Money saved', v: stats.moneySavedText, delta: stats.moneySavedDelta, deltaDir: stats.moneySavedDeltaDir },
      { k: 'Reports generated', v: stats.reportsGenerated ?? '—', delta: null },
      { k: 'Net worth change', v: stats.netWorthChange ?? '—', delta: stats.netWorthDelta, deltaDir: (stats.netWorthDelta||'').startsWith('-') ? 'down' : 'up' },
      { k: 'Days on platform', v: stats.daysOnPlatform ?? '—', delta: null },
      { k: 'Current plan', v: stats.planLabel ?? '—', delta: null },
      { k: 'Plan cost', v: stats.planCost ?? '—', delta: stats.planCycle, deltaDir: 'up' },
    ];

    for (const t of tiles) {
      const div = document.createElement('div');
      div.className = 'tile';
      div.innerHTML = `
        <div class="k">${t.k}</div>
        <div class="v">
          <span>${t.v}</span>
          ${t.delta ? `<span class="delta ${t.deltaDir || ''}">${t.delta}</span>` : ''}
        </div>
      `;
      wrap.appendChild(div);
    }
  }

  function featureListFor(planUiId) {
    const p = PLANS.find(x => String(x.id) === String(planUiId));
    return Array.isArray(p?.features) ? p.features : [];
  }

  function moneySavedStat(planUiId, interval) {
    const def = PLANS.find(p => p.id === planUiId);
    if (!def) return { text: '—', delta: null, dir: null };

    if (interval === 'yearly') {
      const monthly = Number(def.priceMonthly || 0) * 12;
      const yearly  = Number(def.priceYearly  || 0);
      const saved   = Math.max(monthly - yearly, 0);
      return { text: fmtMoney(saved, def.currency), delta: 'vs monthly', dir: 'up' };
    } else if (interval === 'monthly') {
      const monthly = Number(def.priceMonthly || 0) * 12;
      const yearly  = Number(def.priceYearly  || 0);
      const couldSave = Math.max(monthly - yearly, 0);
      return { text: fmtMoney(couldSave, def.currency), delta: 'if yearly', dir: 'up' };
    } else {
      return { text: '—', delta: null, dir: null };
    }
  }

  function normaliseCatalogItem(raw) {
    return {
      key: normaliseKey(raw?.key),
      label: raw?.label || 'Integration',
      category: raw?.category || 'Data source',
      description: raw?.description || '',
      comingSoon: !!raw?.comingSoon,
      docsUrl: raw?.docsUrl || null,
      help: raw?.help || null,
      requiredEnv: Array.isArray(raw?.requiredEnv) ? raw.requiredEnv : [],
      missingEnv: Array.isArray(raw?.missingEnv) ? raw.missingEnv : [],
      envReady: raw?.envReady !== false,
      defaultStatus: raw?.defaultStatus || (raw?.comingSoon ? 'pending' : 'not_connected'),
      isCatalog: true,
      metadata: {}
    };
  }

  function mergeIntegrations(catalog, userIntegrations) {
    const map = new Map();
    for (const item of catalog) {
      map.set(item.key, {
        ...item,
        status: item.defaultStatus || 'not_connected',
        metadata: {},
        lastCheckedAt: null
      });
    }
    for (const entry of (userIntegrations || [])) {
      const key = normaliseKey(entry?.key);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        map.set(key, {
          ...existing,
          status: entry.status || existing.status,
          metadata: entry.metadata || existing.metadata || {},
          lastCheckedAt: entry.lastCheckedAt || existing.lastCheckedAt
        });
      } else {
        map.set(key, {
          key,
          label: entry.label || cap(key),
          category: entry.metadata?.category || 'Custom data source',
          description: entry.metadata?.description || '',
          comingSoon: false,
          docsUrl: null,
          help: null,
          requiredEnv: [],
          missingEnv: [],
          envReady: true,
          defaultStatus: entry.status || 'not_connected',
          status: entry.status || 'not_connected',
          metadata: entry.metadata || {},
          lastCheckedAt: entry.lastCheckedAt || null,
          isCatalog: false
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const orderA = STATUS_ORDER[a.status] ?? 9;
      const orderB = STATUS_ORDER[b.status] ?? 9;
      if (orderA !== orderB) return orderA - orderB;
      if (a.comingSoon !== b.comingSoon) return a.comingSoon ? 1 : -1;
      return (a.label || '').localeCompare(b.label || '');
    });
  }

  function updateIntegrationSummary() {
    const summary = $('#integration-summary');
    if (!summary) return;
    if (!INTEGRATIONS.length) {
      summary.textContent = 'No integrations available yet.';
      return;
    }
    const connected = INTEGRATIONS.filter((i) => i.status === 'connected').length;
    const pending = INTEGRATIONS.filter((i) => i.status === 'pending' || i.status === 'error').length;
    let text = connected
      ? `${connected} integration${connected === 1 ? '' : 's'} connected`
      : 'No live integrations yet — connect to unlock automations.';
    if (pending) {
      text += ` · ${pending} pending action${pending === 1 ? '' : 's'}`;
    }
    summary.textContent = text;
  }

  function renderIntegrations() {
    const wrap = $('#integration-list');
    if (!wrap) return;
    wrap.classList.remove('opacity-50');
    wrap.innerHTML = '';

    if (!INTEGRATIONS.length) {
      wrap.innerHTML = '<div class="text-muted small">Integration catalogue is loading…</div>';
      updateIntegrationSummary();
      return;
    }

    for (const integration of INTEGRATIONS) {
      const statusMeta = STATUS_META[integration.status] || STATUS_META.not_connected;
      const envMissing = Array.isArray(integration.missingEnv) && integration.missingEnv.length;
      const card = document.createElement('div');
      card.className = 'integration-card';
      card.dataset.key = integration.key;
      card.dataset.status = integration.status;
      card.innerHTML = `
        <div class="integration-card-header">
          <span class="integration-status-dot ${statusMeta.dot}"></span>
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <h6>${escapeHtml(integration.label)}</h6>
              ${integration.comingSoon ? '<span class="badge-coming-soon">Coming soon</span>' : ''}
            </div>
            <div class="meta">${escapeHtml(integration.category || 'Data source')}</div>
          </div>
        </div>
        <div class="text-muted small">${escapeHtml(integration.description || (integration.comingSoon ? 'This connection is on the way — we will let you know as soon as it is ready.' : 'Connect to stream live financial data into your analytics.'))}</div>
        ${envMissing ? `<div class="alert alert-warning border border-warning-subtle small mb-0">Set up pending — add missing environment variables (${integration.missingEnv.map((v) => escapeHtml(v)).join(', ')}) before launching the flow.</div>` : ''}
        <div class="integration-actions">
          <button class="btn btn-sm btn-primary" data-action="connect">${integration.status === 'connected' ? 'Manage connection' : 'Connect'}</button>
          <button class="btn btn-sm btn-outline-secondary" data-action="edit">Edit</button>
          <button class="btn btn-sm btn-link text-danger" data-action="delete">Delete</button>
        </div>
        <div class="integration-meta">
          <span>${statusMeta.label}</span>
          ${integration.lastCheckedAt ? `<span>Updated ${isoToNice(integration.lastCheckedAt)}</span>` : ''}
          ${integration.docsUrl ? `<a href="${integration.docsUrl}" target="_blank" rel="noopener">Docs</a>` : ''}
        </div>
      `;
      wrap.appendChild(card);
    }

    updateIntegrationSummary();
  }

  function createBlankIntegration() {
    return {
      key: '',
      label: '',
      category: 'Custom data source',
      description: '',
      status: 'not_connected',
      metadata: {},
      requiredEnv: [],
      missingEnv: [],
      envReady: true,
      comingSoon: false,
      docsUrl: null,
      help: 'Outline how this custom connection should be used so every teammate is aligned.',
      lastCheckedAt: null,
      isCatalog: false
    };
  }

  function bindIntegrationEvents() {
    const wrap = $('#integration-list');
    if (wrap && !wrap.dataset.bound) {
      wrap.dataset.bound = '1';
      wrap.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-action]');
        if (!btn) return;
        const card = btn.closest('[data-key]');
        if (!card) return;
        const integration = INTEGRATIONS.find((i) => i.key === card.dataset.key);
        if (!integration) return;
        const action = btn.dataset.action;
        if (action === 'delete') {
          deleteIntegration(integration);
        } else if (action === 'edit') {
          openIntegrationSheet(integration, 'edit');
        } else if (action === 'connect') {
          openIntegrationSheet(integration, integration.status === 'connected' ? 'manage' : 'connect');
        }
      });
    }

    const sheet = $('#integration-sheet');
    if (sheet && !sheet.dataset.bound) {
      sheet.dataset.bound = '1';
      sheet.addEventListener('click', (ev) => {
        if (ev.target === sheet) closeIntegrationSheet();
      });
      sheet.querySelectorAll('[data-close-sheet]').forEach((btn) => btn.addEventListener('click', closeIntegrationSheet));
    }

    const addBtn = $('#integration-add');
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', () => {
        openIntegrationSheet(createBlankIntegration(), 'create');
      });
    }

    if (!document.body.dataset.integrationEsc) {
      document.body.dataset.integrationEsc = '1';
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') closeIntegrationSheet();
      });
    }
  }

  function openIntegrationSheet(integration, mode='edit') {
    const sheet = $('#integration-sheet');
    if (!sheet) return;
    ACTIVE_INTEGRATION = { ...integration, metadata: { ...(integration.metadata || {}) } };
    SHEET_MODE = mode;

    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));

    const meta = STATUS_META[integration.status] || STATUS_META.not_connected;
    const title = $('#intg-sheet-title');
    if (title) title.textContent = integration.label || (mode === 'create' ? 'Create integration' : 'Integration');
    const subtitle = $('#intg-sheet-sub');
    if (subtitle) subtitle.textContent = `${meta.label}${integration.category ? ` · ${integration.category}` : ''}`;

    const sections = [];
    if (integration.comingSoon && mode !== 'create') {
      sections.push(`
        <div class="alert alert-info border border-info-subtle">
          Set up pending — HMRC requires production approval before we can finalise this connection. We will guide you through the activation as soon as access is granted.
        </div>
      `);
    }
    if (mode === 'create') {
      sections.push(`
        <div>
          <label class="form-label">Display name</label>
          <input type="text" class="form-control" id="intg-field-name" placeholder="e.g. Barclays Business" value="${escapeAttr(integration.label)}" />
        </div>
      `);
      sections.push(`
        <div>
          <label class="form-label">Description</label>
          <textarea class="form-control" id="intg-field-description" rows="2" placeholder="How will this data source be used?">${escapeHtml(integration.description || '')}</textarea>
        </div>
      `);
    } else {
      sections.push(`
        <div>
          <div class="small text-muted mb-1">About</div>
          <p class="mb-0">${escapeHtml(integration.description || (integration.comingSoon ? 'This connection is being finalised. We will notify you when HMRC approves the connection.' : 'Launch the connection flow to pull live insights into Phloat.'))}</p>
        </div>
      `);
    }

    const options = Object.entries(STATUS_META)
      .map(([value, m]) => `<option value="${value}" ${value === integration.status ? 'selected' : ''}>${m.label}</option>`)
      .join('');
    sections.push(`
      <div>
        <label class="form-label">Status</label>
        <select class="form-select" id="intg-field-status" ${integration.comingSoon ? 'disabled' : ''}>
          ${options}
        </select>
        <div class="form-text">${escapeHtml(meta.summary)}</div>
      </div>
    `);

    const envList = Array.isArray(integration.requiredEnv) ? integration.requiredEnv : [];
    if (envList.length) {
      const missing = Array.isArray(integration.missingEnv) ? integration.missingEnv : [];
      const missingSet = new Set(missing.map((m) => String(m).toUpperCase()));
      const envRows = envList.map((name) => {
        const missingEntry = missingSet.has(String(name).toUpperCase());
        return `<li>${escapeHtml(name)} ${missingEntry ? '<span class="text-danger ms-1">Missing</span>' : '<span class="text-success ms-1">Detected</span>'}</li>`;
      }).join('');
      const alertClass = missing.length ? 'alert alert-warning border border-warning-subtle' : 'alert alert-success border border-success-subtle';
      const heading = missing.length ? 'Set up pending — add these environment variables in Render:' : 'Environment variables detected:';
      sections.push(`
        <div class="${alertClass}">
          <strong>${heading}</strong>
          <ul class="env-list mt-2">${envRows}</ul>
        </div>
      `);
    }

    sections.push(`
      <div>
        <label class="form-label">Team notes</label>
        <textarea class="form-control" id="intg-field-notes" rows="3" placeholder="Credentials, review cadence, anything the team should know.">${escapeHtml(integration.metadata?.notes || '')}</textarea>
      </div>
    `);

    const body = $('#intg-sheet-body');
    if (body) body.innerHTML = sections.join('');

    const foot = $('#intg-sheet-footnote');
    if (foot) {
      const help = integration.help ? escapeHtml(integration.help) : '';
      const docs = integration.docsUrl ? `<a href="${integration.docsUrl}" target="_blank" rel="noopener">Provider documentation</a>` : '';
      foot.innerHTML = [help, docs].filter(Boolean).join(' · ');
    }

    const saveBtn = $('#intg-sheet-save');
    if (saveBtn) {
      if (integration.comingSoon) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Coming soon';
        saveBtn.onclick = null;
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = mode === 'create' ? 'Create integration' : 'Save changes';
        saveBtn.onclick = handleIntegrationSave;
      }
    }
  }

  function closeIntegrationSheet() {
    const sheet = $('#integration-sheet');
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove('open');
    const saveBtn = $('#intg-sheet-save');
    if (saveBtn) saveBtn.onclick = null;
    setTimeout(() => { sheet.hidden = true; }, 220);
    ACTIVE_INTEGRATION = null;
    SHEET_MODE = 'edit';
  }

  async function handleIntegrationSave() {
    if (!ACTIVE_INTEGRATION) return;
    const mode = SHEET_MODE;
    const nameEl = $('#intg-field-name');
    const descEl = $('#intg-field-description');
    const statusEl = $('#intg-field-status');
    const notesEl = $('#intg-field-notes');

    let label = ACTIVE_INTEGRATION.label || '';
    if (mode === 'create') label = (nameEl?.value || '').trim();
    else if (nameEl) label = nameEl.value.trim() || label;
    if (!label) {
      alert('Please provide a name for this integration.');
      return;
    }

    const status = statusEl ? statusEl.value : (ACTIVE_INTEGRATION.status || 'not_connected');
    const metadata = { ...(ACTIVE_INTEGRATION.metadata || {}) };
    if (descEl) metadata.description = descEl.value.trim();
    if (notesEl) metadata.notes = notesEl.value.trim();

    let key = ACTIVE_INTEGRATION.key;
    if (!key || mode === 'create') {
      key = slugify(label) || `integration-${Date.now()}`;
    }

    const saveBtn = $('#intg-sheet-save');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = mode === 'create' ? 'Creating…' : 'Saving…';
    }

    try {
      await persistIntegration(key, status, label, metadata);
      await loadIntegrations();
      closeIntegrationSheet();
    } catch (err) {
      console.error('Integration save failed', err);
      alert(err.message || 'Failed to save integration.');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = mode === 'create' ? 'Create integration' : 'Save changes';
      }
    }
  }

  async function persistIntegration(key, status, label, metadata) {
    const res = await Auth.fetch(`/api/integrations/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, label, metadata })
    });
    if (!res.ok) {
      let message = 'Unable to save integration.';
      try {
        const err = await res.json();
        if (err?.error) message = err.error;
      } catch {
        try {
          const txt = await res.text();
          if (txt) message = txt;
        } catch {}
      }
      throw new Error(message || 'Unable to save integration.');
    }
    return res.json();
  }

  async function deleteIntegration(integration) {
    if (!integration?.key) return;
    const confirmMsg = integration.status === 'connected'
      ? `Disconnect ${integration.label}?`
      : `Remove ${integration.label}?`;
    if (!window.confirm(confirmMsg)) return;
    try {
      const res = await Auth.fetch(`/api/integrations/${encodeURIComponent(integration.key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Unable to remove integration.');
      await loadIntegrations();
    } catch (err) {
      console.error('Integration delete failed', err);
      alert(err.message || 'Failed to delete integration.');
    }
  }

  async function loadIntegrations(prefetched=null) {
    try {
      let payload = prefetched;
      if (!payload) {
        const res = await Auth.fetch('/api/integrations?t=' + Date.now());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        payload = await res.json();
      }
      INTEGRATION_CATALOG = (payload.catalog || []).map(normaliseCatalogItem);
      INTEGRATIONS = mergeIntegrations(INTEGRATION_CATALOG, payload.integrations || []);
      renderIntegrations();
    } catch (err) {
      console.error('Failed to load integrations', err);
      const summary = $('#integration-summary');
      if (summary) summary.textContent = 'Unable to load integrations right now.';
      $('#integration-list')?.classList.add('opacity-50');
    }
  }

  function bindEditControls() {
    const card = $('#profile-card');
    const btnEdit = $('#btn-edit');
    const btnSave = $('#btn-save');
    const btnCancel = $('#btn-cancel');

    const editableInputs = [
      $('#f-first'),
      $('#f-last'),
      $('#f-username'),
      $('#f-email'),
    ];

    const setEditing = (on) => {
      card.classList.toggle('editing', !!on);
      for (const el of editableInputs) {
        if (on) el.removeAttribute('readonly');
        else el.setAttribute('readonly', 'readonly');
      }
    };

    btnEdit.addEventListener('click', () => setEditing(!card.classList.contains('editing')));
    btnCancel.addEventListener('click', () => {
      setEditing(false);
      // reset values
      if (USER) {
        $('#f-first').value = USER.firstName || '';
        $('#f-last').value = USER.lastName || '';
        $('#f-username').value = USER.username || '';
        $('#f-email').value = USER.email || '';
      }
    });

    btnSave.addEventListener('click', async () => {
      const data = {
        firstName: $('#f-first').value.trim(),
        lastName:  $('#f-last').value.trim(),
        username:  $('#f-username').value.trim(),
        email:     $('#f-email').value.trim(),
      };
      const msgBefore = btnSave.textContent;
      btnSave.disabled = true;
      btnSave.textContent = 'Saving…';
      try {
        const r = await Auth.fetch('/api/user/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!r.ok) {
          let m = 'Update failed';
          try { const j = await r.json(); if (j?.error) m = j.error; } catch {}
          alert(m);
          return;
        }
        const updated = await r.json();
        USER = updated;
        setEditing(false);
      } catch (e) {
        console.error(e);
        alert('Update failed.');
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = msgBefore;
      }
    });
  }

  function renderProfile() {
    if (!USER) return;
    $('#f-first').value = USER.firstName || '';
    $('#f-last').value = USER.lastName || '';
    $('#f-username').value = USER.username || '';
    $('#f-email').value = USER.email || '';
    $('#f-dob').value = USER.dateOfBirth ? isoToDate(USER.dateOfBirth) : '—';
    // billing tier: prefer SUBSCRIPTION if present, else licenseTier
    const planUi = (SUBSCRIPTION?.licenseTier || USER.licenseTier || 'free').toLowerCase();
    const interval = (SUBSCRIPTION?.subscription?.interval || 'monthly').toLowerCase();
    const planLabel = (planUi === 'premium' ? 'Professional' : cap(planUi));
    $('#f-tier').value = planLabel + (planUi !== 'free' ? ` (${cap(interval)})` : '');
    $('#f-eula-ver').value = USER.eulaVersion || '—';
    $('#f-eula-at').value = USER.eulaAcceptedAt ? isoToNice(USER.eulaAcceptedAt) : '—';
    $('#f-created').value = USER.createdAt ? isoToNice(USER.createdAt) : '—';
    $('#f-updated').value = USER.updatedAt ? isoToNice(USER.updatedAt) : '—';

    // EULA + Terms sidebar header numbers
    $('#eula-version').textContent = USER.eulaVersion || '—';
    $('#eula-date').textContent = USER.eulaAcceptedAt ? isoToDate(USER.eulaAcceptedAt) : '—';
  }

  function renderBilling() {
    const planUi = (SUBSCRIPTION?.licenseTier || USER.licenseTier || 'free').toLowerCase();
    const sub = SUBSCRIPTION?.subscription || null;
    const interval = (sub?.interval || 'monthly').toLowerCase();

    const planIdForUi = (planUi === 'premium') ? 'professional' : planUi; // align to /plans ids
    const def = PLANS.find(p => p.id === planIdForUi);
    const price = def ? (interval === 'yearly' ? def.priceYearly : def.priceMonthly) : 0;
    const currency = def?.currency || 'GBP';

    $('#sub-summary').textContent = `${cap(planIdForUi)} ${planIdForUi === 'free' ? '' : `(${cap(interval)})`}`.trim();
    $('#sub-price').textContent = planIdForUi === 'free' ? '£0.00' : `${fmtMoney(price, currency)} / ${interval === 'yearly' ? 'yr' : 'mo'}`;

    // Benefits
    const list = $('#benefit-list');
    list.innerHTML = '';
    for (const li of featureListFor(planIdForUi)) {
      const el = document.createElement('li');
      el.textContent = li;
      list.appendChild(el);
    }

    // Payment methods
    const pmWrap = $('#pm-list');
    pmWrap.innerHTML = '';
    if (!PAYMENT_METHODS.length) {
      pmWrap.innerHTML = `<div class="small muted">No payment methods yet.</div>`;
    } else {
      for (const m of PAYMENT_METHODS) {
        const div = document.createElement('div');
        div.className = 'method';
        div.innerHTML = `
          <div>
            <strong>${m.brand || 'Card'}</strong>
            <span class="text-muted"> •••• ${m.last4 || ''}</span>
            <span class="text-muted"> · exp ${String(m.expMonth).padStart(2,'0')}/${m.expYear}</span>
          </div>
          ${m.isDefault ? '<span class="badge badge-default">Default</span>' : ''}
        `;
        pmWrap.appendChild(div);
      }
    }
  }

  function computeStats() {
    const planUi = (SUBSCRIPTION?.licenseTier || USER.licenseTier || 'free').toLowerCase();
    const planIdForUi = (planUi === 'premium') ? 'professional' : planUi;
    const interval = (SUBSCRIPTION?.subscription?.interval || 'monthly').toLowerCase();

    const def = PLANS.find(p => p.id === planIdForUi);
    const moneySaved = def ? moneySavedStat(planIdForUi, interval) : { text: '—', delta: null, dir: null };

    const planLabel = `${cap(planIdForUi)}${planIdForUi !== 'free' ? ` · ${cap(interval)}` : ''}`;
    const planCost = def
      ? `${fmtMoney(interval === 'yearly' ? def.priceYearly : def.priceMonthly, def.currency)} / ${interval === 'yearly' ? 'yr' : 'mo'}`
      : '—';

    // placeholders where data is not yet wired
    const reportsGenerated = '—'; // reserved for future stats
    const netWorthChange = '—';   // reserved
    const netWorthDelta = '+0.0%';
    const daysOnPlatform = USER?.createdAt ? daysBetween(USER.createdAt, new Date()) : '—';

    setTileGrid({
      moneySavedText: moneySaved.text,
      moneySavedDelta: moneySaved.delta,
      moneySavedDeltaDir: moneySaved.dir,
      reportsGenerated,
      netWorthChange,
      netWorthDelta,
      daysOnPlatform,
      planLabel,
      planCost,
      planCycle: cap(interval)
    });
  }

  function loadNotes() {
    try {
      const k = 'profile_notes';
      const val = localStorage.getItem(k);
      if (val) $('#notes-box').value = val;
      $('#btn-notes-save').addEventListener('click', () => {
        localStorage.setItem(k, $('#notes-box').value);
        const btn = $('#btn-notes-save');
        const orig = btn.textContent;
        btn.disabled = true; btn.textContent = 'Saved';
        setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 900);
      });
    } catch {}
  }

  async function init() {
    try {
      await Auth.requireAuth();
      Auth.setBannerTitle('Profile');
      bindIntegrationEvents();

      // parallel fetches
      const [meRes, plansRes, subRes, pmRes, integrationsRes] = await Promise.all([
        Auth.fetch('/api/user/me'),
        Auth.fetch('/api/billing/plans?t=' + Date.now()),
        Auth.fetch('/api/billing/subscription?t=' + Date.now()),
        Auth.fetch('/api/billing/payment-methods?t=' + Date.now()),
        Auth.fetch('/api/integrations?t=' + Date.now())
      ]);

      USER = meRes.ok ? await meRes.json() : null;
      const plansPayload = plansRes.ok ? await plansRes.json() : { plans: [] };
      PLANS = plansPayload.plans || [];
      PLANS.forEach(p => { PLAN_BY_ID[p.id] = p; });
      SUBSCRIPTION = subRes.ok ? await subRes.json() : null;
      const pmPayload = pmRes.ok ? await pmRes.json() : { methods: [] };
      PAYMENT_METHODS = pmPayload.methods || [];

      const integrationsPayload = integrationsRes.ok ? await integrationsRes.json() : { catalog: [], integrations: [] };
      await loadIntegrations(integrationsPayload);

      renderProfile();
      renderBilling();
      computeStats();
      bindEditControls();
      loadNotes();
    } catch (e) {
      console.error('Profile init error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
