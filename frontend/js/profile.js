// frontend/js/profile.js
(function () {
  const state = {
    user: null,
    subscription: null,
    plans: [],
    paymentMethods: []
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const moneyFormatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

  function fmtMoney(amount, currency = 'GBP') {
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(amount || 0));
    } catch {
      return moneyFormatter.format(Number(amount || 0));
    }
  }

  function isoToNice(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function isoToDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  function cap(text) {
    const str = String(text || '');
    return str.slice(0, 1).toUpperCase() + str.slice(1);
  }

  function daysBetween(start, end = new Date()) {
    if (!start) return '—';
    const a = new Date(start);
    const b = new Date(end);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '—';
    const diff = Math.abs(b.getTime() - a.getTime());
    return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)));
  }

  function cacheUser(user) {
    if (!user) return;
    window.__ME__ = user;
    try { localStorage.setItem('me', JSON.stringify(user)); } catch {}
    try { sessionStorage.setItem('me', JSON.stringify(user)); } catch {}
    if (typeof window.hydrateTopbarMeta === 'function') {
      try { window.hydrateTopbarMeta(); } catch (err) { console.warn('hydrateTopbarMeta failed', err); }
    }
  }

  function planFor(id) {
    if (!id) return null;
    const uiId = String(id).toLowerCase() === 'premium' ? 'professional' : String(id).toLowerCase();
    return state.plans.find((plan) => plan.id === uiId) || null;
  }

  function currentPlanId() {
    const tier = state.subscription?.licenseTier || state.user?.licenseTier || 'free';
    return String(tier || 'free').toLowerCase();
  }

  function currentInterval() {
    return String(state.subscription?.subscription?.interval || 'monthly').toLowerCase();
  }

  function showStatus(message, variant = 'info') {
    const box = $('#profile-status');
    if (!box) return;
    if (!message) {
      box.classList.add('d-none');
      box.textContent = '';
      return;
    }
    box.className = `alert alert-${variant} border border-${variant}-subtle mb-3`;
    box.textContent = message;
  }

  function setTileGrid(tiles) {
    const wrap = $('#stat-tiles');
    if (!wrap) return;
    wrap.innerHTML = '';
    tiles.forEach((tile) => {
      const node = document.createElement('div');
      node.className = 'tile';
      node.innerHTML = `
        <div class="k">${tile.label}</div>
        <div class="v">
          <span>${tile.value}</span>
          ${tile.meta ? `<span class="delta ${tile.metaTone || ''}">${tile.meta}</span>` : ''}
        </div>
      `;
      wrap.appendChild(node);
    });
  }

  function computeStats() {
    if (!state.user) return;
    const planId = currentPlanId();
    const interval = currentInterval();
    const plan = planFor(planId);
    const uiPlanId = plan ? plan.id : (planId === 'premium' ? 'professional' : planId);

    let planLabel = cap(uiPlanId || 'free');
    if (planLabel === 'Professional') planLabel = 'Premium';
    const cadenceLabel = interval === 'yearly' ? 'Yearly' : 'Monthly';

    const price = plan
      ? (interval === 'yearly' ? plan.priceYearly : plan.priceMonthly)
      : 0;
    const priceDisplay = plan ? `${fmtMoney(price, plan.currency)} / ${interval === 'yearly' ? 'yr' : 'mo'}` : '—';

    const emailStatus = state.user.emailVerified ? 'Verified' : 'Awaiting verification';
    const emailTone = state.user.emailVerified ? 'up' : 'down';
    const emailMeta = state.user.emailVerified ? 'All secure' : 'Verify in settings';

    const tiles = [
      { label: 'Plan', value: planLabel },
      { label: 'Billing cadence', value: cadenceLabel },
      { label: 'Plan cost', value: priceDisplay, meta: plan ? (interval === 'yearly' ? 'Best value' : 'Switch to yearly and save') : null, metaTone: interval === 'yearly' ? 'up' : 'info' },
      { label: 'Days with Phloat', value: `${daysBetween(state.user.createdAt)} days` },
      { label: 'Email status', value: emailStatus, meta: emailMeta, metaTone: emailTone },
      { label: 'Profile refreshed', value: isoToDate(state.user.updatedAt) }
    ];

    setTileGrid(tiles);
  }

  function renderProfile() {
    if (!state.user) return;
    $('#f-first').value = state.user.firstName || '';
    $('#f-last').value = state.user.lastName || '';
    $('#f-username').value = state.user.username || '';
    $('#f-email').value = state.user.email || '';
    $('#f-dob').value = isoToDate(state.user.dateOfBirth);

    const planId = currentPlanId();
    const plan = planFor(planId);
    const uiPlanId = plan ? plan.id : (planId === 'premium' ? 'professional' : planId);
    $('#f-tier').value = cap(uiPlanId || 'free');

    $('#f-eula-ver').value = state.user.eulaVersion || '—';
    $('#f-eula-at').value = isoToNice(state.user.eulaAcceptedAt);
    $('#f-created').value = isoToNice(state.user.createdAt);
    $('#f-updated').value = isoToNice(state.user.updatedAt);

    $('#eula-version').textContent = state.user.eulaVersion || '—';
    $('#eula-date').textContent = isoToDate(state.user.eulaAcceptedAt);

    Auth.setBannerTitle('Profile');
    const greeting = $('#greeting-name');
    if (greeting && state.user.firstName) greeting.textContent = state.user.firstName;
  }

  function renderBilling() {
    const summary = $('#sub-summary');
    const priceEl = $('#sub-price');
    const benefitList = $('#benefit-list');
    const pmWrap = $('#pm-list');

    benefitList.innerHTML = '';
    pmWrap.innerHTML = '';

    const planId = currentPlanId();
    const plan = planFor(planId);
    const uiPlanId = plan ? plan.id : (planId === 'premium' ? 'professional' : planId);
    const interval = currentInterval();
    const cadenceLabel = interval === 'yearly' ? 'Yearly' : 'Monthly';

    summary.textContent = `${cap(uiPlanId || 'free')} plan`;
    if (plan && uiPlanId !== 'free') {
      const price = interval === 'yearly' ? plan.priceYearly : plan.priceMonthly;
      priceEl.textContent = `${fmtMoney(price, plan.currency)} · ${cadenceLabel}`;
    } else {
      priceEl.textContent = '£0.00 · Free tier';
    }

    const features = plan?.features || [];
    if (features.length) {
      features.forEach((feature) => {
        const li = document.createElement('li');
        li.textContent = feature;
        benefitList.appendChild(li);
      });
    } else {
      const li = document.createElement('li');
      li.className = 'text-muted';
      li.textContent = 'Upgrade to unlock full benefits.';
      benefitList.appendChild(li);
    }

    if (!state.paymentMethods.length) {
      pmWrap.innerHTML = '<div class="small muted">Add a card in Billing to enable upgrades.</div>';
    } else {
      state.paymentMethods.forEach((method) => {
        const div = document.createElement('div');
        div.className = 'method';
        div.innerHTML = `
          <div>
            <strong>${method.brand || 'Card'}</strong>
            <span class="text-muted"> •••• ${method.last4 || ''}</span>
            <span class="text-muted"> · exp ${String(method.expMonth).padStart(2, '0')}/${method.expYear}</span>
          </div>
          ${method.isDefault ? '<span class="badge badge-default">Default</span>' : ''}
        `;
        pmWrap.appendChild(div);
      });
    }
  }

  function toggleEditing(enabled) {
    const card = $('#profile-card');
    card?.classList.toggle('editing', enabled);
    $$('.profile-fields [data-editable="true"] input').forEach((input, idx) => {
      input.readOnly = !enabled;
      input.classList.toggle('is-editing', enabled);
      if (enabled && idx === 0) {
        setTimeout(() => input.focus(), 20);
      }
    });
    if (!enabled) showStatus('');
  }

  function gatherProfileForm() {
    return {
      firstName: ($('#f-first').value || '').trim(),
      lastName: ($('#f-last').value || '').trim(),
      username: ($('#f-username').value || '').trim(),
      email: ($('#f-email').value || '').trim()
    };
  }

  function validateProfileForm(form) {
    if (!form.firstName || !form.lastName || !form.email) {
      throw new Error('First name, last name and email are required.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      throw new Error('Please enter a valid email address.');
    }
  }

  async function saveProfile() {
    const btn = $('#btn-save');
    const cancelBtn = $('#btn-cancel');
    const payload = gatherProfileForm();

    try {
      validateProfileForm(payload);
    } catch (err) {
      showStatus(err.message, 'warning');
      throw err;
    }

    btn.disabled = true;
    cancelBtn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Saving…';
    showStatus('Saving your changes…', 'info');

    try {
      const res = await Auth.fetch('/api/user/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let message = 'Unable to update profile.';
        try {
          const err = await res.json();
          if (err?.error) message = err.error;
        } catch {}
        throw new Error(message);
      }

      const updated = await res.json();
      state.user = updated;
      cacheUser(updated);
      renderProfile();
      computeStats();
      showStatus('Profile updated successfully.', 'success');
      toggleEditing(false);
    } catch (err) {
      console.error('Profile save failed', err);
      showStatus(err.message || 'Unable to update profile.', 'danger');
      throw err;
    } finally {
      btn.disabled = false;
      cancelBtn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function bindProfileEditing() {
    const editBtn = $('#btn-edit');
    const cancelBtn = $('#btn-cancel');
    const saveBtn = $('#btn-save');
    if (!editBtn || !cancelBtn || !saveBtn) return;

    editBtn.addEventListener('click', () => {
      toggleEditing(true);
      showStatus('Fields unlocked — remember to save when you are done.', 'info');
    });

    cancelBtn.addEventListener('click', (event) => {
      event.preventDefault();
      renderProfile();
      toggleEditing(false);
    });

    saveBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await saveProfile();
      } catch {
        // handled in saveProfile
      }
    });
  }

  function initNotes() {
    const textarea = $('#notes-box');
    const saveBtn = $('#btn-notes-save');
    if (!textarea || !saveBtn) return;
    const storageKey = 'profile_notes';
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) textarea.value = stored;
    } catch {}

    saveBtn.addEventListener('click', (event) => {
      event.preventDefault();
      try { localStorage.setItem(storageKey, textarea.value); } catch {}
      saveBtn.disabled = true;
      const original = saveBtn.textContent;
      saveBtn.textContent = 'Saved';
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = original;
      }, 1200);
    });
  }

  async function refreshData() {
    const [meRes, subscriptionRes, paymentRes, plansRes] = await Promise.all([
      Auth.fetch('/api/user/me?t=' + Date.now(), { cache: 'no-store' }),
      Auth.fetch('/api/billing/subscription?t=' + Date.now(), { cache: 'no-store' }),
      Auth.fetch('/api/billing/payment-methods?t=' + Date.now(), { cache: 'no-store' }),
      Auth.fetch('/api/billing/plans?t=' + Date.now(), { cache: 'no-store' })
    ]);

    if (meRes.status === 401) {
      throw new Error('Authentication required');
    }
    if (!meRes.ok) {
      const text = await meRes.text();
      throw new Error(text || 'Unable to load profile');
    }
    state.user = await meRes.json();
    cacheUser(state.user);

    if (subscriptionRes.ok) {
      state.subscription = await subscriptionRes.json();
    } else {
      state.subscription = { licenseTier: state.user.licenseTier || 'free', subscription: null };
    }

    if (paymentRes.ok) {
      const payload = await paymentRes.json();
      state.paymentMethods = Array.isArray(payload?.methods) ? payload.methods : [];
    } else {
      state.paymentMethods = [];
    }

    if (plansRes.ok) {
      const payload = await plansRes.json();
      state.plans = Array.isArray(payload?.plans) ? payload.plans : [];
    } else {
      state.plans = [];
    }
  }

  async function init() {
    try {
      const { me } = await Auth.requireAuth();
      state.user = me;
      cacheUser(me);
    } catch (err) {
      console.error('Auth required', err);
      return;
    }

    try {
      await refreshData();
      renderProfile();
      renderBilling();
      computeStats();
      bindProfileEditing();
      initNotes();
    } catch (err) {
      console.error('Profile initialisation failed', err);
      showStatus(err.message || 'Unable to load your profile.', 'danger');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
