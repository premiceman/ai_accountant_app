// frontend/js/compensation.js
(function () {
  const state = {
    me: null,
    nav: {
      package: {
        base: 0,
        bonus: 0,
        commission: 0,
        equity: 0,
        benefits: 0,
        other: 0,
        notes: ''
      },
      targetSalary: null,
      nextReviewAt: null,
      role: '',
      company: '',
      location: '',
      tenure: null,
      achievements: [],
      promotionCriteria: [],
      benchmarks: [],
      marketBenchmark: {},
      contractFile: null,
      taxSummary: null
    },
    collections: [],
    currentCollection: null,
    saving: false
  };

  const modals = {};
  const fieldSavers = {
    targetSalary: createFieldSaver('targetSalary', (value) => {
      if (value === null || value === undefined || value === '') return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    }),
    role: createFieldSaver('role', (value) => (value || '').toString().trim()),
    company: createFieldSaver('company', (value) => (value || '').toString().trim()),
    location: createFieldSaver('location', (value) => (value || '').toString().trim()),
    tenure: createFieldSaver('tenure', (value) => {
      if (value === null || value === undefined || value === '') return null;
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0) return null;
      return Math.round(num * 10) / 10;
    })
  };

  init().catch((err) => {
    console.error('Compensation navigator failed to initialise', err);
    softError('Unable to load compensation data. Please refresh the page.');
  });

  async function init() {
    Auth.setBannerTitle('Compensation navigator');
    const { me } = await Auth.requireAuth();
    state.me = me;
    await refreshUser();
    cacheModals();
    wireEvents();
    renderAll();
  }

  async function refreshUser() {
    const res = await Auth.fetch('/api/user/me', { cache: 'no-store' });
    if (res.ok) {
      const payload = await res.json();
      state.me = payload;
      state.nav = normaliseNavigator(payload.salaryNavigator || {});
    }
  }

  function cacheModals() {
    if (window.bootstrap?.Modal) {
      modals.achievement = new bootstrap.Modal(document.getElementById('modal-achievement'));
      modals.criterion = new bootstrap.Modal(document.getElementById('modal-criterion'));
      modals.contract = new bootstrap.Modal(document.getElementById('modal-select-contract'));
    }
  }

  function wireEvents() {
    const targetInput = byId('comp-target-input');
    targetInput?.addEventListener('input', (ev) => {
      const raw = ev.target.value;
      const value = raw === '' ? null : Number(raw);
      const display = value !== null && Number.isFinite(value) ? money(value) : '£—';
      setText('comp-target-salary', display);
      if (value === null || !Number.isFinite(value)) {
        updateProgress(0, currentPackageTotal());
        state.nav.targetSalary = null;
      } else {
        updateProgress(value, currentPackageTotal());
        state.nav.targetSalary = value;
      }
      fieldSavers.targetSalary(value);
    });

    document.querySelectorAll('[data-target-preset]')?.forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.targetPreset;
        const baseline = currentPackageTotal() || Number(state.nav.targetSalary) || 55000;
        let target = baseline;
        if (action === 'plus5') target = Math.round(baseline * 1.05 / 1000) * 1000;
        if (action === 'plus10') target = Math.round(baseline * 1.1 / 1000) * 1000;
        if (action === 'current') target = Math.round(currentPackageTotal() || baseline);
        const clamped = Math.max(0, target);
        if (targetInput) targetInput.value = clamped;
        state.nav.targetSalary = clamped;
        setText('comp-target-salary', money(clamped));
        updateProgress(clamped, currentPackageTotal());
        fieldSavers.targetSalary(clamped);
      });
    });

    byId('comp-role')?.addEventListener('input', (ev) => {
      const value = ev.target.value;
      state.nav.role = value;
      fieldSavers.role(value);
    });

    byId('comp-company')?.addEventListener('input', (ev) => {
      const value = ev.target.value;
      state.nav.company = value;
      fieldSavers.company(value);
    });

    byId('comp-location')?.addEventListener('input', (ev) => {
      const value = ev.target.value;
      state.nav.location = value;
      fieldSavers.location(value);
    });

    byId('comp-tenure')?.addEventListener('input', (ev) => {
      const raw = ev.target.value;
      const value = raw === '' ? null : Number(raw);
      if (value === null || Number.isFinite(value)) {
        state.nav.tenure = value;
        fieldSavers.tenure(value);
      }
    });

    byId('comp-next-review')?.addEventListener('change', async (ev) => {
      await persist({ nextReviewAt: ev.target.value || null });
    });

    byId('comp-sync-review')?.addEventListener('click', async () => {
      const input = byId('comp-next-review');
      await persist({ nextReviewAt: input?.value || null });
      toast('Review date saved');
    });

    const form = byId('comp-package-form');
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pkg = readPackageForm();
      await persist({ package: pkg });
      renderTaxSummary(pkg);
      toast('Package saved');
    });

    byId('comp-recalc-tax')?.addEventListener('click', () => {
      renderTaxSummary(readPackageForm());
    });

    byId('comp-add-achievement')?.addEventListener('click', () => {
      formAchievement().reset();
      modals.achievement?.show();
    });

    formAchievement()?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const payload = readAchievementForm();
      const achievements = [...state.nav.achievements, payload];
      await persist({ achievements });
      modals.achievement?.hide();
      toast('Achievement saved');
    });

    const achTable = document.querySelector('#comp-achievements-table tbody');
    achTable?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (Number.isNaN(idx)) return;
      if (btn.dataset.action === 'delete') {
        if (!confirm('Remove this achievement?')) return;
        const next = state.nav.achievements.filter((_, i) => i !== idx);
        await persist({ achievements: next });
        toast('Achievement removed');
      }
      if (btn.dataset.action === 'complete') {
        const next = state.nav.achievements.map((ach, i) => i === idx ? { ...ach, status: 'complete', completedAt: new Date().toISOString() } : ach);
        await persist({ achievements: next });
        toast('Achievement marked complete');
      }
    });

    byId('comp-add-criterion')?.addEventListener('click', () => {
      formCriterion().reset();
      modals.criterion?.show();
    });

    formCriterion()?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const criterion = readCriterionForm();
      const next = [...state.nav.promotionCriteria, criterion];
      await persist({ promotionCriteria: next });
      modals.criterion?.hide();
      toast('Criterion added');
    });

    byId('comp-criteria-list')?.addEventListener('change', async (ev) => {
      const input = ev.target.closest('input[data-index]');
      if (!input) return;
      const idx = Number(input.dataset.index);
      const next = state.nav.promotionCriteria.map((crit, i) => i === idx ? { ...crit, completed: input.checked, completedAt: input.checked ? new Date().toISOString() : null } : crit);
      await persist({ promotionCriteria: next });
    });

    byId('comp-criteria-list')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (btn.dataset.action === 'delete') {
        if (!confirm('Remove this criterion?')) return;
        const next = state.nav.promotionCriteria.filter((_, i) => i !== idx);
        await persist({ promotionCriteria: next });
        toast('Criterion removed');
      }
    });

    byId('comp-run-benchmark')?.addEventListener('click', async () => {
      await runBenchmarks();
    });

    byId('comp-export-pdf')?.addEventListener('click', () => {
      window.open('/api/user/salary-navigator/export', '_blank', 'noopener');
    });

    byId('comp-upload-contract')?.addEventListener('click', async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf';
      input.addEventListener('change', async () => {
        if (!input.files?.length) return;
        const file = input.files[0];
        try {
          const uploaded = await uploadContractFile(file);
          await persist({ contractFile: uploaded });
          toast('Contract uploaded');
        } catch (err) {
          console.error('Contract upload failed', err);
          softError('Unable to upload contract. Please try again.');
        }
      });
      input.click();
    });

    byId('comp-select-contract')?.addEventListener('click', async () => {
      await ensureCollections();
      populateCollections();
      await loadCollectionFiles();
      modals.contract?.show();
    });

    byId('contract-collection')?.addEventListener('change', async () => {
      await loadCollectionFiles();
    });

    document.querySelector('#contract-table tbody')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-file]');
      if (!btn) return;
      const id = btn.dataset.file;
      const name = btn.dataset.name;
      const view = btn.dataset.view;
      const download = btn.dataset.download;
      await persist({ contractFile: { id, name, viewUrl: view, downloadUrl: download, linkedAt: new Date().toISOString(), collectionId: state.currentCollection } });
      modals.contract?.hide();
      toast('Contract linked');
    });

    byId('comp-contract-remove')?.addEventListener('click', async () => {
      if (!confirm('Unlink the current contract?')) return;
      await persist({ contractFile: null });
      toast('Contract unlinked');
    });
  }

  function renderAll() {
    renderPackage();
    renderProgress();
    renderFairnessBanner();
    renderAchievements();
    renderCriteria();
    renderBenchmarks();
    renderContract();
    renderTaxSummary(state.nav.package);
  }

  function renderPackage() {
    const pkg = state.nav.package || {};
    setValue('comp-base', pkg.base);
    setValue('comp-bonus', pkg.bonus);
    setValue('comp-commission', pkg.commission);
    setValue('comp-equity', pkg.equity);
    setValue('comp-benefits', pkg.benefits);
    setValue('comp-other', pkg.other);
    setValue('comp-notes', pkg.notes || '');
    setValue('comp-role', state.nav.role || '');
    setValue('comp-company', state.nav.company || '');
    setValue('comp-location', state.nav.location || '');
    setValue('comp-tenure', state.nav.tenure ?? '');
    setText('comp-current-salary', money(currentPackageTotal()));
    setText('comp-current-breakdown', packageBreakdownLabel(pkg));
    const targetInput = byId('comp-target-input');
    const targetValue = state.nav.targetSalary != null && Number.isFinite(Number(state.nav.targetSalary))
      ? Number(state.nav.targetSalary)
      : null;
    if (targetInput) targetInput.value = targetValue != null ? targetValue : '';
    setText('comp-target-salary', targetValue != null ? money(targetValue) : '£—');
    const nextReview = state.nav.nextReviewAt ? new Date(state.nav.nextReviewAt) : null;
    if (nextReview) {
      byId('comp-next-review').value = nextReview.toISOString().slice(0, 10);
      setText('comp-next-review-label', nextReview.toLocaleDateString());
    } else {
      setText('comp-next-review-label', 'Not scheduled');
      if (byId('comp-next-review')) byId('comp-next-review').value = '';
    }
  }

  function renderProgress() {
    const total = currentPackageTotal();
    const targetField = byId('comp-target-input');
    const target = state.nav.targetSalary != null && Number.isFinite(Number(state.nav.targetSalary))
      ? Number(state.nav.targetSalary)
      : Number(targetField?.value || 0);
    updateProgress(target, total);
  }

  function renderAchievements() {
    const tbody = document.querySelector('#comp-achievements-table tbody');
    const empty = byId('comp-achievements-empty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const list = Array.isArray(state.nav.achievements) ? state.nav.achievements : [];
    if (!list.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    list.forEach((ach, idx) => {
      const tr = document.createElement('tr');
      const status = statusBadge(ach.status);
      const target = ach.targetDate ? new Date(ach.targetDate).toLocaleDateString() : '—';
      const actions = [];
      if (ach.status !== 'complete') {
        actions.push(`<button class="btn btn-sm btn-outline-success" data-action="complete" data-index="${idx}">Mark complete</button>`);
      }
      actions.push(`<button class="btn btn-sm btn-outline-danger" data-action="delete" data-index="${idx}">Delete</button>`);
      const evidence = ach.evidenceUrl ? `<a href="${escapeHtml(ach.evidenceUrl)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary">View</a>` : '<span class="text-muted">—</span>';
      tr.innerHTML = `
        <td>
          <div class="fw-semibold">${escapeHtml(ach.title)}</div>
          <div class="small text-muted">${escapeHtml(ach.detail || '')}</div>
        </td>
        <td class="text-nowrap">${target}</td>
        <td>${status}</td>
        <td class="text-end d-flex flex-wrap gap-2 justify-content-end">${evidence}${actions.length ? `<div class="btn-group">${actions.join('')}</div>` : ''}</td>`;
      tbody.appendChild(tr);
    });
  }

  function renderCriteria() {
    const listEl = byId('comp-criteria-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const list = Array.isArray(state.nav.promotionCriteria) ? state.nav.promotionCriteria : [];
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'list-group-item text-muted';
      li.textContent = 'No promotion criteria captured yet. Import from your capability framework to stay on track.';
      listEl.appendChild(li);
      return;
    }
    list.forEach((crit, idx) => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-start gap-3 flex-wrap';
      li.innerHTML = `
        <div class="form-check">
          <input class="form-check-input" type="checkbox" data-index="${idx}" id="crit-${idx}" ${crit.completed ? 'checked' : ''}>
          <label class="form-check-label" for="crit-${idx}">
            <div class="fw-semibold">${escapeHtml(crit.title)}</div>
            <div class="small text-muted">${escapeHtml(crit.detail || '')}</div>
          </label>
        </div>
        <div class="d-flex align-items-center gap-2">
          ${crit.completed && crit.completedAt ? `<span class="badge text-bg-success">Completed ${new Date(crit.completedAt).toLocaleDateString()}</span>` : ''}
          <button class="btn btn-sm btn-outline-danger" data-action="delete" data-index="${idx}"><i class="bi bi-trash"></i></button>
        </div>`;
      listEl.appendChild(li);
    });
  }

  function renderBenchmarks() {
    const wrap = byId('comp-benchmark-results');
    if (!wrap) return;
    wrap.innerHTML = '';
    const results = Array.isArray(state.nav.benchmarks) ? state.nav.benchmarks : [];
    if (!results.length) {
      setText('comp-benchmark-status', 'No benchmarks run');
      return;
    }
    setText('comp-benchmark-status', `Last benchmark ${new Date(results[0].generatedAt || Date.now()).toLocaleString()}`);
    results.forEach((row) => {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-xl-4';
      const roleLabel = row.role || state.nav.role || state.me?.jobTitle || state.me?.roles?.[0] || 'Role';
      const locationLabel = row.location || state.nav.location || state.me?.country?.toUpperCase() || 'UK';
      col.innerHTML = `
        <div class="card h-100 border-0 shadow-sm">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div>
                <div class="fw-semibold">${escapeHtml(row.source || 'Benchmark')}</div>
                <div class="small text-muted">${escapeHtml(roleLabel)}</div>
              </div>
              <span class="badge text-bg-light">${escapeHtml(locationLabel)}</span>
            </div>
            <div class="display-6">${money(row.medianSalary || 0)}</div>
            <div class="small text-muted mb-3">${escapeHtml(row.summary || '')}</div>
            <ul class="list-unstyled small mb-0">
              <li><strong>P25:</strong> ${money(row.percentiles?.p25 || 0)}</li>
              <li><strong>P50:</strong> ${money(row.percentiles?.p50 || row.medianSalary || 0)}</li>
              <li><strong>P75:</strong> ${money(row.percentiles?.p75 || 0)}</li>
            </ul>
          </div>
        </div>`;
      wrap.appendChild(col);
    });
  }

  function renderFairnessBanner() {
    const banner = byId('comp-fairness-banner');
    if (!banner) return;
    const headline = byId('comp-fairness-headline');
    const detail = byId('comp-fairness-detail');
    const statusEl = byId('comp-fairness-status');
    const timeline = byId('comp-fairness-timeline');
    const data = state.nav.marketBenchmark || {};
    const status = data.status || 'unknown';
    banner.classList.remove('alert-warning', 'alert-success', 'alert-primary', 'alert-info', 'alert-secondary', 'alert-danger');
    if (!data || status === 'unknown') {
      banner.classList.add('d-none');
      banner.classList.remove('d-flex');
      if (headline) headline.textContent = '—';
      if (detail) detail.textContent = 'Connect benchmarks to see how your pay stacks up.';
      if (statusEl) statusEl.textContent = 'Status —';
      if (timeline) timeline.textContent = 'Promotion timeline pending';
      return;
    }
    banner.classList.remove('d-none');
    banner.classList.add('d-flex');
    let tone = 'alert-info';
    if (status === 'underpaid') tone = 'alert-warning';
    if (status === 'overpaid') tone = 'alert-primary';
    if (status === 'fair') tone = 'alert-success';
    banner.classList.add(tone);
    const ratioPct = Number.isFinite(data.ratio) ? Math.round(data.ratio * 100) : null;
    if (headline) headline.textContent = data.summary || 'Market benchmark ready.';
    if (detail) {
      const details = [];
      if (data.marketMedian) details.push(`Blended median ${money(data.marketMedian)}.`);
      if (status === 'underpaid' && data.recommendedRaise) details.push(`Aim for ${money(data.recommendedRaise)} uplift.`);
      if (status === 'overpaid' && data.recommendedSalary) details.push(`Protect scope to sustain ${money(data.recommendedSalary)}.`);
      if (!details.length && data.annualisedIncome) details.push(`Annualised income ${money(data.annualisedIncome)}.`);
      detail.textContent = details.join(' ') || 'Benchmark sources blended for your role and tenure.';
    }
    if (statusEl) {
      const ratioLabel = ratioPct ? ` (${ratioPct}% of market)` : '';
      statusEl.textContent = `Status ${statusLabel(status)}${ratioLabel}`;
    }
    if (timeline) {
      const tl = data.promotionTimeline || {};
      if (tl.monthsToPromotion || tl.targetTitle || tl.windowStart || tl.windowEnd) {
        const start = tl.windowStart ? new Date(tl.windowStart).toLocaleDateString() : null;
        const end = tl.windowEnd ? new Date(tl.windowEnd).toLocaleDateString() : null;
        const segments = [
          tl.targetTitle || null,
          tl.monthsToPromotion ? `~${tl.monthsToPromotion} months` : null,
          start && end ? `${start} → ${end}` : (start || end),
          tl.confidence ? `${tl.confidence} confidence` : null
        ].filter(Boolean);
        timeline.textContent = segments.length ? segments.join(' • ') : 'Promotion guidance ready';
      } else {
        timeline.textContent = 'Promotion timeline pending';
      }
    }
  }

  function renderContract() {
    const card = byId('comp-contract-card');
    const empty = byId('comp-contract-empty');
    const file = state.nav.contractFile;
    if (file && file.name) {
      card?.classList.remove('d-none');
      empty?.classList.add('d-none');
      setText('comp-contract-name', file.name);
      setText('comp-contract-meta', file.linkedAt ? `Linked ${new Date(file.linkedAt).toLocaleDateString()}` : 'Linked');
      const view = byId('comp-contract-view');
      if (view) {
        view.href = file.viewUrl || '#';
        view.textContent = 'View';
      }
    } else {
      card?.classList.add('d-none');
      empty?.classList.remove('d-none');
    }
  }

  function renderTaxSummary(pkg) {
    const el = byId('comp-tax-summary');
    if (!el) return;
    const total = packageTotal(pkg);
    if (!total) {
      el.classList.add('d-none');
      return;
    }
    const { takeHome, effectiveRate, notes } = estimateUkTax(pkg);
    el.innerHTML = `
      <div class="fw-semibold">Estimated take-home £${takeHome.toLocaleString()} (${Math.round((1 - effectiveRate) * 100)}% of gross)</div>
      <div class="small text-muted">${escapeHtml(notes)}</div>`;
    el.classList.remove('d-none');
  }

  async function persist(patch, options = {}) {
    state.nav = { ...state.nav, ...patch };
    const body = JSON.stringify(patch);
    const res = await Auth.fetch('/api/user/salary-navigator', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (!res.ok) {
      throw new Error(`Persist failed ${res.status}`);
    }
    const payload = await res.json();
    state.nav = normaliseNavigator(payload.salaryNavigator || state.nav);
    if (!options.silent) renderAll();
  }

  async function runBenchmarks() {
    const btn = byId('comp-run-benchmark');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Refreshing';
    try {
      const res = await Auth.fetch('/api/user/salary-navigator/benchmark', { method: 'POST' });
      if (!res.ok) throw new Error(`Benchmark ${res.status}`);
      const data = await res.json();
      state.nav.benchmarks = data.benchmarks || [];
      if (data.marketBenchmark) state.nav.marketBenchmark = data.marketBenchmark;
      await refreshUser();
      renderAll();
      toast('Benchmarks updated');
    } catch (err) {
      console.error('Benchmark failed', err);
      softError('Unable to refresh benchmarks right now. Try again later.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-graph-up"></i> Refresh benchmarks';
    }
  }

  async function ensureCollections() {
    if (state.collections.length) return;
    const res = await Auth.fetch('/api/vault/collections', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      state.collections = json.collections || [];
      const existing = state.collections.find((c) => c.name.toLowerCase() === 'compensation navigator');
      if (!existing) {
        const created = await createCollection('Compensation Navigator');
        state.collections.push(created);
      }
    }
  }

  async function createCollection(name) {
    const res = await Auth.fetch('/api/vault/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('Create collection failed');
    const json = await res.json();
    return json.collection;
  }

  function populateCollections() {
    const select = byId('contract-collection');
    if (!select) return;
    select.innerHTML = '';
    state.collections.forEach((col, idx) => {
      const opt = document.createElement('option');
      opt.value = col.id;
      opt.textContent = col.name;
      if (!state.currentCollection && idx === 0) state.currentCollection = col.id;
      if (state.nav.contractFile?.collectionId === col.id) state.currentCollection = col.id;
      if (state.currentCollection === col.id) opt.selected = true;
      select.appendChild(opt);
    });
    if (!state.currentCollection && state.collections.length) {
      state.currentCollection = state.collections[0].id;
    }
  }

  async function loadCollectionFiles() {
    const select = byId('contract-collection');
    const id = select?.value || state.currentCollection;
    if (!id) return;
    state.currentCollection = id;
    const res = await Auth.fetch(`/api/vault/collections/${id}/files`, { cache: 'no-store' });
    const tbody = document.querySelector('#contract-table tbody');
    const empty = byId('contract-empty');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!res.ok) {
      empty?.classList.remove('d-none');
      return;
    }
    const files = await res.json();
    if (!Array.isArray(files) || !files.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    files.forEach((file) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="fw-semibold">${escapeHtml(file.name)}</div>
          <div class="small text-muted">${(file.size / (1024 * 1024)).toFixed(2)} MB</div>
        </td>
        <td>${file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : '—'}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary" data-file="${file.id}" data-name="${escapeHtml(file.name)}" data-view="${file.viewUrl}" data-download="${file.downloadUrl}">Link</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  async function uploadContractFile(file) {
    await ensureCollections();
    populateCollections();
    const collectionId = state.currentCollection || state.collections[0]?.id;
    if (!collectionId) throw new Error('No vault collection available');
    const form = new FormData();
    form.append('files', file, file.name);
    const res = await Auth.fetch(`/api/vault/collections/${collectionId}/files`, {
      method: 'POST',
      body: form
    });
    if (!res.ok) throw new Error('Upload failed');
    const json = await res.json();
    const uploaded = json.uploaded?.[0];
    if (!uploaded) throw new Error('No file uploaded');
    return { id: uploaded.id, name: uploaded.name, viewUrl: uploaded.viewUrl, downloadUrl: uploaded.downloadUrl, collectionId };
  }

  // ----- helpers -----
  function readPackageForm() {
    return {
      base: numberFrom('comp-base'),
      bonus: numberFrom('comp-bonus'),
      commission: numberFrom('comp-commission'),
      equity: numberFrom('comp-equity'),
      benefits: numberFrom('comp-benefits'),
      other: numberFrom('comp-other'),
      notes: byId('comp-notes')?.value || ''
    };
  }

  function readAchievementForm() {
    return {
      title: formAchievement().querySelector('#ach-title').value.trim(),
      detail: formAchievement().querySelector('#ach-detail').value.trim(),
      targetDate: formAchievement().querySelector('#ach-date').value || null,
      status: formAchievement().querySelector('#ach-status').value || 'planned',
      evidenceUrl: formAchievement().querySelector('#ach-evidence-url').value || '',
      createdAt: new Date().toISOString()
    };
  }

  function readCriterionForm() {
    return {
      title: formCriterion().querySelector('#crit-title').value.trim(),
      detail: formCriterion().querySelector('#crit-detail').value.trim(),
      createdAt: new Date().toISOString(),
      completed: false
    };
  }

  function formAchievement() { return document.getElementById('form-achievement'); }
  function formCriterion() { return document.getElementById('form-criterion'); }

  function normaliseNavigator(nav) {
    const base = {
      package: {
        base: 0,
        bonus: 0,
        commission: 0,
        equity: 0,
        benefits: 0,
        other: 0,
        notes: ''
      },
      targetSalary: null,
      nextReviewAt: null,
      role: '',
      company: '',
      location: '',
      tenure: null,
      achievements: [],
      promotionCriteria: [],
      benchmarks: [],
      marketBenchmark: {},
      contractFile: null,
      taxSummary: null
    };
    const merged = { ...base, ...nav };
    merged.package = { ...base.package, ...(nav.package || {}) };
    merged.targetSalary = nav.targetSalary != null && Number.isFinite(Number(nav.targetSalary)) ? Number(nav.targetSalary) : null;
    merged.role = typeof nav.role === 'string' ? nav.role : '';
    merged.company = typeof nav.company === 'string' ? nav.company : '';
    merged.location = typeof nav.location === 'string' ? nav.location : '';
    if (nav.tenure === '' || nav.tenure === null || nav.tenure === undefined) {
      merged.tenure = null;
    } else {
      const tenureVal = Number(nav.tenure);
      merged.tenure = Number.isFinite(tenureVal) ? tenureVal : null;
    }
    merged.achievements = Array.isArray(nav.achievements) ? nav.achievements : [];
    merged.promotionCriteria = Array.isArray(nav.promotionCriteria) ? nav.promotionCriteria : [];
    merged.benchmarks = Array.isArray(nav.benchmarks) ? nav.benchmarks : [];
    merged.marketBenchmark = nav.marketBenchmark && typeof nav.marketBenchmark === 'object' ? nav.marketBenchmark : {};
    return merged;
  }

  function currentPackageTotal() { return packageTotal(state.nav.package); }

  function packageTotal(pkg = {}) {
    return ['base', 'bonus', 'commission', 'equity', 'benefits', 'other'].reduce((sum, key) => sum + Number(pkg[key] || 0), 0);
  }

  function packageBreakdownLabel(pkg = {}) {
    const parts = [];
    if (pkg.base) parts.push(`Base £${Number(pkg.base).toLocaleString()}`);
    if (pkg.bonus) parts.push(`Bonus £${Number(pkg.bonus).toLocaleString()}`);
    if (pkg.commission) parts.push(`Commission £${Number(pkg.commission).toLocaleString()}`);
    if (pkg.equity) parts.push(`Equity £${Number(pkg.equity).toLocaleString()}`);
    if (pkg.benefits) parts.push(`Benefits £${Number(pkg.benefits).toLocaleString()}`);
    if (pkg.other) parts.push(`Other £${Number(pkg.other).toLocaleString()}`);
    return parts.length ? parts.join(' • ') : 'Set your package to begin.';
  }

  function updateProgress(target, total) {
    const pct = target > 0 ? Math.min(100, Math.round((total / target) * 100)) : 0;
    const bar = byId('comp-progress-bar');
    const label = byId('comp-progress-label');
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.textContent = `${pct}%`;
    }
    if (label) label.textContent = `${pct}%`;
  }

  function estimateUkTax(pkg) {
    const gross = packageTotal(pkg);
    const baseSalary = Number(pkg.base || 0);
    const allowances = 12570;
    const taxable = Math.max(0, gross - allowances);
    const higherThreshold = 50270;
    const addlThreshold = 125140;
    let tax = 0;
    if (taxable > 0) {
      const basic = Math.min(taxable, higherThreshold - allowances);
      tax += basic * 0.2;
      if (taxable > higherThreshold - allowances) {
        const higher = Math.min(taxable - (higherThreshold - allowances), addlThreshold - higherThreshold);
        tax += higher * 0.4;
      }
      if (taxable > addlThreshold - allowances) {
        tax += (taxable - (addlThreshold - allowances)) * 0.45;
      }
    }
    const ni = baseSalary > 12568 ? ((baseSalary - 12568) * 0.12) : 0;
    const takeHome = Math.max(0, gross - tax - ni);
    const effectiveRate = gross ? (tax + ni) / gross : 0;
    return {
      takeHome,
      effectiveRate,
      notes: `Illustrative UK PAYE based on ${new Date().getFullYear()}/${String((new Date().getFullYear() + 1) % 100).padStart(2, '0')} thresholds. Adjust for student loans and benefits in kind.`
    };
  }

  function statusBadge(status) {
    switch (status) {
      case 'complete': return '<span class="badge text-bg-success">Complete</span>';
      case 'in_progress': return '<span class="badge text-bg-info text-dark">In progress</span>';
      default: return '<span class="badge text-bg-secondary">Planned</span>';
    }
  }

  function statusLabel(status) {
    switch (status) {
      case 'underpaid': return 'Under-paid';
      case 'overpaid': return 'Over-paid';
      case 'fair': return 'Fair';
      default: return 'Unknown';
    }
  }

  function numberFrom(id) { return Number(byId(id)?.value || 0); }
  function setValue(id, value) { const el = byId(id); if (el) el.value = value ?? ''; }
  function setText(id, value) { const el = byId(id); if (el) el.textContent = value ?? '—'; }
  function byId(id) { return document.getElementById(id); }

  function money(value) {
    const num = Number(value || 0);
    const prefix = num < 0 ? '-£' : '£';
    return `${prefix}${Math.abs(num).toLocaleString()}`;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function softError(message) {
    const container = document.querySelector('main');
    if (!container) return alert(message);
    const alertEl = document.createElement('div');
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = message;
    container.prepend(alertEl);
    setTimeout(() => alertEl.remove(), 6000);
  }

  function toast(message) {
    const container = document.querySelector('main');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'alert alert-success position-fixed top-0 end-0 m-3 shadow';
    el.style.zIndex = 2050;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function createFieldSaver(key, transform = (value) => value) {
    return debounce((value) => {
      const payload = {};
      payload[key] = transform(value);
      persist(payload).catch((err) => console.error(`Failed to save ${key}`, err));
    }, 600);
  }

  function debounce(fn, delay = 300) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  }
})();
