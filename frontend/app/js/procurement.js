(function () {
  const state = {
    vendors: [],
    selectedVendor: null,
  };

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatCurrency(value, currency = 'USD') {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
  }

  function renderStats(stats = {}) {
    document.querySelector('[data-stat="total"]').textContent = stats.total ?? 0;
    document.querySelector('[data-stat="active"]').textContent = stats.active ?? 0;
    document.querySelector('[data-stat="atRisk"]').textContent = stats.atRisk ?? 0;
    document.querySelector('[data-stat="renewalsNextQuarter"]').textContent = stats.renewalsNextQuarter ?? 0;
    document.querySelector('[data-stat="totalAnnualValue"]').textContent =
      stats.totalAnnualValue !== undefined ? formatCurrency(stats.totalAnnualValue) : '—';
  }

  function renderVendorList() {
    const list = document.getElementById('vendor-list');
    list.innerHTML = '';
    const stageFilter = document.getElementById('stage-filter').value;
    const vendors = state.vendors.filter((vendor) => !stageFilter || vendor.stage === stageFilter);
    if (!vendors.length) {
      list.innerHTML = '<p class="empty-indicator">No vendors yet. Create your first vendor.</p>';
      return;
    }
    vendors.forEach((vendor) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'vendor-pill';
      item.dataset.id = vendor.id;
      item.innerHTML = `
        <div>
          <strong>${vendor.name}</strong>
          <p class="vendor-meta">${vendor.category || 'Uncategorised'} · ${vendor.stage}</p>
        </div>
        <div class="vendor-pill-meta">
          <span class="chip chip-${vendor.riskLevel || 'low'}">${vendor.riskLevel || 'low'}</span>
          <span>${vendor.renewalDate ? formatDate(vendor.renewalDate) : 'No renewal date'}</span>
        </div>
      `;
      item.addEventListener('click', () => selectVendor(vendor.id));
      if (state.selectedVendor?.id === vendor.id) {
        item.classList.add('active');
      }
      list.appendChild(item);
    });
  }

  function renderObjectives(objectives = []) {
    const list = document.getElementById('objective-list');
    list.innerHTML = '';
    if (!objectives.length) {
      list.innerHTML = '<li class="empty-indicator">No objectives logged.</li>';
      return;
    }
    objectives.forEach((objective) => {
      const li = document.createElement('li');
      li.className = 'objective-item';
      li.innerHTML = `
        <div>
          <p class="objective-title">${objective.title}</p>
          <p class="objective-meta">${objective.metric || 'Metric not set'} · Target ${objective.targetValue || '—'}</p>
          <p class="objective-meta">Due ${formatDate(objective.dueDate)} · Owner ${objective.owner || 'Unassigned'}</p>
        </div>
        <div class="objective-status">
          <span class="chip chip-${objective.status}">${objective.status.replace('_', ' ')}</span>
          <p class="objective-progress">${Math.round(objective.progress ?? 0)}% progress</p>
        </div>
      `;
      list.appendChild(li);
    });
  }

  function renderUpdates(updates = []) {
    const list = document.getElementById('update-list');
    list.innerHTML = '';
    if (!updates.length) {
      list.innerHTML = '<li class="empty-indicator">No touchpoints recorded.</li>';
      return;
    }
    updates.slice(0, 5).forEach((update) => {
      const li = document.createElement('li');
      li.className = 'update-item';
      const actions = Array.isArray(update.actions) && update.actions.length
        ? `<p class="update-actions">Actions: ${update.actions.join(', ')}</p>`
        : '';
      li.innerHTML = `
        <div>
          <span class="chip chip-${update.category}">${update.category}</span>
          <p class="update-summary">${update.summary}</p>
          ${actions}
        </div>
        <div class="update-meta">
          <p>${formatDate(update.recordedAt)}</p>
          <p class="update-owner">${update.recordedBy || ''}</p>
        </div>
      `;
      list.appendChild(li);
    });
  }

  function renderVendorDetails(vendor) {
    const empty = document.getElementById('vendor-empty');
    const content = document.getElementById('vendor-content');
    if (!vendor) {
      empty.hidden = false;
      content.hidden = true;
      document.getElementById('vendor-name').textContent = 'Select a vendor';
      document.getElementById('vendor-subtitle').textContent = 'Create or select a vendor to see details.';
      return;
    }
    empty.hidden = true;
    content.hidden = false;
    document.getElementById('vendor-name').textContent = vendor.name;
    document.getElementById('vendor-subtitle').textContent = vendor.category || 'Vendor summary';

    const tags = document.getElementById('vendor-tags');
    tags.innerHTML = '';
    (vendor.tags || []).forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'chip chip-neutral';
      span.textContent = tag;
      tags.appendChild(span);
    });

    const fields = ['stage', 'owner', 'paymentTerms', 'relationshipHealth', 'nextReviewAt', 'lastTouchpointAt'];
    fields.forEach((field) => {
      const el = document.querySelector(`[data-field="${field}"]`);
      if (el) {
        el.textContent = field.includes('At') ? formatDate(vendor[field]) : vendor[field] || '—';
      }
    });
    const annualValueEl = document.querySelector('[data-field="annualValue"]');
    if (annualValueEl) annualValueEl.textContent = formatCurrency(vendor.annualValue, vendor.currency);
    const renewalEl = document.querySelector('[data-field="renewalDate"]');
    if (renewalEl) renewalEl.textContent = formatDate(vendor.renewalDate);
    const riskEl = document.querySelector('[data-field="riskLevel"]');
    if (riskEl) {
      riskEl.textContent = vendor.riskLevel || '—';
      riskEl.className = `summary-value chip chip-${vendor.riskLevel || 'low'}`;
    }

    document.getElementById('brief-box').textContent = vendor.relationshipBrief || 'No brief generated yet.';
    document.getElementById('risk-box').textContent = vendor.risks?.length
      ? vendor.risks.map((risk) => `${risk.statement} (${risk.status})`).join('\n')
      : 'No risks captured yet.';

    renderObjectives(vendor.objectives || []);
    renderUpdates(vendor.updates || []);
  }

  function selectVendor(id) {
    state.selectedVendor = state.vendors.find((v) => v.id === id) || null;
    renderVendorList();
    renderVendorDetails(state.selectedVendor);
  }

  async function refreshVendors() {
    const { vendors, stats } = await App.Api.getProcurementVendors();
    state.vendors = vendors;
    renderStats(stats);
    renderVendorList();
    if (state.selectedVendor) {
      selectVendor(state.selectedVendor.id);
    }
  }

  async function handleVendorForm(event) {
    event.preventDefault();
    const payload = {
      name: document.getElementById('vendor-name').value.trim(),
      category: document.getElementById('vendor-category').value.trim(),
      stage: document.getElementById('vendor-stage').value,
      owner: document.getElementById('vendor-owner').value.trim(),
      riskLevel: document.getElementById('vendor-risk').value,
      annualValue: Number(document.getElementById('vendor-value').value || 0),
      renewalDate: document.getElementById('vendor-renewal').value || null,
      paymentTerms: document.getElementById('vendor-payment').value.trim(),
    };
    await App.Api.createVendor(payload);
    document.getElementById('vendor-form').reset();
    document.getElementById('vendor-modal').close();
    await refreshVendors();
  }

  async function handleObjectiveSubmit(event) {
    event.preventDefault();
    if (!state.selectedVendor) return;
    const payload = {
      title: document.getElementById('objective-title').value.trim(),
      owner: document.getElementById('objective-owner').value.trim(),
      dueDate: document.getElementById('objective-due').value || null,
      metric: document.getElementById('objective-metric').value.trim(),
      targetValue: document.getElementById('objective-target').value.trim(),
      status: document.getElementById('objective-status').value,
      progress: Number(document.getElementById('objective-progress').value || 0),
      successCriteria: document.getElementById('objective-criteria').value.trim(),
    };
    await App.Api.createObjective(state.selectedVendor.id, payload);
    document.getElementById('objective-form').reset();
    await refreshVendors();
    selectVendor(state.selectedVendor.id);
  }

  async function handleUpdateSubmit(event) {
    event.preventDefault();
    if (!state.selectedVendor) return;
    const actionsRaw = document.getElementById('update-actions').value.trim();
    const payload = {
      summary: document.getElementById('update-summary').value.trim(),
      category: document.getElementById('update-category').value,
      recordedBy: document.getElementById('update-owner').value.trim(),
      actions: actionsRaw ? actionsRaw.split(',').map((item) => item.trim()).filter(Boolean) : [],
    };
    await App.Api.createTouchpoint(state.selectedVendor.id, payload);
    document.getElementById('update-form').reset();
    await refreshVendors();
    selectVendor(state.selectedVendor.id);
  }

  async function generateBrief() {
    if (!state.selectedVendor) return;
    const button = document.getElementById('generate-brief');
    button.disabled = true;
    button.textContent = 'Generating…';
    try {
      const { vendor, recommendations } = await App.Api.generateProcurementBrief(state.selectedVendor.id);
      state.selectedVendor = vendor;
      renderVendorDetails(vendor);
      if (recommendations?.quickWins?.length) {
        const briefBox = document.getElementById('brief-box');
        const list = document.createElement('ul');
        list.className = 'bullet-list';
        recommendations.quickWins.forEach((win) => {
          const li = document.createElement('li');
          li.textContent = win;
          list.appendChild(li);
        });
        briefBox.innerHTML = `<p>${vendor.relationshipBrief}</p>`;
        briefBox.appendChild(list);
      }
    } catch (error) {
      console.error('Failed to generate brief', error);
    } finally {
      button.disabled = false;
      button.textContent = 'Generate AI brief';
    }
  }

  function bindEvents() {
    document.getElementById('stage-filter').addEventListener('change', renderVendorList);
    document.getElementById('vendor-form').addEventListener('submit', handleVendorForm);
    document.getElementById('objective-form').addEventListener('submit', handleObjectiveSubmit);
    document.getElementById('update-form').addEventListener('submit', handleUpdateSubmit);
    document.getElementById('open-vendor-form').addEventListener('click', () => {
      document.getElementById('vendor-modal').showModal();
    });
    document.getElementById('cancel-vendor').addEventListener('click', (event) => {
      event.preventDefault();
      document.getElementById('vendor-modal').close();
    });
    document.getElementById('generate-brief').addEventListener('click', generateBrief);
  }

  function setFeatureVisibility(profile) {
    const features = profile?.featureLicenses || {};
    document.querySelectorAll('[data-feature]').forEach((el) => {
      const key = el.dataset.feature;
      el.hidden = !features[key];
    });
  }

  async function init() {
    const me = await App.bootstrap('procurement');
    if (!me?.profile?.featureLicenses?.procurement) {
      document.body.innerHTML = '<main class="unauthorized"><h2>Procurement is not enabled for your account.</h2></main>';
      return;
    }
    setFeatureVisibility(me.profile);
    bindEvents();
    await refreshVendors();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
