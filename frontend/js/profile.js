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

  const dangerActions = {
    purge: {
      id: 'purge',
      title: 'Delete all data',
      copy: 'This permanently removes your documents, insights, analytics and integrations. Your profile and billing stay intact.',
      endpoint: '/api/user/purge',
      method: 'POST',
      confirmLabel: 'Delete data',
      confirmLabelPending: 'Deleting…',
      successMessage: 'All non-billing data has been deleted.',
      successVariant: 'success',
      requiresReload: true
    },
    delete: {
      id: 'delete',
      title: 'Delete profile & all data',
      copy: 'This will delete your profile, billing records, and every piece of stored data. There is no way to undo this.',
      endpoint: '/api/user/me',
      method: 'DELETE',
      confirmLabel: 'Delete everything',
      confirmLabelPending: 'Deleting…',
      successMessage: 'Your account has been deleted. Redirecting…',
      successVariant: 'success',
      triggersSignOut: true
    }
  };

  let activeDangerAction = null;
  let dangerDialogBusy = false;

  const moneyFormatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });
  const intFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

  function fmtMoney(amount, currency = 'GBP') {
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(amount || 0));
    } catch {
      return moneyFormatter.format(Number(amount || 0));
    }
  }

  function fmtInt(value) {
    return intFormatter.format(Math.round(Number(value || 0)));
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

  function showDangerStatus(message, variant = 'info') {
    const box = $('#danger-status');
    if (!box) return;
    if (!message) {
      box.classList.add('d-none');
      box.textContent = '';
      return;
    }
    box.className = `alert alert-${variant} border border-${variant}-subtle`;
    box.textContent = message;
  }

  function setTileGrid(tiles) {
    const wrap = $('#stat-tiles');
    if (!wrap) return;
    wrap.innerHTML = '';
    tiles.forEach((tile) => {
      const node = document.createElement('div');
      node.className = ['tile', tile.className || ''].join(' ').trim();

      const head = document.createElement('div');
      head.className = 'tile-head';
      const label = document.createElement('div');
      label.className = 'k';
      label.textContent = tile.label;
      head.appendChild(label);
      if (tile.tooltip) {
        const tip = document.createElement('span');
        tip.className = 'tile-tip';
        tip.setAttribute('role', 'img');
        tip.setAttribute('aria-label', 'More information');
        tip.title = tile.tooltip;
        tip.textContent = 'ℹ︎';
        head.appendChild(tip);
      }
      node.appendChild(head);

      const valueWrap = document.createElement('div');
      valueWrap.className = 'v';
      const valueSpan = document.createElement('span');
      valueSpan.textContent = tile.value;
      valueWrap.appendChild(valueSpan);
      if (tile.meta) {
        const meta = document.createElement('span');
        meta.className = ['delta', tile.metaTone || ''].join(' ').trim();
        meta.textContent = tile.meta;
        valueWrap.appendChild(meta);
      }
      node.appendChild(valueWrap);

      if (tile.cta) {
        const link = document.createElement('a');
        link.className = 'tile-cta';
        link.href = tile.cta.href;
        link.textContent = tile.cta.label;
        link.setAttribute('aria-label', tile.cta.ariaLabel || tile.cta.label);
        if (tile.cta.target) link.target = tile.cta.target;
        if (tile.cta.rel) link.rel = tile.cta.rel;
        node.appendChild(link);
      }

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

    const usage = state.user.usageStats || {};
    const savedEstimate = usage.moneySavedEstimate || 0;
    const saved = Number(usage.moneySavedCumulative ?? savedEstimate);
    const savedDelta = usage.moneySavedChangePct;
    const savedTone = savedDelta == null ? 'info' : savedDelta >= 0 ? 'up' : 'down';
    let savedMeta = '';
    if (savedDelta == null) {
      savedMeta = usage.moneySavedPrevSpend
        ? `£${fmtInt(usage.moneySavedPrevSpend)} spent last period`
        : 'Baseline established';
    } else if (savedDelta === 0) {
      savedMeta = 'Level vs last period';
    } else {
      savedMeta = `${savedDelta > 0 ? '▲' : '▼'} ${fmtInt(Math.abs(savedDelta))}% vs last period`;
    }

    const docsProgress = Number(usage.documentsRequiredMet || 0);
    const docsTone = docsProgress >= 80 ? 'up' : docsProgress < 50 ? 'down' : 'info';
    const docsTotal = Number(usage.documentsRequiredTotal || 5);
    const docsMeta = `${fmtInt(usage.documentsRequiredCompleted || 0)} of ${fmtInt(docsTotal)} submitted`;

    const debtPaid = Number(usage.debtReduced || 0);
    const debtDelta = Number(usage.debtReductionDelta || 0);
    let debtMeta = '';
    let debtTone = 'info';
    if (debtDelta === 0) {
      debtMeta = 'Level vs last period';
      debtTone = 'info';
    } else {
      debtTone = debtDelta > 0 ? 'up' : 'down';
      debtMeta = `${debtDelta > 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(debtDelta))} vs last period`;
    }

    const roiTiles = [
      {
        label: 'Money saved',
        value: fmtMoney(saved),
        meta: savedMeta,
        metaTone: savedTone,
        tooltip: 'Estimated reduction in outgoings compared to the previous reporting window.',
        cta: { href: './scenario-lab.html', label: 'Open scenario lab', rel: 'noopener' }
      },
      {
        label: 'Required docs complete',
        value: `${fmtInt(Math.min(100, docsProgress))}%`,
        meta: docsMeta,
        metaTone: docsTone,
        tooltip: 'We track your key compliance uploads so you are HMRC-ready when filings are due.',
        cta: { href: './document-vault.html', label: 'Go to document vault', rel: 'noopener' }
      },
      {
        label: 'Debt paid down',
        value: fmtMoney(debtPaid),
        meta: debtMeta,
        metaTone: debtTone,
        tooltip: 'Positive cash flow is earmarked against outstanding credit and loan balances.',
        cta: { href: './wealth-lab.html', label: 'Explore wealth lab', rel: 'noopener' }
      }
    ];

    const planTiles = [
      { label: 'Plan', value: planLabel },
      { label: 'Billing cadence', value: cadenceLabel },
      {
        label: 'Plan cost',
        value: priceDisplay,
        meta: plan ? (interval === 'yearly' ? 'Best value' : 'Switch to yearly and save') : null,
        metaTone: interval === 'yearly' ? 'up' : 'info'
      },
      { label: 'Days with Phloat', value: `${daysBetween(state.user.createdAt)} days` },
      { label: 'Email status', value: emailStatus, meta: emailMeta, metaTone: emailTone },
      { label: 'Profile refreshed', value: isoToDate(state.user.updatedAt) }
    ];

    const tiles = [...roiTiles, ...planTiles];

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

  function bindOnboardingRerun() {
    const btn = $('#btn-rerun-onboarding');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (state.user?.onboardingComplete) {
        sessionStorage.setItem('onboarding_return_to', window.location.pathname);
      }
      window.location.href = '/onboarding.html?rerun=1';
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

  async function performDangerAction(action, confirmEmail) {
    const options = {
      method: action.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmEmail }),
      cache: 'no-store'
    };

    const response = await Auth.fetch(action.endpoint, options);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    let payload = null;
    if (contentType.includes('application/json')) {
      try { payload = await response.json(); } catch { payload = null; }
    } else {
      const text = await response.text().catch(() => '');
      payload = text ? { message: text } : null;
    }

    if (!response.ok) {
      if (response.status === 401 && window.Auth && typeof window.Auth.signOut === 'function') {
        window.Auth.signOut({ reason: 'unauthorized', redirect: '/login.html' });
      }
      const message = payload?.error || payload?.message || 'Unable to complete this action.';
      throw new Error(message);
    }

    return payload;
  }

  function bindDangerZone() {
    const zone = $('#danger-zone');
    const dialog = $('#danger-dialog');
    if (!zone || !dialog) return;
    if (zone.dataset.bound === '1') return;
    zone.dataset.bound = '1';

    const titleEl = $('#danger-dialog-title');
    const copyEl = $('#danger-dialog-copy');
    const emailEl = $('#danger-dialog-email');
    const inputEl = $('#danger-dialog-input');
    const confirmBtn = $('#danger-dialog-confirm');
    const cancelBtn = $('#danger-dialog-cancel');
    const closeBtn = $('#danger-dialog-close');
    const errorEl = $('#danger-dialog-error');
    const backdrop = $('#danger-dialog-backdrop');

    function setDialogError(message) {
      if (!errorEl) return;
      if (!message) {
        errorEl.classList.add('d-none');
        errorEl.textContent = '';
        return;
      }
      errorEl.classList.remove('d-none');
      errorEl.textContent = message;
    }

    function resetDialog() {
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = activeDangerAction?.confirmLabel || 'Delete';
      }
      if (cancelBtn) cancelBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
      if (inputEl) {
        inputEl.value = '';
        inputEl.disabled = false;
      }
      setDialogError('');
    }

    function updateConfirmState() {
      if (!confirmBtn) return;
      const expected = state.user?.email || '';
      const typed = (inputEl?.value || '').trim();
      const match = expected && typed === expected;
      confirmBtn.disabled = !activeDangerAction || dangerDialogBusy || !match;
    }

    function closeDialog(force = false) {
      if (dangerDialogBusy && !force) return;
      dialog.classList.remove('show');
      dialog.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      activeDangerAction = null;
      dangerDialogBusy = false;
      resetDialog();
    }

    function openDialog(actionId) {
      const action = dangerActions[actionId];
      if (!action || !state.user?.email) return;
      activeDangerAction = action;
      dangerDialogBusy = false;
      if (titleEl) titleEl.textContent = action.title;
      if (copyEl) copyEl.textContent = action.copy;
      if (emailEl) emailEl.textContent = state.user.email;
      resetDialog();
      updateConfirmState();
      dialog.classList.add('show');
      dialog.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      window.setTimeout(() => { inputEl?.focus(); }, 60);
    }

    async function handleConfirm(event) {
      event.preventDefault();
      if (!activeDangerAction || dangerDialogBusy) return;
      const expected = state.user?.email || '';
      const typed = (inputEl?.value || '').trim();
      if (!expected || typed !== expected) {
        setDialogError('Enter your email exactly to confirm.');
        updateConfirmState();
        return;
      }

      dangerDialogBusy = true;
      setDialogError('');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = activeDangerAction.confirmLabelPending || activeDangerAction.confirmLabel || 'Deleting…';
      }
      if (cancelBtn) cancelBtn.disabled = true;
      if (closeBtn) closeBtn.disabled = true;
      if (inputEl) inputEl.disabled = true;

      try {
        await performDangerAction(activeDangerAction, typed);
        closeDialog(true);
        showDangerStatus(activeDangerAction.successMessage, activeDangerAction.successVariant || 'success');
        if (activeDangerAction.requiresReload) {
          try {
            await refreshData();
            renderProfile();
            renderBilling();
            computeStats();
          } catch (err) {
            console.error('Failed to refresh profile after purge', err);
          }
        }
        if (activeDangerAction.triggersSignOut) {
          window.setTimeout(() => {
            if (window.Auth && typeof window.Auth.signOut === 'function') {
              window.Auth.signOut({ redirect: '/signup.html', reason: 'account-deleted' });
            } else {
              window.location.assign('/signup.html');
            }
          }, 1200);
        }
      } catch (err) {
        console.error('Danger zone action failed', err);
        const msg = err?.message || 'Unable to complete this action.';
        setDialogError(msg);
        if (confirmBtn) {
          confirmBtn.textContent = activeDangerAction?.confirmLabel || 'Delete';
        }
        if (inputEl) {
          inputEl.disabled = false;
          inputEl.focus();
          inputEl.select();
        }
        if (cancelBtn) cancelBtn.disabled = false;
        if (closeBtn) closeBtn.disabled = false;
        dangerDialogBusy = false;
        updateConfirmState();
      }
    }

    zone.addEventListener('click', (event) => {
      const target = event.target.closest('[data-danger-action]');
      if (!target) return;
      event.preventDefault();
      const actionId = target.getAttribute('data-danger-action');
      openDialog(actionId);
    });

    confirmBtn?.addEventListener('click', handleConfirm);
    cancelBtn?.addEventListener('click', (event) => { event.preventDefault(); closeDialog(); });
    closeBtn?.addEventListener('click', (event) => { event.preventDefault(); closeDialog(); });
    backdrop?.addEventListener('click', (event) => { event.preventDefault(); closeDialog(); });
    inputEl?.addEventListener('input', () => { setDialogError(''); updateConfirmState(); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dialog.classList.contains('show')) {
        event.preventDefault();
        closeDialog();
      }
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
      bindOnboardingRerun();
      initNotes();
      bindDangerZone();
    } catch (err) {
      console.error('Profile initialisation failed', err);
      showStatus(err.message || 'Unable to load your profile.', 'danger');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
