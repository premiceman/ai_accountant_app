// frontend/js/profile.js
(function () {
  let USER = null;
  let SUBSCRIPTION = null;
  let PLANS = [];
  let PLAN_BY_ID = {};
  let PAYMENT_METHODS = [];
  let PLAID_ITEMS = [];
  let PLAID_BINDINGS_READY = false;
  let PLAID_SCRIPT_PROMISE = null;

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

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
  const escapeHtml = (s='') => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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

  function formatPlaidBalance(acct) {
    const balances = acct?.balances || {};
    const currency = balances.isoCurrencyCode || balances.iso_currency_code || acct?.currency || 'GBP';
    const amount = balances.current ?? balances.available ?? null;
    if (amount === null || typeof amount === 'undefined') return '—';
    return fmtMoney(Number(amount), currency);
  }

  function deriveConnectionStatus(item) {
    const statusRaw = (item?.status && typeof item.status === 'string') ? item.status
      : (typeof item?.status?.code === 'string' ? item.status.code
      : (item?.connectionStatus || item?.status?.stage || item?.health));
    const status = String(statusRaw || '').toLowerCase();
    const lastError = item?.status?.lastError || item?.lastError || null;

    if (!status) return { label: 'Unknown', tone: 'muted', detail: lastError?.message || '' };
    if (['healthy', 'ok', 'active'].includes(status)) {
      return { label: 'Healthy', tone: 'ok', detail: '' };
    }
    if (['needs_reconnect', 'requires_reconnect', 'requires_login', 'reauth'].includes(status)) {
      return { label: 'Action required', tone: 'warn', detail: lastError?.message || 'Reconnect via Plaid Link.' };
    }
    if (['error', 'disconnected', 'blocked'].includes(status)) {
      return { label: 'Disconnected', tone: 'bad', detail: lastError?.message || '' };
    }
    if (['pending', 'connecting', 'creating', 'processing'].includes(status)) {
      return { label: cap(status), tone: 'muted', detail: '' };
    }
    return { label: cap(status), tone: 'muted', detail: lastError?.message || '' };
  }

  function renderPlaidConnections() {
    const list = $('#plaid-connection-list');
    const empty = $('#plaid-empty');
    if (!list || !empty) return;

    list.innerHTML = '';
    if (!PLAID_ITEMS.length) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    for (const item of PLAID_ITEMS) {
      const accounts = Array.isArray(item?.accounts) ? item.accounts : [];
      const institution = item?.institution || {};
      const instName = institution.name || item?.institutionName || 'Institution';
      const logo = institution.logo || item?.institutionLogo || '';
      const shortName = instName.slice(0, 2).toUpperCase();
      const status = deriveConnectionStatus(item);
      const lastSync = item?.lastSyncedAt || item?.lastSyncAt || item?.syncedAt || item?.updatedAt;
      const linkedAt = item?.createdAt || item?.linkedAt;

      const accountsHtml = accounts.length
        ? accounts.map(ac => {
            const mask = ac?.mask || ac?.accountMask || ac?.last4 || '';
            const maskDisplay = mask ? `•••• ${String(mask).slice(-4)}` : '••••';
            const subtype = ac?.subtype || ac?.accountSubtype || ac?.type || '';
            const name = ac?.name || ac?.officialName || ac?.accountName || subtype || 'Account';
            const balance = formatPlaidBalance(ac);
            const available = ac?.balances?.available ?? ac?.balances?.availableBalance;
            const availableText = (available !== null && typeof available !== 'undefined' && available !== '')
              ? ` · Avail ${fmtMoney(Number(available), ac?.balances?.isoCurrencyCode || ac?.balances?.iso_currency_code || ac?.currency || 'GBP')}`
              : '';
            const subtypeText = subtype ? ` · ${escapeHtml(cap(subtype))}` : '';
            return `<li class="account-line">
              <div><strong>${escapeHtml(name)}</strong> <span class="mask">${escapeHtml(maskDisplay)}</span>${subtypeText}</div>
              <div>${balance}${availableText}</div>
            </li>`;
          }).join('')
        : '<li class="account-line"><span class="text-muted">No accounts returned yet.</span></li>';

      const metaParts = [];
      if (linkedAt) {
        const nice = isoToNice(linkedAt);
        if (nice && nice !== '—') metaParts.push(`Linked ${nice}`);
      }
      if (lastSync) {
        const nice = isoToNice(lastSync);
        if (nice && nice !== '—') metaParts.push(`Last sync ${nice}`);
      }
      if (item?.status?.description) metaParts.push(escapeHtml(item.status.description));
      if (status.detail) metaParts.push(escapeHtml(status.detail));

      const tile = document.createElement('div');
      tile.className = 'connection-tile';
      tile.dataset.connectionId = item?.id || item?.itemId || item?.plaidItemId || '';
      tile.innerHTML = `
        <div class="connection-head">
          <div class="connection-bank">
            ${logo ? `<img src="${logo}" alt="${escapeHtml(instName)} logo" loading="lazy">` : `<div class="logo-fallback">${escapeHtml(shortName)}</div>`}
            <div>
              <div class="fw-semibold">${escapeHtml(instName)}</div>
              <div class="connection-meta">${metaParts.join(' · ')}</div>
            </div>
          </div>
          <div class="connection-actions">
            <span class="badge-status ${status.tone}">${escapeHtml(status.label)}</span>
            <button class="btn btn-outline-primary btn-sm" type="button" data-action="renew">Renew</button>
            <button class="btn btn-outline-danger btn-sm" type="button" data-action="delete">Remove</button>
          </div>
        </div>
        <ul class="account-list">${accountsHtml}</ul>
      `;

      list.appendChild(tile);
    }
  }

  async function refreshPlaidConnections({ silent=false } = {}) {
    const list = $('#plaid-connection-list');
    if (!list) return;
    if (!silent) list.dataset.loading = 'true';
    try {
      const res = await Auth.fetch('/api/plaid/items?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load Plaid items');
      const payload = await res.json();
      PLAID_ITEMS = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
    } catch (err) {
      console.error('Failed to load Plaid connections', err);
      PLAID_ITEMS = [];
    } finally {
      if (list.dataset.loading) delete list.dataset.loading;
      renderPlaidConnections();
    }
  }

  function ensurePlaidScript() {
    if (window.Plaid) return Promise.resolve(window.Plaid);
    if (PLAID_SCRIPT_PROMISE) return PLAID_SCRIPT_PROMISE;
    PLAID_SCRIPT_PROMISE = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-plaid-link-script]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.Plaid));
        existing.addEventListener('error', () => reject(new Error('Plaid Link failed to load.')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
      script.async = true;
      script.dataset.plaidLinkScript = 'true';
      script.onload = () => {
        if (window.Plaid) resolve(window.Plaid);
        else reject(new Error('Plaid Link unavailable after load.'));
      };
      script.onerror = () => reject(new Error('Plaid Link script failed to load.'));
      document.head.appendChild(script);
    });
    return PLAID_SCRIPT_PROMISE;
  }

  async function handlePlaidLinkSuccess({ publicToken, metadata, mode, itemId }) {
    try {
      const res = await Auth.fetch('/api/plaid/link/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken, metadata, mode, itemId })
      });
      if (!res.ok) {
        let errText = 'Unable to save Plaid connection.';
        try {
          const errJson = await res.json();
          if (errJson?.error) errText = errJson.error;
        } catch {}
        throw new Error(errText);
      }
      await refreshPlaidConnections({ silent: true });
    } catch (err) {
      console.error('Plaid exchange failed', err);
      alert(err.message || 'Plaid connection failed.');
    }
  }

  async function launchPlaidLink({ mode = 'create', itemId = null, button = null } = {}) {
    const btn = button;
    const resetBtn = () => {
      if (!btn) return;
      btn.disabled = false;
      if (btn.dataset.origLabel) btn.textContent = btn.dataset.origLabel;
    };

    try {
      if (btn) {
        btn.dataset.origLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = mode === 'update' ? 'Opening…' : 'Connecting…';
      }
      const plaid = await ensurePlaidScript();
      const res = await Auth.fetch('/api/plaid/link/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, itemId })
      });
      if (!res.ok) throw new Error('Unable to get Plaid link token.');
      const payload = await res.json();
      const token = payload?.token || payload?.link_token;
      if (!token) throw new Error('Plaid token missing.');

      const handler = plaid.create({
        token,
        onSuccess: async (public_token, metadata) => {
          await handlePlaidLinkSuccess({ publicToken: public_token, metadata, mode, itemId });
        },
        onExit: (err, metadata) => {
          if (err) console.warn('Plaid Link exited with error', err, metadata);
        }
      });
      handler.open();
    } catch (err) {
      console.error('Plaid Link launch failed', err);
      alert(err.message || 'Unable to open Plaid Link.');
    } finally {
      resetBtn();
    }
  }

  function setupPlaidIntegration() {
    if (PLAID_BINDINGS_READY) return;
    PLAID_BINDINGS_READY = true;

    const connectBtn = $('#btn-connect-plaid');
    if (connectBtn) {
      connectBtn.addEventListener('click', () => launchPlaidLink({ mode: 'create', button: connectBtn }));
    }

    const refreshBtn = $('#btn-refresh-plaid');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        const orig = refreshBtn.textContent;
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing…';
        try {
          await refreshPlaidConnections();
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.textContent = orig;
        }
      });
    }

    const list = $('#plaid-connection-list');
    if (list) {
      list.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-action]');
        if (!btn) return;
        const tile = btn.closest('[data-connection-id]');
        if (!tile) return;
        const id = tile.dataset.connectionId;
        const action = btn.dataset.action;
        if (!id) {
          alert('Missing connection identifier.');
          return;
        }
        if (action === 'renew') {
          launchPlaidLink({ mode: 'update', itemId: id, button: btn });
        } else if (action === 'delete') {
          deletePlaidConnection(id, btn);
        }
      });
    }

    ensurePlaidScript().catch((err) => console.warn('Plaid script pre-load failed', err));
  }

  async function deletePlaidConnection(id, btn) {
    if (!confirm('Remove this Plaid connection?')) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Removing…';
    try {
      const res = await Auth.fetch(`/api/plaid/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        let msg = 'Failed to remove connection.';
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {}
        throw new Error(msg);
      }
      await refreshPlaidConnections({ silent: true });
    } catch (err) {
      console.error('Delete connection failed', err);
      alert(err.message || 'Unable to remove connection.');
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
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

      // parallel fetches
      const [meRes, plansRes, subRes, pmRes] = await Promise.all([
        Auth.fetch('/api/user/me'),
        Auth.fetch('/api/billing/plans?t=' + Date.now()),
        Auth.fetch('/api/billing/subscription?t=' + Date.now()),
        Auth.fetch('/api/billing/payment-methods?t=' + Date.now()),
      ]);

      USER = meRes.ok ? await meRes.json() : null;
      const plansPayload = plansRes.ok ? await plansRes.json() : { plans: [] };
      PLANS = plansPayload.plans || [];
      PLANS.forEach(p => { PLAN_BY_ID[p.id] = p; });
      SUBSCRIPTION = subRes.ok ? await subRes.json() : null;
      const pmPayload = pmRes.ok ? await pmRes.json() : { methods: [] };
      PAYMENT_METHODS = pmPayload.methods || [];

      renderProfile();
      renderBilling();
      computeStats();
      bindEditControls();
      loadNotes();
      setupPlaidIntegration();
      await refreshPlaidConnections({ silent: true });
    } catch (e) {
      console.error('Profile init error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
