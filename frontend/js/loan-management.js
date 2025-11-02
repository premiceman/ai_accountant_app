// frontend/js/loan-management.js
(function () {
  const state = {
    documents: [],
    selected: null,
    affordability: null,
    lastPayment: null
  };

  const stageBox = document.getElementById('loan-stage');
  const stageLabel = document.getElementById('loan-stage-label');
  const stageDetail = document.getElementById('loan-stage-detail');

  const docLoader = document.getElementById('loan-doc-loader');
  const docError = document.getElementById('loan-doc-error');
  const docList = document.getElementById('loan-doc-list');
  const docEmpty = document.getElementById('loan-doc-empty');
  const docSelected = document.getElementById('loan-selected');
  const docSelectedMeta = document.getElementById('loan-selected-meta');

  const amountInput = document.getElementById('loan-amount');
  const rateInput = document.getElementById('loan-rate');
  const termInput = document.getElementById('loan-term');
  const termUnitInput = document.getElementById('loan-term-unit');
  const feesInput = document.getElementById('loan-fees');

  const monthlyEl = document.getElementById('loan-monthly');
  const totalEl = document.getElementById('loan-total');
  const interestEl = document.getElementById('loan-interest');
  const effectiveEl = document.getElementById('loan-effective');

  const affordabilityFlag = document.getElementById('loan-affordability-flag');
  const affordabilityWrap = document.getElementById('loan-affordability');
  const affordabilitySummary = document.getElementById('loan-affordability-summary');
  const affordabilityTable = document.getElementById('loan-cashflow-table');
  const affordabilityFootnote = document.getElementById('loan-affordability-footnote');
  const affordabilityLoader = document.getElementById('loan-affordability-loading');
  const affordabilityError = document.getElementById('loan-affordability-error');

  init().catch((err) => {
    console.error('[loan-management] init failed', err);
    showStage('Unable to initialise', 'Refresh the page once you are back online.');
    if (docError) {
      docError.textContent = err?.message || 'Unable to load loan workspace.';
      docError.classList.remove('d-none');
    }
  });

  async function init() {
    showStage('Authenticating…', 'Securing your workspace.');
    await Auth.requireAuth();

    seedDefaults();

    showStage('Loading affordability profile…', 'Retrieving your latest cashflow analytics.');
    await loadAffordability();

    showStage('Collecting documents…', 'Scanning custom collections for loan contracts.');
    await loadDocuments();

    hideStage();
    bindEvents();
    renderDocuments();
    updateCalculations();
  }

  function bindEvents() {
    const form = document.getElementById('loan-form');
    if (form) {
      form.addEventListener('input', updateCalculations);
      form.addEventListener('change', updateCalculations);
    }

    if (docList) {
      docList.addEventListener('click', (ev) => {
        const openLink = ev.target.closest('a[data-action="open"]');
        if (openLink) return; // allow default navigation
        const item = ev.target.closest('.loan-doc-item');
        if (!item) return;
        const id = item.getAttribute('data-id');
        const doc = state.documents.find((entry) => entry.id === id);
        if (doc) {
          state.selected = doc;
          renderDocuments();
          renderSelected();
          updateCalculations();
        }
      });
    }
  }

  function seedDefaults() {
    if (amountInput && !amountInput.value) amountInput.value = '25000';
    if (rateInput && !rateInput.value) rateInput.value = '5.5';
    if (termInput && !termInput.value) termInput.value = '60';
    if (feesInput && !feesInput.value) feesInput.value = '0';
  }

  async function loadAffordability() {
    showLoader(affordabilityLoader, 'Analysing cashflow signals…');
    affordabilityError?.classList.add('d-none');
    try {
      const res = await Auth.fetch('/api/v2/me', { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Unable to load affordability profile');
      }
      const payload = await res.json();
      const me = payload?.me || payload || null;
      state.affordability = me?.wealthPlan?.summary?.affordability || null;
      renderAffordability();
    } catch (err) {
      console.error('[loan-management] loadAffordability failed', err);
      if (affordabilityError) {
        affordabilityError.textContent = err?.message || 'Unable to load affordability analytics. Try refreshing later.';
        affordabilityError.classList.remove('d-none');
      }
    } finally {
      hideLoader(affordabilityLoader);
    }
  }

  async function loadDocuments() {
    showLoader(docLoader, 'Fetching your custom collections…');
    docError?.classList.add('d-none');
    try {
      const res = await Auth.fetch('/api/vault/collections', { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Unable to load vault collections');
      }
      const json = await res.json();
      const raw = Array.isArray(json) ? json : (json?.collections || []);
      const customCollections = raw.filter((col) => !col?.category && !col?.system);

      const allDocs = [];
      for (const collection of customCollections) {
        showLoader(docLoader, `Loading ${collection?.name || 'collection'}…`);
        const filesRes = await Auth.fetch(`/api/vault/collections/${encodeURIComponent(collection.id)}/files`, { cache: 'no-store' });
        if (!filesRes.ok) {
          console.warn('[loan-management] failed to load files for collection', collection.id);
          continue;
        }
        const filesPayload = await filesRes.json().catch(() => []);
        const files = Array.isArray(filesPayload)
          ? filesPayload
          : Array.isArray(filesPayload?.files)
            ? filesPayload.files
            : [];
        files.forEach((file) => {
          const normalized = {
            id: String(file.id || file.fileId || ''),
            name: file.name || file.originalName || `Document ${file.id || ''}`,
            collectionId: file.collectionId || collection.id,
            collectionName: file.collectionName || collection.name,
            uploadedAt: file.uploadedAt || file.updatedAt || null,
            size: Number(file.size || file.bytes || 0),
            viewUrl: file.viewUrl || `/api/vault/files/${encodeURIComponent(file.id || file.fileId)}/view`
          };
          if (normalized.id) allDocs.push(normalized);
        });
      }

      const deduped = new Map();
      allDocs.forEach((doc) => { deduped.set(doc.id, doc); });
      state.documents = Array.from(deduped.values()).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));

      if (state.documents.length) {
        state.selected = state.selected && deduped.has(state.selected.id)
          ? deduped.get(state.selected.id)
          : state.documents[0];
      } else {
        state.selected = null;
      }

      renderDocuments();
      renderSelected();
    } catch (err) {
      console.error('[loan-management] loadDocuments failed', err);
      if (docError) {
        docError.textContent = err?.message || 'Unable to load documents from the vault.';
        docError.classList.remove('d-none');
      }
    } finally {
      hideLoader(docLoader);
    }
  }

  function renderDocuments() {
    if (!docList) return;
    docList.innerHTML = '';
    if (!state.documents.length) {
      docEmpty?.classList.remove('d-none');
      return;
    }
    docEmpty?.classList.add('d-none');

    state.documents.forEach((doc) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-group-item list-group-item-action loan-doc-item text-start';
      item.setAttribute('data-id', doc.id);
      if (state.selected && state.selected.id === doc.id) item.classList.add('active');

      const uploaded = doc.uploadedAt ? formatDate(doc.uploadedAt) : 'No upload date';
      const sizeLabel = doc.size ? formatBytes(doc.size) : '';

      item.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div class="flex-grow-1">
            <div class="fw-semibold text-truncate">${escapeHtml(doc.name)}</div>
            <div class="small text-muted">${escapeHtml(doc.collectionName || 'Custom collection')}${sizeLabel ? ` · ${escapeHtml(sizeLabel)}` : ''}</div>
            <div class="text-muted small">Uploaded ${escapeHtml(uploaded)}</div>
          </div>
          <div class="text-end">
            <span class="badge bg-light text-dark mb-2">${escapeHtml(doc.collectionName || 'Custom')}</span>
            <div><a href="${doc.viewUrl}" class="btn btn-link btn-sm px-0" target="_blank" rel="noopener" data-action="open">Open</a></div>
          </div>
        </div>`;

      docList.appendChild(item);
    });
  }

  function renderSelected() {
    if (!docSelected || !docSelectedMeta) return;
    if (!state.selected) {
      docSelected.classList.add('d-none');
      docSelectedMeta.textContent = '';
      return;
    }
    const doc = state.selected;
    const uploaded = doc.uploadedAt ? formatDate(doc.uploadedAt) : 'Unknown date';
    docSelectedMeta.innerHTML = `
      <div>${escapeHtml(doc.name)}</div>
      <div class="text-muted">${escapeHtml(doc.collectionName || 'Custom collection')} · ${escapeHtml(uploaded)}</div>
      <a class="small" href="${doc.viewUrl}" target="_blank" rel="noopener">Open document</a>`;
    docSelected.classList.remove('d-none');
  }

  function renderAffordability() {
    if (!affordabilityWrap || !affordabilitySummary) return;
    const aff = state.affordability || {};
    const freeCash = toNumber(aff.freeCashflow);
    const debtService = toNumber(aff.debtService);
    const income = toNumber(aff.monthlyIncome);
    const spend = toNumber(aff.monthlySpend);
    const safeRate = aff.recommendedSavingsRate != null ? Number(aff.recommendedSavingsRate) : null;
    const safeMonthly = toNumber(aff.recommendedContribution || aff.safeMonthlySavings);

    affordabilityTable.innerHTML = '';

    const rows = [
      ['Monthly income', income ? `${formatMoney(income)}/mo` : '—'],
      ['Core spend', spend ? `${formatMoney(spend)}/mo` : '—'],
      ['Existing debt service', debtService ? `${formatMoney(debtService)}/mo` : '—'],
      ['Free cashflow', freeCash ? `${formatMoney(freeCash)}/mo` : '—'],
      ['Safe savings rate', safeRate != null ? formatPercent(safeRate) : '—'],
      ['Suggested savings', safeMonthly ? `${formatMoney(safeMonthly)}/mo` : '—']
    ];

    rows.forEach(([label, value]) => {
      const row = document.createElement('tr');
      row.innerHTML = `<th scope="row" class="text-muted small">${escapeHtml(label)}</th><td class="text-end fw-semibold">${value}</td>`;
      affordabilityTable.appendChild(row);
    });

    affordabilityFootnote.textContent = 'Figures sourced from your Wealth Lab affordability snapshot.';
    affordabilityWrap.classList.remove('d-none');
    updateAffordabilityFlag(state.lastPayment || null);
  }

  function updateAffordabilityFlag(monthlyPayment) {
    if (!affordabilityFlag) return;
    affordabilityFlag.innerHTML = '';

    const aff = state.affordability || {};
    const freeCash = toNumber(aff.freeCashflow);

    if (!monthlyPayment || monthlyPayment <= 0) {
      affordabilitySummary.textContent = 'Enter loan details to evaluate affordability against your cashflow profile.';
      return;
    }

    if (!Number.isFinite(freeCash) || freeCash <= 0) {
      affordabilitySummary.textContent = 'We could not locate free cashflow analytics. Upload recent statements to unlock affordability guidance.';
      const pill = document.createElement('span');
      pill.className = 'loan-affordability-flag loan-affordability-flag--amber';
      pill.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Limited data';
      affordabilityFlag.appendChild(pill);
      return;
    }

    const utilisation = monthlyPayment / freeCash;
    let tone = 'green';
    let message = `This loan would use ${formatPercent(utilisation)} of your free cashflow (£${formatMoney(freeCash)}/mo available).`;

    if (utilisation > 0.95) {
      tone = 'red';
      message = `Repayments of ${formatMoney(monthlyPayment)}/mo exceed your free cashflow of ${formatMoney(freeCash)}/mo. Consider changing the term or amount.`;
    } else if (utilisation > 0.75) {
      tone = 'amber';
      message = `Repayments of ${formatMoney(monthlyPayment)}/mo would absorb most of your free cashflow (${formatMoney(freeCash)}/mo). Stress-test other obligations before proceeding.`;
    } else {
      message = `Repayments of ${formatMoney(monthlyPayment)}/mo sit within your free cashflow (${formatMoney(freeCash)}/mo), leaving headroom for other goals.`;
    }

    affordabilitySummary.textContent = message;
    const pill = document.createElement('span');
    pill.className = `loan-affordability-flag loan-affordability-flag--${tone}`;
    pill.innerHTML = tone === 'green'
      ? '<i class="bi bi-check-circle"></i> Comfortable'
      : tone === 'amber'
        ? '<i class="bi bi-shield-exclamation"></i> Tight fit'
        : '<i class="bi bi-x-octagon"></i> Not affordable';
    affordabilityFlag.appendChild(pill);
  }

  function updateCalculations() {
    const principal = toNumber(amountInput?.value);
    const rate = Number(rateInput?.value || 0) / 100;
    const termRaw = Number(termInput?.value || 0);
    const termUnit = termUnitInput?.value === 'years' ? 'years' : 'months';
    const fees = toNumber(feesInput?.value);

    const months = termUnit === 'years' ? termRaw * 12 : termRaw;
    let monthlyRate = rate / 12;
    if (!Number.isFinite(monthlyRate) || monthlyRate < 0) monthlyRate = 0;

    let monthlyPayment = 0;
    if (principal > 0 && months > 0) {
      if (monthlyRate === 0) {
        monthlyPayment = principal / months;
      } else {
        const pow = Math.pow(1 + monthlyRate, -months);
        monthlyPayment = principal * (monthlyRate / (1 - pow));
      }
    }

    const totalPaid = monthlyPayment * months;
    const totalInterest = totalPaid - principal;
    const effectiveTotal = totalPaid + fees;

    monthlyEl.textContent = monthlyPayment ? `${formatMoney(monthlyPayment)}/mo` : '—';
    totalEl.textContent = totalPaid ? formatMoney(totalPaid) : '—';
    interestEl.textContent = totalInterest ? formatMoney(totalInterest) : '—';
    effectiveEl.textContent = effectiveTotal ? formatMoney(effectiveTotal) : '—';

    state.lastPayment = monthlyPayment || null;
    updateAffordabilityFlag(state.lastPayment);
  }

  function showStage(title, detail) {
    if (!stageBox) return;
    stageBox.classList.remove('d-none');
    if (stageLabel) stageLabel.textContent = title || 'Working…';
    if (stageDetail) stageDetail.textContent = detail || '';
  }

  function hideStage() {
    if (!stageBox) return;
    stageBox.classList.add('d-none');
  }

  function showLoader(el, text) {
    if (!el) return;
    el.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <div class="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true"></div>
        <span>${escapeHtml(text || 'Loading…')}</span>
      </div>`;
    el.classList.remove('d-none');
  }

  function hideLoader(el) {
    if (!el) return;
    el.classList.add('d-none');
    el.innerHTML = '';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toNumber(value) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) return '—';
    return '£' + Number(value).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return '—';
    return `${(value * 100).toFixed(1)}%`;
  }

  function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let num = Number(bytes || 0);
    while (num >= 1024 && idx < units.length - 1) {
      num /= 1024;
      idx += 1;
    }
    return `${num.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'unknown';
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return 'unknown';
    }
  }
})();
