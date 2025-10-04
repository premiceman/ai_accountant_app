// frontend/js/profile.js
(function () {
  let USER = null;
  let SUBSCRIPTION = null;
  let PLANS = [];
  let PLAN_BY_ID = {};
  let PAYMENT_METHODS = [];

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
    } catch (e) {
      console.error('Profile init error:', e);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
