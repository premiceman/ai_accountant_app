// frontend/js/billing-checkout.js
let PLAN = null;
let PLANS = [];
let METHODS = [];

(async function init() {
  try {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Checkout');

    const url = new URL(location.href);
    const planId = url.searchParams.get('plan') || 'basic';

    await loadPlans();
    PLAN = PLANS.find(p => p.id === planId) || PLANS.find(p => p.id === 'basic');

    if (!PLAN) { document.getElementById('checkout-msg').textContent = 'Plan not found.'; return; }

    renderPlan(PLAN);
    await loadMethods();
    renderMethodSelect(PLAN);
    bindConfirm(PLAN);
  } catch (e) {
    console.error(e);
    document.getElementById('checkout-msg').textContent = 'Failed to load checkout.';
  }
})();

async function loadPlans() {
  const r = await Auth.fetch('/api/billing/plans');
  const j = await r.json();
  PLANS = j.plans || [];
}

function renderPlan(p) {
  document.getElementById('plan-name').textContent = `${p.name} — $${p.price.toFixed(2)}/mo`;
  document.getElementById('plan-badge').textContent = p.badge || '';
  const ul = document.getElementById('plan-features');
  ul.innerHTML = p.features.map(f => `<li>${escapeHtml(f)}</li>`).join('');
}

async function loadMethods() {
  const r = await Auth.fetch('/api/billing/payment-methods');
  const j = await r.json();
  METHODS = j.methods || [];
}

function renderMethodSelect(plan) {
  const wrap = document.getElementById('pm-select-wrap');
  const list = document.getElementById('pm-select');
  if (plan.id === 'free') {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  if (METHODS.length === 0) {
    list.innerHTML = `<div class="text-muted small">No saved cards. Please go back to Billing and add a card first.</div>`;
    document.getElementById('confirm-btn').disabled = true;
    return;
  }
  list.innerHTML = METHODS.map(m => `
    <div class="form-check">
      <input class="form-check-input" type="radio" name="pm" id="pm-${m._id}" value="${m._id}" ${m.isDefault ? 'checked' : ''}>
      <label class="form-check-label" for="pm-${m._id}">
        ${escapeHtml(m.brand || 'Card')} •••• ${m.last4} (exp ${String(m.expMonth).padStart(2,'0')}/${m.expYear}) ${m.isDefault ? '<span class="badge text-bg-primary">Default</span>' : ''}
      </label>
    </div>
  `).join('');
}

function bindConfirm(plan) {
  const btn = document.getElementById('confirm-btn');
  btn.addEventListener('click', async () => {
    const msg = document.getElementById('checkout-msg');
    msg.textContent = '';
    let paymentMethodId = null;
    if (plan.id !== 'free') {
      const sel = document.querySelector('input[name="pm"]:checked');
      if (!sel) { msg.textContent = 'Select a payment method.'; return; }
      paymentMethodId = sel.value;
    }
    const r = await Auth.fetch('/api/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: plan.id, paymentMethodId })
    });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok) {
      msg.textContent = j.error || 'Subscription failed.'; return;
    }
    msg.textContent = 'Subscription active. Redirecting…';
    setTimeout(() => location.href = './billing.html', 800);
  });
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
