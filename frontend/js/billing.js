// frontend/js/billing.js
let CURRENT_PLAN = 'free';
let CURRENT_CYCLE = 'monthly';   // 'monthly' | 'yearly' (from server)
let PLANS = [];
let PAYMENT_METHODS = [];
let CYCLE = 'monthly';           // UI toggle state

(async function init() {
  try {
    const { token } = await Auth.requireAuth();
    console.debug('[billing] JWT present?', !!token);

    Auth.setBannerTitle('Billing & Plans');
    wireCycleToggle();
    await loadPlans();
    await loadPaymentMethods();
    bindForm();
  } catch (e) {
    console.error(e);
    setMsg('Failed to load billing.');
  }
})();

/* ----------------------------- helpers ----------------------------- */
const $id = (id) => document.getElementById(id);
const setMsg = (t) => { const el = $id('billing-msg'); if (el) el.textContent = t || ''; };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const symbol = (curr) => (String(curr||'GBP').toUpperCase()==='GBP' ? '£' : String(curr).toUpperCase()==='EUR' ? '€' : '$');
const money  = (sym, n) => `${sym}${Number(n||0).toFixed(2)}`;
const plansContainer = () => $id('plans-row') || $id('plans-grid') || $id('billing-plans');

function hardRedirectToLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = `./login.html?next=${next}`;
}

/* -------------------------- cycle toggle -------------------------- */
function wireCycleToggle() {
  const radios = Array.from(document.querySelectorAll('input[name="billing-cycle"]'));
  const m = $id('cycle-monthly'), y = $id('cycle-yearly');

  const setCycle = (val) => { CYCLE = val; renderPlans(); };

  if (radios.length) {
    radios.forEach(r => r.addEventListener('change', () => r.checked && setCycle(r.value === 'yearly' ? 'yearly' : 'monthly')));
    const checked = radios.find(r => r.checked);
    setCycle(checked ? (checked.value === 'yearly' ? 'yearly' : 'monthly') : 'monthly');
  } else {
    if (m) m.addEventListener('change', () => m.checked && setCycle('monthly'));
    if (y) y.addEventListener('change', () => y.checked && setCycle('yearly'));
    if (m && y && !m.checked && !y.checked) { m.checked = true; CYCLE = 'monthly'; }
  }
}

/* keep the toggle in sync with server-reported cycle */
function syncToggleToCurrentCycle() {
  const m = $id('cycle-monthly'), y = $id('cycle-yearly');
  if (CURRENT_CYCLE === 'yearly') {
    if (y && !y.checked) y.checked = true;
    CYCLE = 'yearly';
  } else {
    if (m && !m.checked) m.checked = true;
    CYCLE = 'monthly';
  }
}

/* ------------------------------ plans ----------------------------- */
async function loadPlans() {
  try {
    const r = await Auth.fetch('/api/billing/plans?t=' + Date.now(), { cache: 'no-store' });
    if (r.status === 401) return hardRedirectToLogin();
    if (!r.ok) { setMsg('Could not load plans.'); return; }
    const j = await r.json();
    CURRENT_PLAN  = (j.current || 'free').toLowerCase();
    CURRENT_CYCLE = (j.currentCycle || 'monthly').toLowerCase();
    PLANS = Array.isArray(j.plans) ? j.plans : [];
    syncToggleToCurrentCycle();   // 👈 reflect server state in the UI
    renderPlans();
  } catch (err) {
    console.error('[billing] loadPlans error', err);
    setMsg('Could not load plans.');
  }
}

function renderPlans() {
  const wrap = plansContainer();
  if (!wrap) return;
  wrap.innerHTML = '';

  for (const p of PLANS) {
    const sym = symbol(p.currency);
    const monthlyPrice = (p.priceMonthly != null) ? p.priceMonthly : (p.price != null ? p.price : 0);
    const yearlyPrice  = (p.priceYearly  != null) ? p.priceYearly  : (p.price != null ? p.price * 12 : 0);

    const isCurrentPlan   = (String(p.id) === String(CURRENT_PLAN));
    const isCurrentCycle  = (CYCLE === CURRENT_CYCLE);
    const isCurrent = isCurrentPlan && isCurrentCycle;

    const price = CYCLE === 'yearly' ? money(sym, Number(yearlyPrice||0))
                                     : money(sym, Number(monthlyPrice||0));
    const per = CYCLE === 'yearly' ? '/yr' : '/mo';
    const recommended = (CYCLE === 'yearly' && p.id === 'professional');

    let btnDisabled = false;
    let btnLabel = '';
    if (isCurrent) {
      btnDisabled = true;
      btnLabel = `Your plan (${CURRENT_CYCLE[0].toUpperCase()+CURRENT_CYCLE.slice(1)})`;
    } else if (isCurrentPlan && !isCurrentCycle) {
      btnDisabled = false;
      btnLabel = `Switch to ${CYCLE === 'yearly' ? 'Yearly' : 'Monthly'}`;
    } else {
      btnDisabled = false;
      btnLabel = `Select ${escapeHtml(p.name)}`;
    }

    const badgeText = isCurrent ? `Current (${CURRENT_CYCLE[0].toUpperCase()+CURRENT_CYCLE.slice(1)})` : 'Current';

    const col = document.createElement('div');
    col.className = 'col-12 col-md-4';
    col.innerHTML = `
      <div class="card plan-card card-hover position-relative h-100">
        ${recommended ? '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle position-absolute top-0 end-0 m-2">Recommended</span>' : ''}
        ${isCurrent ? `<span class="badge text-bg-success plan-badge position-absolute top-0 start-0 m-2">${escapeHtml(badgeText)}</span>` : ''}
        <div class="card-body d-flex flex-column">
          <div class="plan-header pb-2 mb-3">
            <h5 class="card-title mb-1">${escapeHtml(p.name)}</h5>
            <div class="text-muted small">${escapeHtml(p.badge || '')}</div>
          </div>
          <div class="display-6 mb-2">${price}<span class="fs-6 text-muted">${per}</span></div>
          <ul class="mb-3">
            ${(Array.isArray(p.features)?p.features:[]).map(f => `<li>${escapeHtml(f)}</li>`).join('')}
          </ul>
          <div class="mt-auto">
            <button class="btn ${isCurrent ? 'btn-outline-secondary' : 'btn-primary'} w-100"
                    data-plan="${escapeHtml(p.id)}"
                    ${btnDisabled ? 'disabled' : ''}>
              ${escapeHtml(btnLabel)}
            </button>
          </div>
        </div>
      </div>
    `;
    wrap.appendChild(col);
    col.querySelector('button[data-plan]').addEventListener('click', () => onSelectPlan(p.id));
  }
}

/* ------------------------- select / subscribe ------------------------- */
async function onSelectPlan(planId) {
  const btn = document.activeElement?.closest('button[data-plan]');
  const setBusy = (v) => { if (btn) { btn.disabled = !!v; btn.setAttribute('aria-busy', v ? 'true' : 'false'); } };

  try {
    if (planId === 'free') {
      if (!confirm('Switch to Free plan? Your paid features will be disabled.')) return;
      setBusy(true);
      const r = await Auth.fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'free', interval: 'monthly' })
      });
      if (r.status === 401) return hardRedirectToLogin();
      if (!r.ok) { const t = await r.text(); alert('Failed to switch: ' + (t || r.status)); return; }
      await loadPlans();
      setMsg('Switched to Free.');
      return;
    }

    setBusy(true);
    const resp = await Auth.fetch('/api/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planId, interval: CYCLE })
    });
    if (resp.status === 401) return hardRedirectToLogin();
    if (!resp.ok) {
      let msg = 'Upgrade failed';
      try { const j = await resp.json(); if (j?.error) msg = j.error; } catch {}
      alert(msg);
      const form = document.getElementById('pm-form');
      if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    await loadPlans();
    setMsg('Subscription updated.');
  } finally {
    setBusy(false);
  }
}

/* ------------------------ payment methods ------------------------ */
async function loadPaymentMethods() {
  try {
    const r = await Auth.fetch('/api/billing/payment-methods?t=' + Date.now(), { cache: 'no-store' });
    if (r.status === 401) return hardRedirectToLogin();
    if (!r.ok) { setMsg('Could not load payment methods.'); return; }
    const j = await r.json();
    PAYMENT_METHODS = j.methods || [];
    renderPMList();
  } catch (err) {
    console.error('[billing] loadPaymentMethods error', err);
    setMsg('Could not load payment methods.');
  }
}

function renderPMList() {
  const wrap = $id('pm-list');
  if (!wrap) return;

  if (PAYMENT_METHODS.length === 0) {
    wrap.innerHTML = '<div class="text-muted small">No cards saved yet.</div>';
    return;
  }
  const list = document.createElement('div');
  for (const m of PAYMENT_METHODS) {
    const div = document.createElement('div');
    div.className = 'border rounded p-2 mb-2';
    div.innerHTML = `
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <strong>${escapeHtml(m.brand || 'Card')}</strong>
          <span class="text-muted">•••• ${escapeHtml(m.last4 || '')}</span>
          <span class="text-muted">exp ${String(m.expMonth).padStart(2,'0')}/${escapeHtml(m.expYear)}</span>
          ${m.isDefault ? '<span class="badge text-bg-primary ms-2">Default</span>' : ''}
        </div>
        <div class="btn-group">
          <button class="btn btn-sm btn-outline-secondary" data-action="make-default" data-id="${m._id}" ${m.isDefault ? 'disabled' : ''}>Make default</button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${m._id}">Delete</button>
        </div>
      </div>
    `;
    list.appendChild(div);

    div.querySelector('[data-action="make-default"]').addEventListener('click', async () => {
      const r = await Auth.fetch(`/api/billing/payment-methods/${m._id}/default`, { method: 'PATCH' });
      if (r.status === 401) return hardRedirectToLogin();
      if (!r.ok) { alert('Failed to update default'); return; }
      await loadPaymentMethods();
    });

    div.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this payment method?')) return;
      const r = await Auth.fetch(`/api/billing/payment-methods/${m._id}`, { method: 'DELETE' });
      if (r.status === 401) return hardRedirectToLogin();
      if (!r.ok) {
        let msg = 'Delete failed';
        try { const j = await r.json(); if (j?.error) msg = j.error; } catch {}
        if (/Free tier/i.test(msg) || /last payment method/i.test(msg) || /paid plan/i.test(msg)) {
          if (confirm(msg)) {
            const d = await Auth.fetch('/api/billing/subscribe', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan: 'free', interval: 'monthly' })
            });
            if (d.status === 401) return hardRedirectToLogin();
            if (d.ok) {
              await loadPlans();
              const r2 = await Auth.fetch(`/api/billing/payment-methods/${m._id}`, { method: 'DELETE' });
              if (r2.status === 401) return hardRedirectToLogin();
              if (!r2.ok) { alert('Delete still failed.'); return; }
              await loadPaymentMethods();
            } else {
              alert('Downgrade failed.');
            }
          }
        } else {
          alert(msg);
        }
        return;
      }
      await loadPaymentMethods();
    });
  }
  wrap.innerHTML = '';
  wrap.appendChild(list);
}

/* -------------------------- add-card form ------------------------- */
function bindForm() {
  const form = $id('pm-form');
  const msg  = $id('pm-form-msg');
  if (!form) return;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msg.textContent = '';
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    if (!data.holder || !data.cardNumber || !data.expMonth || !data.expYear) {
      msg.textContent = 'Please fill all required fields.'; return;
    }
    const r = await Auth.fetch('/api/billing/payment-methods', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (r.status === 401) return hardRedirectToLogin();
    if (!r.ok) { const t = await r.text(); msg.textContent = 'Add failed: ' + t; return; }
    form.reset();
    msg.textContent = 'Card added.';
    await loadPaymentMethods();
  });
}
