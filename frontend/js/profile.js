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
  let TL_PROVIDER_CATALOG = [];
  let TL_PROVIDER_LOADING = false;
  let TL_PROVIDER_ERROR = null;
  let TL_PROVIDER_PROMISE = null;

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

  const TL_BANK_LIBRARY = [
    {
      id: 'santander',
      providerId: 'uk-ob-santander-personal',
      providers: ['uk-oauth-santander'],
      name: 'Santander UK',
      tagline: 'Current & savings accounts',
      gradient: 'linear-gradient(140deg, rgba(236,0,0,.85), rgba(255,94,94,.85))',
      icon: '🏦',
      brandColor: '#d00000',
      accentColor: '#ff6b6b',
      accounts: [
        { type: 'Current account', currency: 'GBP' },
        { type: 'Savings account', currency: 'GBP' }
      ]
    },
    {
      id: 'monzo',
      providerId: 'uk-ob-monzo',
      providers: ['uk-oauth-monzo'],
      name: 'Monzo',
      tagline: 'Personal & joint smart banking',
      gradient: 'linear-gradient(140deg, rgba(255,82,119,.9), rgba(255,165,94,.85))',
      icon: '💳',
      brandColor: '#ff526d',
      accentColor: '#ffa55e',
      accounts: [
        { type: 'Personal current', currency: 'GBP' },
        { type: 'Joint account', currency: 'GBP' }
      ]
    },
    {
      id: 'starling',
      providerId: 'uk-ob-starling',
      providers: ['uk-oauth-starling'],
      name: 'Starling Bank',
      tagline: 'Award-winning current accounts',
      gradient: 'linear-gradient(140deg, rgba(90,103,216,.9), rgba(14,116,144,.85))',
      icon: '🪙',
      brandColor: '#5a67d8',
      accentColor: '#0e7490',
      accounts: [
        { type: 'Personal current', currency: 'GBP' },
        { type: 'Business current', currency: 'GBP' }
      ]
    },
    {
      id: 'nationwide',
      providerId: 'uk-ob-nationwide',
      providers: ['uk-oauth-nationwide'],
      name: 'Nationwide Building Society',
      tagline: 'Mortgages and savings',
      gradient: 'linear-gradient(140deg, rgba(23,37,84,.92), rgba(99,102,241,.75))',
      icon: '🏠',
      brandColor: '#1e3a8a',
      accentColor: '#6366f1',
      accounts: [
        { type: 'Mortgage', currency: 'GBP' },
        { type: 'Savings account', currency: 'GBP' }
      ]
    },
    {
      id: 'lloyds',
      providerId: 'uk-ob-lloyds-personal',
      providers: ['uk-oauth-lloyds'],
      name: 'Lloyds Bank',
      tagline: 'Everyday banking & credit',
      gradient: 'linear-gradient(140deg, rgba(16,185,129,.9), rgba(56,189,248,.7))',
      icon: '🐎',
      brandColor: '#10b981',
      accentColor: '#38bdf8',
      accounts: [
        { type: 'Current account', currency: 'GBP' },
        { type: 'Credit card', currency: 'GBP' }
      ]
    },
    {
      id: 'other',
      name: 'Another UK institution',
      tagline: 'Easily add any supported bank',
      gradient: 'linear-gradient(140deg, rgba(148,163,184,.85), rgba(100,116,139,.85))',
      icon: '✨',
      brandColor: '#64748b',
      accentColor: '#94a3b8',
      accounts: [
        { type: 'Custom account', currency: 'GBP' }
      ]
    }
  ];

  const STATUS_TEXT = {
    connected: 'Active',
    not_connected: 'Inactive',
    error: 'Attention required',
    pending: 'Action required'
  };

  const isBankConnection = (integration) => (integration?.metadata?.type === 'bank_connection');
  const providerFrom = (integration) => normaliseKey(integration?.metadata?.provider || integration?.metadata?.parentKey || integration?.key || '');

  const bankById = (id) => TL_BANK_LIBRARY.find((bank) => bank.id === id);
  const providerByProviderId = (providerId='') => TL_PROVIDER_CATALOG.find((p) => p.providerId === providerId);
  const bankInitials = (name='') => {
    const parts = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (!parts.length) return '💷';
    return parts.map((p) => p[0]?.toUpperCase() || '').join('');
  };
  const withAlpha = (hex, alpha=0.18) => {
    if (!hex) return `rgba(67,56,202,${alpha})`;
    let raw = hex.replace('#', '');
    if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
    const bigint = parseInt(raw, 16);
    if (Number.isNaN(bigint)) return `rgba(67,56,202,${alpha})`;
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
  const getConnectionsForProvider = (provider) => {
    const norm = normaliseKey(provider);
    return INTEGRATIONS.filter((integration) => isBankConnection(integration) && providerFrom(integration) === norm);
  };
  const statusForProvider = (integration, connections=[]) => {
    if (connections.length) {
      const connected = connections.filter((c) => c.status === 'connected').length;
      const needsAction = connections.filter((c) => c.status === 'pending' || c.status === 'error').length;
      if (connected) return 'connected';
      if (needsAction) return 'pending';
      return 'not_connected';
    }
    return integration.status || integration.defaultStatus || 'not_connected';
  };
  const accountsSummary = (accounts=[]) => {
    if (!Array.isArray(accounts) || !accounts.length) return 'No accounts added yet';
    return accounts.map((acct) => acct?.type || acct?.name || 'Account').join(' · ');
  };

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
    if (!INTEGRATION_CATALOG.length) {
      summary.textContent = 'Loading integration catalogue…';
      return;
    }

    const bankConnections = INTEGRATIONS.filter((item) => isBankConnection(item) && !item.comingSoon);
    const connectedBanks = bankConnections.filter((item) => item.status === 'connected').length;
    const pendingBanks = bankConnections.filter((item) => item.status === 'pending' || item.status === 'error').length;

    const tlCatalog = INTEGRATION_CATALOG.find((item) => item.key === 'truelayer');
    const hmrcCatalog = INTEGRATION_CATALOG.find((item) => item.key === 'hmrc');

    let text = '';
    if (connectedBanks) {
      text = `${connectedBanks} bank connection${connectedBanks === 1 ? '' : 's'} active via TrueLayer`;
      if (pendingBanks) text += ` · ${pendingBanks} awaiting renewal`;
    } else if (bankConnections.length) {
      text = 'Bank connections added — renew to activate sync.';
    } else if (tlCatalog?.missingEnv?.length) {
      text = `Add ${tlCatalog.missingEnv.join(', ')} in Render to launch TrueLayer.`;
    } else {
      text = 'No live integrations yet — connect your bank to unlock automations.';
    }

    if (hmrcCatalog?.comingSoon) {
      text += ' · HMRC Making Tax Digital coming soon';
    }

    summary.textContent = text;
  }

  function showIntegrationFlash(type, message='') {
    const flash = $('#integration-flash');
    if (!flash) return;
    if (!type) {
      flash.innerHTML = '';
      return;
    }
    const map = { success: 'success', error: 'danger', warning: 'warning', info: 'info' };
    const variant = map[type] || 'info';
    flash.innerHTML = `<div class="alert alert-${variant} border border-${variant}-subtle">${escapeHtml(message)}</div>`;
  }

  function renderIntegrations() {
    const wrap = $('#integration-list');
    if (!wrap) return;
    wrap.classList.remove('opacity-50');
    wrap.innerHTML = '';

    if (!INTEGRATIONS.length && !INTEGRATION_CATALOG.length) {
      wrap.innerHTML = '<div class="text-muted small">Integration catalogue is loading…</div>';
      updateIntegrationSummary();
      return;
    }

    const baseItems = INTEGRATIONS.filter((item) => !isBankConnection(item));
    if (!baseItems.length) {
      wrap.innerHTML = '<div class="text-muted small">Integration catalogue is loading…</div>';
      updateIntegrationSummary();
      return;
    }

    for (const integration of baseItems) {
      const providerKey = normaliseKey(integration.key);
      const connections = getConnectionsForProvider(providerKey);
      const displayStatus = statusForProvider(integration, connections);
      const statusMeta = STATUS_META[displayStatus] || STATUS_META.not_connected;
      const envMissing = Array.isArray(integration.missingEnv) && integration.missingEnv.length;
      const card = document.createElement('div');
      card.className = 'integration-card';
      card.dataset.key = integration.key;
      card.dataset.status = displayStatus;
      card.dataset.kind = 'provider';

      const docsLink = integration.docsUrl ? `<a href="${integration.docsUrl}" target="_blank" rel="noopener">Docs</a>` : '';
      const description = integration.description || (integration.comingSoon ? 'This connection is on the way — we will let you know as soon as it is ready.' : 'Connect to stream live financial data into your analytics.');
      const connectionBadge = providerKey === 'truelayer'
        ? `<span class="integration-badge">${connections.length ? `${connections.length} bank${connections.length === 1 ? '' : 's'} configured` : 'No banks linked yet'}</span>`
        : '';

      const metaParts = [statusMeta.label];
      if (providerKey === 'truelayer' && connections.length) {
        const connectedCount = connections.filter((c) => c.status === 'connected').length;
        const inactiveCount = connections.length - connectedCount;
        metaParts.push(`${connectedCount} active`);
        if (inactiveCount > 0) metaParts.push(`${inactiveCount} inactive`);
      }
      if (integration.lastCheckedAt) metaParts.push(`Updated ${isoToNice(integration.lastCheckedAt)}`);
      if (docsLink) metaParts.push(docsLink);

      const actions = [];
      if (integration.comingSoon) {
        actions.push('<button class="btn btn-sm btn-secondary" type="button" disabled>Coming soon</button>');
      } else if (providerKey === 'truelayer') {
        const primaryLabel = connections.length ? 'Add another bank' : 'Connect bank';
        const disabledAttr = envMissing ? ' disabled' : '';
        actions.push(`<button class="btn btn-sm btn-primary" data-action="connect"${disabledAttr}>${primaryLabel}</button>`);
        actions.push('<button class="btn btn-sm btn-outline-secondary" data-action="manage">Manage</button>');
      } else if (!integration.isCatalog) {
        actions.push(`<button class="btn btn-sm btn-primary" data-action="connect">${integration.status === 'connected' ? 'Manage connection' : 'Connect'}</button>`);
        actions.push('<button class="btn btn-sm btn-outline-secondary" data-action="edit">Edit</button>');
        actions.push('<button class="btn btn-sm btn-link text-danger" data-action="delete">Delete</button>');
      } else {
        actions.push('<button class="btn btn-sm btn-outline-secondary" data-action="manage">Manage</button>');
      }

      const envNotice = (!integration.comingSoon && envMissing)
        ? `<div class="alert alert-warning border border-warning-subtle small mb-0">Set up pending — add ${integration.missingEnv.map((v) => `<code>${escapeHtml(v)}</code>`).join(', ')} in Render before launching.</div>`
        : '';

      card.innerHTML = `
        <div class="integration-card-header">
          <span class="integration-status-dot ${statusMeta.dot}"></span>
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <h6>${escapeHtml(integration.label)}</h6>
              ${integration.comingSoon ? '<span class="badge-coming-soon">Coming soon</span>' : connectionBadge}
            </div>
            <div class="meta">${escapeHtml(integration.category || 'Data source')}</div>
          </div>
        </div>
        <div class="text-muted small">${escapeHtml(description)}</div>
        ${envNotice}
        <div class="integration-actions">
          ${actions.join(' ')}
        </div>
        <div class="integration-meta">
          ${metaParts.map((part) => `<span>${part}</span>`).join('')}
        </div>
      `;
      wrap.appendChild(card);

      if (connections.length) {
        connections.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
        for (const connection of connections) {
          wrap.appendChild(renderConnectionCard(connection));
        }
      }
    }

    updateIntegrationSummary();
  }

  function renderConnectionCard(connection) {
    const statusMeta = STATUS_META[connection.status] || STATUS_META.not_connected;
    const card = document.createElement('div');
    card.className = 'integration-card';
    card.dataset.key = connection.key;
    card.dataset.status = connection.status;
    card.dataset.kind = 'connection';

    const institution = connection.metadata?.institution || {};
    const bankMeta = bankById(institution.id) || {};
    const brandColor = institution.brandColor || bankMeta.brandColor || '#4338ca';
    const avatarContent = institution.icon || bankMeta.icon || bankInitials(institution.name || connection.label);
    const statusText = STATUS_TEXT[connection.status] || (STATUS_META[connection.status]?.label ?? 'Status');
    const accounts = Array.isArray(connection.metadata?.accounts) ? connection.metadata.accounts : [];
    const accountSummaryText = accountsSummary(accounts);
    const refreshed = connection.metadata?.lastRefreshedAt ? isoToNice(connection.metadata.lastRefreshedAt) : null;
    const addedAt = connection.metadata?.addedAt ? isoToNice(connection.metadata.addedAt) : null;
    const sandboxBadge = connection.metadata?.sandbox ? '<span class="connection-badge">Sandbox</span>' : '';

    const metaPieces = [
      `<span class="status-text">${escapeHtml(statusText)}</span>`,
      `<span>${escapeHtml(accountSummaryText)}</span>`
    ];
    if (refreshed) metaPieces.push(`<span>Refreshed ${escapeHtml(refreshed)}</span>`);
    else metaPieces.push('<span>Awaiting first sync</span>');
    if (addedAt) metaPieces.push(`<span>Linked ${escapeHtml(addedAt)}</span>`);

    card.innerHTML = `
      <div class="integration-card-header">
        <div class="connection-avatar" style="background:${brandColor}; box-shadow:0 12px 26px ${withAlpha(brandColor,0.35)};">
          ${escapeHtml(avatarContent)}
        </div>
        <div class="flex-grow-1">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <h6>${escapeHtml(connection.label)}</h6>
            <span class="connection-badge">via TrueLayer</span>
            ${sandboxBadge}
          </div>
          <div class="meta">${escapeHtml(institution.tagline || accountSummaryText)}</div>
        </div>
        <span class="integration-status-dot ${statusMeta.dot}"></span>
      </div>
      <div class="integration-meta">
        ${metaPieces.join('')}
      </div>
      <div class="integration-actions">
        <button class="btn btn-sm btn-outline-secondary" data-action="edit">Edit</button>
        <button class="btn btn-sm btn-primary" data-action="renew">Renew connection</button>
        <button class="btn btn-sm btn-link text-danger" data-action="delete">Delete</button>
      </div>
    `;
    return card;
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
        if (btn.hasAttribute('disabled')) return;
        const card = btn.closest('[data-key]');
        if (!card) return;
        const integration = INTEGRATIONS.find((i) => i.key === card.dataset.key);
        if (!integration) return;
        const action = btn.dataset.action;
        const kind = card.dataset.kind || (isBankConnection(integration) ? 'connection' : 'provider');
        if (action === 'delete') {
          deleteIntegration(integration);
        } else if (action === 'edit') {
          openIntegrationSheet(integration, 'edit');
        } else if (action === 'manage') {
          openIntegrationSheet(integration, 'manage');
        } else if (action === 'renew') {
          renewIntegration(integration);
        } else if (action === 'connect') {
          if (kind === 'provider') openIntegrationSheet(integration, 'connect');
          else openIntegrationSheet(integration, integration.status === 'connected' ? 'manage' : 'connect');
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
    const providerKey = normaliseKey(integration?.key || '');
    if (providerKey === 'truelayer' && mode !== 'create' && !isBankConnection(integration)) {
      renderTruelayerProviderSheet(integration, mode);
      return;
    }
    if (isBankConnection(integration) && providerFrom(integration) === 'truelayer') {
      renderTruelayerConnectionSheet(integration, mode);
      return;
    }
    renderGenericIntegrationSheet(integration, mode);
  }

  function renderGenericIntegrationSheet(integration, mode='edit') {
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
      saveBtn.style.display = '';
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

  function renderTruelayerProviderSheet(integration, mode='connect') {
    const sheet = $('#integration-sheet');
    if (!sheet) return;
    ACTIVE_INTEGRATION = { ...integration, metadata: { ...(integration.metadata || {}) } };
    SHEET_MODE = 'truelayer-connect';

    const connections = getConnectionsForProvider('truelayer');
    const displayStatus = statusForProvider(integration, connections);
    const statusMeta = STATUS_META[displayStatus] || STATUS_META.not_connected;
    const envMissing = Array.isArray(integration.missingEnv) && integration.missingEnv.length;

    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));

    const title = $('#intg-sheet-title');
    if (title) title.textContent = 'Link a bank via TrueLayer';
    const subtitle = $('#intg-sheet-sub');
    if (subtitle) subtitle.textContent = `${statusMeta.label} · Bank connections`;

    const statusAlert = envMissing
      ? `<div class="alert alert-warning border border-warning-subtle">TrueLayer credentials missing — add ${integration.missingEnv.map((v) => `<code>${escapeHtml(v)}</code>`).join(', ')} in Render to enable the flow.</div>`
      : '<div class="alert alert-success border border-success-subtle">Credentials detected — you will be redirected to TrueLayer\'s secure consent journey to complete the connection.</div>';

    const connectionSummary = connections.length
      ? `<div class="small text-muted">Currently linked: ${connections.map((c) => escapeHtml(c.label)).join(', ')}.</div>`
      : '<div class="small text-muted">No banks linked yet — choose an institution below to get started.</div>';

    const cards = TL_BANK_LIBRARY.map((bank) => {
      const gradient = bank.gradient || 'linear-gradient(140deg, rgba(99,102,241,.8), rgba(67,56,202,.65))';
      const disabledAttr = envMissing ? ' aria-disabled="true"' : '';
      const existing = connections.some((c) => (c.metadata?.institution?.id || '') === bank.id && c.status === 'connected');
      const chipLabel = envMissing ? 'Awaiting setup' : (existing ? 'Add another' : 'Connect');
      const iconSpan = bank.icon ? `<span>${escapeHtml(bank.icon)}</span>` : '';
      return `
        <div class="tl-bank-card" data-bank-id="${bank.id}" style="--bank-gradient:${gradient};"${disabledAttr}>
          <div class="bank-name">${escapeHtml(bank.name)}</div>
          <div class="bank-tagline">${escapeHtml(bank.tagline)}</div>
          <div class="bank-chip">${iconSpan}<span>${escapeHtml(chipLabel)}</span></div>
        </div>
      `;
    }).join('');

    const body = $('#intg-sheet-body');
    if (body) {
      body.innerHTML = `
        <div id="truelayer-status"></div>
        <div class="tl-sheet-hero">
          <div class="eyebrow">Open banking</div>
          <h5>Connect your bank in seconds</h5>
          <p>Phloat.io uses TrueLayer’s secure consent flow so you can link UK accounts with the same sleek experience you expect from modern fintech leaders.</p>
        </div>
        ${statusAlert}
        ${connectionSummary}
        <div class="tl-bank-grid mt-3">
          ${cards}
        </div>
        <div class="tl-provider-picker mt-4">
          <label class="form-label">Prefer a different provider?</label>
          <div id="tl-provider-select-wrap" class="tl-provider-select-wrap">
            <div class="text-muted small">Search the full TrueLayer directory or pick from the favourites above.</div>
          </div>
        </div>
        <div class="tl-sheet-footnote mt-3">Selecting a bank launches the TrueLayer consent journey. We honour <code>TL_USE_SANDBOX</code> when configured so you can test safely before going live.</div>
      `;
    }

    const foot = $('#intg-sheet-footnote');
    if (foot) {
      foot.innerHTML = '<a href="https://docs.truelayer.com/" target="_blank" rel="noopener">Review the TrueLayer documentation</a>';
    }

    const saveBtn = $('#intg-sheet-save');
    if (saveBtn) {
      saveBtn.style.display = 'none';
      saveBtn.onclick = null;
    }

    sheet.querySelectorAll('[data-bank-id]').forEach((card) => {
      card.addEventListener('click', () => {
        if (card.getAttribute('aria-disabled') === 'true') return;
        const bank = bankById(card.dataset.bankId);
        if (!bank) return;
        if (bank.id === 'other') {
          populateTruelayerProviderPicker(true);
          return;
        }
        launchTruelayerConnection(bank, card);
      });
    });

    populateTruelayerProviderPicker();
  }

  function renderTruelayerConnectionSheet(integration, mode='edit') {
    const sheet = $('#integration-sheet');
    if (!sheet) return;
    ACTIVE_INTEGRATION = { ...integration, metadata: { ...(integration.metadata || {}) } };
    SHEET_MODE = mode;

    const meta = STATUS_META[integration.status] || STATUS_META.not_connected;
    const institution = integration.metadata?.institution || {};
    const accounts = Array.isArray(integration.metadata?.accounts) ? integration.metadata.accounts : [];
    const addedAt = integration.metadata?.addedAt ? isoToNice(integration.metadata.addedAt) : null;
    const refreshed = integration.metadata?.lastRefreshedAt ? isoToNice(integration.metadata.lastRefreshedAt) : null;

    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));

    const title = $('#intg-sheet-title');
    if (title) title.textContent = integration.label || institution.name || 'Bank connection';
    const subtitle = $('#intg-sheet-sub');
    if (subtitle) subtitle.textContent = `TrueLayer · ${meta.label}`;

    const accountItems = accounts.length
      ? accounts.map((acct) => `<li>${escapeHtml(acct.type || acct.name || 'Account')}${acct.currency ? ` · ${escapeHtml(acct.currency)}` : ''}</li>`).join('')
      : '<li>No account details captured yet.</li>';

    const body = $('#intg-sheet-body');
    if (body) {
      body.innerHTML = `
        <div class="alert alert-light border border-secondary-subtle d-flex flex-column gap-1">
          <strong>${escapeHtml(institution.name || integration.label || 'Linked bank')}</strong>
          <span>Connected via TrueLayer${addedAt ? ` · Linked ${escapeHtml(addedAt)}` : ''}${refreshed ? ` · Last refreshed ${escapeHtml(refreshed)}` : ''}</span>
        </div>
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label">Display name</label>
            <input type="text" class="form-control" id="intg-field-name" value="${escapeAttr(integration.metadata?.nickname || integration.label || institution.name || '')}" />
          </div>
          <div class="col-12 col-md-6">
            <label class="form-label">Status</label>
            <select class="form-select" id="intg-field-status">
              ${Object.entries(STATUS_META).map(([value, m]) => `<option value="${value}" ${value === integration.status ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
            <div class="form-text">Use “Inactive” if you want to pause sync without removing the connection.</div>
          </div>
          <div class="col-12 col-md-6">
            <label class="form-label">Accounts captured</label>
            <ul class="env-list mt-2">${accountItems}</ul>
          </div>
          <div class="col-12">
            <label class="form-label">Notes</label>
            <textarea class="form-control" id="intg-field-notes" rows="3" placeholder="Credentials, renewal cadence, anything the team should know.">${escapeHtml(integration.metadata?.notes || '')}</textarea>
          </div>
        </div>
      `;
    }

    const foot = $('#intg-sheet-footnote');
    if (foot) {
      foot.innerHTML = 'Use “Renew connection” to refresh OAuth consent whenever the bank requires re-authentication.';
    }

    const saveBtn = $('#intg-sheet-save');
    if (saveBtn) {
      saveBtn.style.display = '';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save connection';
      saveBtn.onclick = handleIntegrationSave;
    }
  }

  async function launchTruelayerConnection(bank, cardEl=null) {
    const statusBox = $('#truelayer-status');
    if (cardEl) {
      cardEl.setAttribute('aria-disabled', 'true');
      cardEl.style.transition = 'opacity .3s ease';
      cardEl.style.opacity = '0.6';
    }
    if (statusBox) {
      statusBox.innerHTML = `<div class="alert alert-info border border-info-subtle">Preparing the ${escapeHtml(bank.name)} consent flow…</div>`;
    }

    try {
      const res = await Auth.fetch('/api/integrations/truelayer/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institution: {
            id: bank.id,
            name: bank.name,
            brandColor: bank.brandColor,
            accentColor: bank.accentColor,
            icon: bank.icon,
            tagline: bank.tagline,
            providerId: bank.providerId,
            providers: bank.providers
          },
          providers: Array.isArray(bank.providers) ? bank.providers : []
        })
      });

      let payload = {};
      try { payload = await res.json(); } catch {}

      if (!res.ok) {
        let message = payload?.error || 'Unable to launch the connection.';
        if (payload?.missingEnv?.length) {
          message = `Add ${payload.missingEnv.map((v) => `\u201c${escapeHtml(v)}\u201d`).join(', ')} in Render to enable this flow.`;
        }
        throw new Error(message);
      }

      const redirectUrl = payload?.authUrl;
      if (!redirectUrl) {
        throw new Error('Missing authorization URL from TrueLayer.');
      }

      if (statusBox) {
        const expiryText = payload?.expiresAt ? ` before ${new Date(payload.expiresAt).toLocaleTimeString()}` : '';
        statusBox.innerHTML = `<div class="alert alert-success border border-success-subtle">Redirecting you to TrueLayer to complete the bank consent journey${escapeHtml(expiryText)}…</div>`;
      }

      setTimeout(() => {
        window.location.href = redirectUrl;
      }, 600);
    } catch (err) {
      console.error('TrueLayer connection failed', err);
      if (statusBox) {
        statusBox.innerHTML = `<div class="alert alert-danger border border-danger-subtle">${escapeHtml(err.message || 'Connection failed.')}</div>`;
      } else {
        alert(err.message || 'Connection failed.');
      }
    } finally {
      if (cardEl) {
        cardEl.removeAttribute('aria-disabled');
        cardEl.style.opacity = '';
      }
    }
  }

  function closeIntegrationSheet() {
    const sheet = $('#integration-sheet');
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove('open');
    const saveBtn = $('#intg-sheet-save');
    if (saveBtn) {
      saveBtn.onclick = null;
      saveBtn.style.display = '';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
    }
    setTimeout(() => { sheet.hidden = true; }, 220);
    const statusBox = $('#truelayer-status');
    if (statusBox) statusBox.innerHTML = '';
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
    if (isBankConnection(ACTIVE_INTEGRATION)) {
      if (nameEl) metadata.nickname = nameEl.value.trim();
      metadata.lastManagedAt = new Date().toISOString();
    }

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
    const isBank = isBankConnection(integration);
    const confirmMsg = integration.status === 'connected'
      ? `Disconnect ${integration.label}?${isBank ? ' This will pause live syncing.' : ''}`
      : `Remove ${integration.label}?`;
    if (!window.confirm(confirmMsg)) return;
    try {
      const res = await Auth.fetch(`/api/integrations/${encodeURIComponent(integration.key)}`, { method: 'DELETE' });
      if (!res.ok) {
        let message = 'Unable to remove integration.';
        try {
          const err = await res.json();
          if (err?.error) message = err.error;
        } catch {}
        throw new Error(message);
      }
      let payload = null;
      try { payload = await res.json(); } catch {}
      await loadIntegrations(payload);
    } catch (err) {
      console.error('Integration delete failed', err);
      alert(err.message || 'Failed to delete integration.');
    }
  }

  async function renewIntegration(integration) {
    if (!integration?.key) return;
    try {
      const res = await Auth.fetch(`/api/integrations/${encodeURIComponent(integration.key)}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        let message = 'Unable to renew connection.';
        try {
          const err = await res.json();
          if (err?.error) message = err.error;
        } catch {}
        throw new Error(message);
      }
      let payload = null;
      try { payload = await res.json(); } catch {}
      await loadIntegrations(payload);

      const wrap = $('#integration-list');
      if (wrap) {
        const note = document.createElement('div');
        note.className = 'alert alert-success border border-success-subtle small';
        note.textContent = `${integration.label || 'Connection'} renewed — we will refresh data shortly.`;
        wrap.prepend(note);
        setTimeout(() => {
          note.style.transition = 'opacity .3s ease';
          note.style.opacity = '0';
          setTimeout(() => note.remove(), 320);
        }, 2400);
      }
    } catch (err) {
      console.error('Integration renew failed', err);
      alert(err.message || 'Failed to renew connection.');
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
      handleIntegrationReturnNotice();
    } catch (err) {
      console.error('Failed to load integrations', err);
      const summary = $('#integration-summary');
      if (summary) summary.textContent = 'Unable to load integrations right now.';
      $('#integration-list')?.classList.add('opacity-50');
    }
  }

  function handleIntegrationReturnNotice() {
    try {
      const params = new URLSearchParams(window.location.search);
      const flag = params.get('integrations');
      if (!flag || !flag.startsWith('truelayer')) {
        showIntegrationFlash(null);
        return;
      }

      if (flag === 'truelayer-success') {
        const connectionKey = params.get('connection');
        let label = 'Your bank';
        if (connectionKey) {
          const found = INTEGRATIONS.find((item) => item.key === connectionKey);
          if (found?.label) label = found.label;
        }
        showIntegrationFlash('success', `${label} is now connected via TrueLayer. We will start syncing data shortly.`);
      } else {
        const reasonParam = params.get('reason');
        let reason = 'The TrueLayer consent journey did not complete.';
        if (reasonParam) {
          try { reason = decodeURIComponent(reasonParam); } catch {}
        }
        showIntegrationFlash('error', reason.replace(/_/g, ' '));
      }

      params.delete('integrations');
      params.delete('reason');
      params.delete('connection');
      const newQuery = params.toString();
      const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', newUrl);
    } catch (err) {
      console.warn('Integration flash handling failed', err);
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
  async function ensureTruelayerProviderCatalogue() {
    if (TL_PROVIDER_CATALOG.length) return TL_PROVIDER_CATALOG;
    if (TL_PROVIDER_PROMISE) return TL_PROVIDER_PROMISE;

    TL_PROVIDER_LOADING = true;
    TL_PROVIDER_ERROR = null;
    TL_PROVIDER_PROMISE = Auth.fetch('/api/integrations/truelayer/providers')
      .then(async (res) => {
        let payload = {};
        try { payload = await res.json(); } catch (_) {}
        if (!res.ok) {
          throw new Error(payload?.error || 'Unable to load provider directory.');
        }
        return Array.isArray(payload?.providers) ? payload.providers : [];
      })
      .then((list) => {
        TL_PROVIDER_CATALOG = list;
        return list;
      })
      .catch((err) => {
        TL_PROVIDER_ERROR = err?.message || 'Unable to load provider directory.';
        console.error('TrueLayer provider fetch failed', err);
        return [];
      })
      .finally(() => {
        TL_PROVIDER_LOADING = false;
        TL_PROVIDER_PROMISE = null;
      });

    return TL_PROVIDER_PROMISE;
  }

  function providerToBank(provider) {
    if (!provider) return null;
    const slug = provider.slug || slugify(provider.displayName || provider.providerId || 'provider');
    const name = provider.displayName || provider.providerId || 'TrueLayer provider';
    const tagline = provider.releaseStage
      ? `${cap(provider.releaseStage)} · TrueLayer partner`
      : 'Direct TrueLayer connection';

    return {
      id: slug || provider.providerId || `provider-${Math.random().toString(36).slice(2,8)}`,
      providerId: provider.providerId,
      providers: Array.isArray(provider.providers) ? provider.providers : [],
      name,
      tagline,
      icon: '🏦',
      brandColor: null,
      accentColor: null
    };
  }

  async function populateTruelayerProviderPicker(focus=false) {
    const wrap = $('#tl-provider-select-wrap');
    if (!wrap) return;

    wrap.innerHTML = '<div class="text-muted small">Loading TrueLayer providers…</div>';
    const providers = await ensureTruelayerProviderCatalogue();

    if (TL_PROVIDER_ERROR) {
      wrap.innerHTML = `
        <div class="alert alert-warning border border-warning-subtle">${escapeHtml(TL_PROVIDER_ERROR)}</div>
        <button type="button" class="btn btn-outline-primary btn-sm" id="tl-provider-retry">Retry</button>
      `;
      const retry = $('#tl-provider-retry');
      if (retry) {
        retry.addEventListener('click', () => {
          TL_PROVIDER_CATALOG = [];
          TL_PROVIDER_ERROR = null;
          populateTruelayerProviderPicker(focus);
        });
      }
      return;
    }

    if (!providers.length) {
      wrap.innerHTML = '<div class="alert alert-info border border-info-subtle">TrueLayer did not return any providers for your credentials.</div>';
      return;
    }

    const ukProviders = providers.filter((provider) => {
      const countries = Array.isArray(provider.countries) ? provider.countries : [];
      if (!countries.length) return true;
      return countries.some((code) => ['GB', 'UK', 'GBR', 'United Kingdom'].includes(String(code).toUpperCase()));
    });

    const options = ukProviders.length ? ukProviders : providers;

    const select = document.createElement('select');
    select.className = 'form-select';
    select.id = 'tl-provider-select';
    select.innerHTML = [
      '<option value="">Choose a bank…</option>',
      ...options.map((provider) => `<option value="${escapeAttr(provider.providerId)}">${escapeHtml(provider.displayName || provider.providerId)}</option>`)
    ].join('');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.id = 'tl-provider-select-btn';
    btn.textContent = 'Connect';

    const group = document.createElement('div');
    group.className = 'input-group';
    group.appendChild(select);
    group.appendChild(btn);

    wrap.innerHTML = '';
    wrap.appendChild(group);
    const helper = document.createElement('div');
    helper.className = 'form-text';
    helper.textContent = 'Powered by TrueLayer provider directory.';
    wrap.appendChild(helper);

    btn.addEventListener('click', async () => {
      if (!select.value) {
        select.focus();
        return;
      }
      const provider = providerByProviderId(select.value);
      if (!provider) {
        alert('Provider not recognised.');
        return;
      }
      const bank = providerToBank(provider);
      if (!bank) {
        alert('Unable to launch provider.');
        return;
      }
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Launching…';
      try {
        await launchTruelayerConnection(bank);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });

    if (focus) {
      setTimeout(() => {
        if (select.scrollIntoView) select.scrollIntoView({ behavior: 'smooth', block: 'center' });
        select.focus();
      }, 120);
    }
  }
