// frontend/js/billing.js
let CURRENT_PLAN = 'free';
let PLANS = [];
let PAYMENT_METHODS = [];

(async function init() {
  try {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Billing & Plans');
    await loadPlans();
    await loadPaymentMethods();
    bindForm();
  } catch (e) {
    console.error(e);
    setMsg('Failed to load billing.');
  }
})();

async function loadPlans() {
  const r = await Auth.fetch('/api/billing/plans');
  const j = await r.json();
  CURRENT_PLAN = j.current || 'free';
  PLANS = j.plans || [];
  renderPlans();
}

function renderPlans() {
  const row = document.getElementById('plans-row');
  row.innerHTML = '';
  for (const p of PLANS) {
    const isCurrent = (p.id === CURRENT_PLAN);
    const price = p.price === 0 ? '$0' : `$${p.price.toFixed(2)}`;
    const col = document.createElement('div');
    col.className = 'col-12 col-md-4';
    col.innerHTML = `
      <div class="card plan-card card-hover position-relative h-100">
        ${isCurrent ? '<span class="badge text-bg-success plan-badge">Current plan</span>' : ''}
        <div class="card-body d-flex flex-column">
          <div class="plan-header pb-2 mb-3">
            <h5 class="card-title mb-1">${p.name}</h5>
            <div class="text-muted small">${p.badge || ''}</div>
          </div>
          <div class="display-6 mb-2">${price}<span class="fs-6 text-muted">/mo</span></div>
          <ul class="mb-3">
            ${p.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
          </ul>
          <div class="mt-auto">
            <button class="btn ${isCurrent ? 'btn-outline-secondary' : 'btn-primary'} w-100" data-plan="${p.id}" ${isCurrent ? 'disabled' : ''}>
              ${p.id === 'free' ? 'Switch to Free' : `Select ${p.name}`}
            </button>
          </div>
        </div>
      </div>
    `;
    row.appendChild(col);
    const btn = col.querySelector('button[data-plan]');
    btn.addEventListener('click', () => onSelectPlan(p.id));
  }
}

async function onSelectPlan(planId) {
  if (planId === 'free') {
    if (!confirm('Switch to Free plan? Your paid features will be disabled.')) return;
    const r = await Auth.fetch('/api/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'free' })
    });
    if (!r.ok) { const t = await r.text(); alert('Failed to switch: ' + t); return; }
    await loadPlans();
    setMsg('Switched to Free.');
    return;
  }
  // Navigate to checkout for Basic/Premium
  location.href = `./billing-checkout.html?plan=${encodeURIComponent(planId)}`;
}

async function loadPaymentMethods() {
  const r = await Auth.fetch('/api/billing/payment-methods');
  const j = await r.json();
  PAYMENT_METHODS = j.methods || [];
  renderPMList();
}

function renderPMList() {
  const wrap = document.getElementById('pm-list');
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
          <span class="text-muted">•••• ${m.last4}</span>
          <span class="text-muted">exp ${String(m.expMonth).padStart(2,'0')}/${m.expYear}</span>
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
      if (!r.ok) { alert('Failed to update default'); return; }
      await loadPaymentMethods();
    });

    div.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this payment method?')) return;
      const r = await Auth.fetch(`/api/billing/payment-methods/${m._id}`, { method: 'DELETE' });
      if (!r.ok) {
        let msg = 'Delete failed';
        try { const j = await r.json(); if (j?.error) msg = j.error; } catch {}
        // Offer downgrade if blocked by paid plan and last card
        if (/downgrade/i.test(msg) || /paid plan/i.test(msg)) {
          if (confirm(msg + '\n\nWould you like to downgrade to Free now?')) {
            const d = await Auth.fetch('/api/billing/subscribe', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan: 'free' })
            });
            if (d.ok) {
              await loadPlans();
              // retry deletion
              const r2 = await Auth.fetch(`/api/billing/payment-methods/${m._id}`, { method: 'DELETE' });
              if (!r2.ok) alert('Delete still failed.');
              else await loadPaymentMethods();
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

function bindForm() {
  const form = document.getElementById('pm-form');
  const msg = document.getElementById('pm-form-msg');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msg.textContent = '';
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    // Minimal client validation
    if (!data.holder || !data.cardNumber || !data.expMonth || !data.expYear) {
      msg.textContent = 'Please fill all required fields.'; return;
    }
    const r = await Auth.fetch('/api/billing/payment-methods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!r.ok) {
      const t = await r.text();
      msg.textContent = 'Add failed: ' + t;
      return;
    }
    form.reset();
    msg.textContent = 'Card added.';
    await loadPaymentMethods();
  });
}

function setMsg(t){ const el=document.getElementById('billing-msg'); if(el) el.textContent=t||''; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
