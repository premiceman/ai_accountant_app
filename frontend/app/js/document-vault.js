(function () {
  const statusSteps = ['upload', 'docupipe', 'analytics'];
  const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
  let isUploading = false;
  const state = {
    months: [],
    selectedMonth: null,
    documents: [],
    selectedDocumentId: null,
  };
  const documentDetailsCache = new Map();
  const documentPreviewCache = new Map();
  let jsonCopyResetTimer = null;

  function formatDocupipeLabel(value) {
    if (!value && value !== 0) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const normalised = raw.replace(/[_\s-]+/g, ' ');
    if (normalised.toUpperCase() === normalised) {
      return normalised;
    }
    return normalised
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function normaliseComparisonValue(value) {
    return (value || '')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function getStatusElement(step) {
    return document.querySelector(`#upload-status [data-step="${step}"]`);
  }

  function resetUploadStatus() {
    statusSteps.forEach((step) => {
      const el = getStatusElement(step);
      if (!el) return;
      el.classList.remove('is-active', 'is-success', 'is-error');
    });
  }

  function setUploadStatus(step, status) {
    const el = getStatusElement(step);
    if (!el) return;
    el.classList.remove('is-active', 'is-success', 'is-error');
    if (status === 'active') el.classList.add('is-active');
    if (status === 'success') el.classList.add('is-success');
    if (status === 'error') el.classList.add('is-error');
  }

  function setUploadFeedback(message, tone = 'info') {
    const feedback = document.getElementById('upload-feedback');
    if (!feedback) return;
    feedback.textContent = message || '';
    feedback.classList.remove('success', 'error');
    if (tone === 'success') feedback.classList.add('success');
    if (tone === 'error') feedback.classList.add('error');
  }

  function formatCurrency(value, currency = 'GBP', { invert = false } = {}) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '—';
    }
    const amount = invert ? -Number(value) : Number(value);
    const formatter = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'GBP',
      maximumFractionDigits: 2,
    });
    return formatter.format(amount);
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  function formatMonthLabel(month) {
    if (!month) return '—';
    const date = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return month;
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(date);
  }

  function formatAccountNumber(value) {
    if (!value) return '';
    const str = String(value);
    const last = str.slice(-4);
    return `••${last}`;
  }

  function formatDocumentType(type) {
    if (type === 'payslip') return 'Payslip';
    if (type === 'statement') return 'Statement';
    return 'Document';
  }

  function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined) return '';
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value >= 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (value >= 1024) {
      return `${Math.round(value / 1024)} KB`;
    }
    return `${value} B`;
  }

  function getDocumentById(fileId) {
    return state.documents.find((doc) => doc.fileId === fileId) || null;
  }

  function renderDocumentTags(doc) {
    const container = document.getElementById('document-preview-tags');
    if (!container) return;
    container.innerHTML = '';

    if (!doc) {
      container.hidden = true;
      return;
    }

    const tags = [];
    if (doc.docType) {
      tags.push({
        label: formatDocumentType(doc.docType),
        tone: doc.docType,
      });
    }

    const canonicalLabel = doc.docType ? formatDocumentType(doc.docType) : '';
    const canonicalKey = normaliseComparisonValue(canonicalLabel);

    const classificationLabel = formatDocupipeLabel(doc.docupipe?.classification);
    if (classificationLabel && normaliseComparisonValue(classificationLabel) !== canonicalKey) {
      tags.push({ label: classificationLabel, tone: 'classification' });
    }

    const docupipeTypeLabel = formatDocupipeLabel(doc.docupipe?.documentType);
    if (
      docupipeTypeLabel
      && normaliseComparisonValue(docupipeTypeLabel) !== canonicalKey
      && normaliseComparisonValue(docupipeTypeLabel) !== normaliseComparisonValue(classificationLabel)
    ) {
      tags.push({ label: docupipeTypeLabel, tone: 'docupipe-type' });
    }

    if (doc.docupipe?.schema) {
      tags.push({ label: doc.docupipe.schema, tone: 'schema' });
    }

    const catalogueLabel = formatDocupipeLabel(doc.docupipe?.catalogueKey);
    if (
      catalogueLabel
      && normaliseComparisonValue(catalogueLabel) !== normaliseComparisonValue(doc.docupipe?.schema)
      && normaliseComparisonValue(catalogueLabel) !== normaliseComparisonValue(classificationLabel)
    ) {
      tags.push({ label: catalogueLabel, tone: 'catalogue' });
    }

    if (!tags.length) {
      container.hidden = true;
      return;
    }

    tags.forEach(({ label, tone }) => {
      const tag = document.createElement('span');
      tag.className = 'document-preview-tag';
      if (tone) {
        tag.dataset.tone = tone;
      }
      tag.textContent = label;
      container.appendChild(tag);
    });
    container.hidden = false;
  }

  function clearJsonCopyFeedback() {
    if (jsonCopyResetTimer) {
      clearTimeout(jsonCopyResetTimer);
      jsonCopyResetTimer = null;
    }
  }

  function setJsonCopyButtonEnabled(enabled) {
    const button = document.getElementById('document-json-copy');
    if (!button) return;
    if (!enabled) {
      clearJsonCopyFeedback();
      button.disabled = true;
      button.textContent = 'Copy JSON';
      button.classList.remove('is-success', 'is-error');
      return;
    }
    button.disabled = false;
    button.textContent = 'Copy JSON';
    button.classList.remove('is-success', 'is-error');
  }

  async function handleJsonCopyClick(event) {
    const button = event.currentTarget;
    const json = document.getElementById('document-json');
    if (!json || !json.textContent) {
      return;
    }

    const text = json.textContent;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      button.textContent = 'Copied!';
      button.classList.remove('is-error');
      button.classList.add('is-success');
    } catch (error) {
      console.error('Unable to copy JSON to clipboard', error);
      button.textContent = 'Copy failed';
      button.classList.remove('is-success');
      button.classList.add('is-error');
    }

    clearJsonCopyFeedback();
    jsonCopyResetTimer = setTimeout(() => {
      button.textContent = 'Copy JSON';
      button.classList.remove('is-success', 'is-error');
    }, 2000);
  }

  function bindJsonCopy() {
    const button = document.getElementById('document-json-copy');
    if (!button || button.dataset.bound === 'true') return;
    button.addEventListener('click', handleJsonCopyClick);
    button.dataset.bound = 'true';
    setJsonCopyButtonEnabled(false);
  }

  function renderDocumentList() {
    const list = document.getElementById('document-list');
    const empty = document.getElementById('document-list-empty');
    if (!list || !empty) return;

    if (!empty.dataset.defaultText) {
      empty.dataset.defaultText = empty.textContent || '';
    }

    list.innerHTML = '';
    if (!state.documents.length) {
      empty.hidden = false;
      empty.textContent = empty.dataset.defaultText || 'No documents uploaded yet.';
      return;
    }

    empty.hidden = true;
    state.documents.forEach((doc) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'document-list-item';
      button.dataset.fileId = doc.fileId;
      if (state.selectedDocumentId === doc.fileId) {
        button.classList.add('is-active');
      }

      const name = document.createElement('span');
      name.className = 'document-list-name';
      name.textContent = doc.originalName || formatDocumentType(doc.docType);

      const meta = document.createElement('span');
      meta.className = 'document-list-meta';
      const parts = [];
      if (doc.month) parts.push(formatMonthLabel(doc.month));
      if (doc.docType) parts.push(formatDocumentType(doc.docType));
      const classificationLabel = formatDocupipeLabel(doc.docupipe?.classification);
      if (classificationLabel) {
        const canonicalLabel = doc.docType ? formatDocumentType(doc.docType) : '';
        if (normaliseComparisonValue(classificationLabel) !== normaliseComparisonValue(canonicalLabel)) {
          parts.push(`Docupipe ${classificationLabel}`);
        }
      }
      const sizeLabel = formatFileSize(doc.size);
      if (sizeLabel) parts.push(sizeLabel);
      if (doc.createdAt) parts.push(`Added ${formatDate(doc.createdAt)}`);
      meta.textContent = parts.join(' • ');

      button.append(name);
      if (parts.length) {
        button.append(meta);
      }

      button.addEventListener('click', () => {
        if (state.selectedDocumentId === doc.fileId) return;
        loadDocumentPreview(doc.fileId);
      });

      item.appendChild(button);
      list.appendChild(item);
    });
  }

  function updateDocumentPreviewHeader(doc) {
    const title = document.getElementById('document-preview-title');
    const meta = document.getElementById('document-preview-meta');
    if (!title || !meta) return;

    if (!doc) {
      title.textContent = state.documents.length ? 'No document selected' : 'No documents available';
      meta.textContent = '';
      renderDocumentTags(null);
      return;
    }

    title.textContent = doc.originalName || formatDocumentType(doc.docType);
    const parts = [];
    if (doc.docType) parts.push(formatDocumentType(doc.docType));
    if (doc.month) parts.push(formatMonthLabel(doc.month));
    if (doc.payDate) {
      parts.push(`Pay date ${formatDate(doc.payDate)}`);
    } else if (doc.periodStart || doc.periodEnd) {
      const period = [doc.periodStart, doc.periodEnd].filter(Boolean).map((value) => formatDate(value));
      if (period.length) {
        parts.push(period.join(' – '));
      }
    }
    meta.textContent = parts.join(' • ');
    renderDocumentTags(doc);
  }

  function clearDocumentPreview(message) {
    const frame = document.getElementById('document-preview-frame');
    const frameEmpty = document.getElementById('document-preview-empty');
    const json = document.getElementById('document-json');
    const jsonEmpty = document.getElementById('document-json-empty');

    if (frame) {
      frame.hidden = true;
      frame.removeAttribute('src');
    }
    if (frameEmpty) {
      frameEmpty.hidden = false;
      frameEmpty.textContent =
        message || (state.documents.length ? 'Select a document to preview.' : 'Upload a document to preview it here.');
    }
    if (json) {
      json.hidden = true;
      json.textContent = '';
    }
    if (jsonEmpty) {
      jsonEmpty.hidden = false;
      jsonEmpty.textContent =
        message ||
        (state.documents.length
          ? 'Select a document to view the JSON output.'
          : 'Upload a document to view JSON output.');
    }
    setJsonCopyButtonEnabled(false);
    updateDocumentPreviewHeader(null);
  }

  function setDocumentPreviewLoading() {
    const frame = document.getElementById('document-preview-frame');
    const frameEmpty = document.getElementById('document-preview-empty');
    const json = document.getElementById('document-json');
    const jsonEmpty = document.getElementById('document-json-empty');
    if (frame) {
      frame.hidden = true;
      frame.removeAttribute('src');
    }
    if (frameEmpty) {
      frameEmpty.hidden = false;
      frameEmpty.textContent = 'Loading preview…';
    }
    if (json) {
      json.hidden = true;
      json.textContent = '';
    }
    if (jsonEmpty) {
      jsonEmpty.hidden = false;
      jsonEmpty.textContent = 'Loading JSON…';
    }
    setJsonCopyButtonEnabled(false);
  }

  function updateMonthSelect(months, selectedMonth) {
    const select = document.getElementById('analytics-month');
    if (!select) return;
    const currentValues = Array.from(select.options).map((opt) => opt.value);
    const needsUpdate =
      currentValues.length !== months.length || currentValues.some((value, index) => value !== months[index]);
    if (needsUpdate) {
      select.innerHTML = '';
      months.forEach((month) => {
        const option = document.createElement('option');
        option.value = month;
        option.textContent = formatMonthLabel(month);
        select.appendChild(option);
      });
    }
    if (selectedMonth) {
      select.value = selectedMonth;
    }
    select.disabled = months.length === 0;
  }

  function renderSummary(summary) {
    const container = document.getElementById('summary-grid');
    const empty = document.getElementById('summary-empty');
    if (!container || !empty) return;
    if (!empty.dataset.defaultText) {
      empty.dataset.defaultText = empty.textContent || '';
    }
    container.innerHTML = '';
    if (!summary || !summary.totals) {
      empty.textContent = empty.dataset.defaultText || '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    empty.textContent = empty.dataset.defaultText || '';
    const { totals, currency } = summary;
    const metrics = [
      { key: 'netPay', label: 'Net pay' },
      { key: 'grossPay', label: 'Gross pay' },
      { key: 'income', label: 'Statement income' },
      { key: 'spend', label: 'Statement spend', invert: true },
      { key: 'netCashflow', label: 'Net cashflow' },
    ];
    metrics.forEach(({ key, label, invert }) => {
      if (totals[key] === null || totals[key] === undefined) return;
      const tile = document.createElement('div');
      tile.className = 'summary-tile';
      const metricLabel = document.createElement('span');
      metricLabel.className = 'metric-label';
      metricLabel.textContent = label;
      const metricValue = document.createElement('p');
      metricValue.className = 'metric-value';
      metricValue.textContent = formatCurrency(totals[key], currency, { invert });
      tile.append(metricLabel, metricValue);
      container.appendChild(tile);
    });
    if (!container.children.length) {
      empty.hidden = false;
    }
  }

  function renderPayslips(payslips, currency) {
    const wrapper = document.querySelector('#payslip-panel .table-wrapper');
    const table = document.getElementById('payslip-table');
    const empty = document.getElementById('payslip-empty');
    if (!wrapper || !table || !empty) return;
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    if (!payslips.length) {
      wrapper.hidden = true;
      empty.hidden = false;
      return;
    }
    wrapper.hidden = false;
    empty.hidden = true;
    payslips.forEach((slip) => {
      const row = document.createElement('tr');
      const employerCell = document.createElement('td');
      employerCell.textContent = slip.employerName || '—';
      const payDateCell = document.createElement('td');
      payDateCell.textContent = formatDate(slip.payDate);
      const grossCell = document.createElement('td');
      grossCell.textContent = formatCurrency(slip.metrics?.gross, slip.currency || currency);
      const netCell = document.createElement('td');
      netCell.textContent = formatCurrency(slip.metrics?.net, slip.currency || currency);
      const taxCell = document.createElement('td');
      taxCell.textContent = formatCurrency(slip.metrics?.incomeTax, slip.currency || currency);
      const niCell = document.createElement('td');
      niCell.textContent = formatCurrency(slip.metrics?.nationalInsurance, slip.currency || currency);
      row.append(employerCell, payDateCell, grossCell, netCell, taxCell, niCell);
      tbody.appendChild(row);
    });
  }

  function renderStatements(statements, currency) {
    const wrapper = document.querySelector('#statement-panel .table-wrapper');
    const table = document.getElementById('statement-table');
    const empty = document.getElementById('statement-empty');
    const transactionsContainer = document.getElementById('statement-top');
    const transactionList = document.getElementById('transaction-list');
    if (!wrapper || !table || !empty || !transactionsContainer || !transactionList) return;

    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    if (!statements.length) {
      wrapper.hidden = true;
      empty.hidden = false;
      transactionsContainer.hidden = true;
      transactionList.innerHTML = '';
      return;
    }

    wrapper.hidden = false;
    empty.hidden = true;

    statements.forEach((statement) => {
      const row = document.createElement('tr');
      const accountCell = document.createElement('td');
      const masked = formatAccountNumber(statement.accountNumber);
      const accountLabel = statement.accountName || statement.institutionName || 'Account';
      accountCell.textContent = masked ? `${accountLabel} · ${masked}` : accountLabel;
      const openingCell = document.createElement('td');
      openingCell.textContent = formatCurrency(statement.balances?.opening, statement.currency || currency);
      const closingCell = document.createElement('td');
      closingCell.textContent = formatCurrency(statement.balances?.closing, statement.currency || currency);
      const incomeCell = document.createElement('td');
      incomeCell.textContent = formatCurrency(statement.totals?.income, statement.currency || currency);
      const spendCell = document.createElement('td');
      spendCell.textContent = formatCurrency(statement.totals?.spend, statement.currency || currency, { invert: true });
      const netCell = document.createElement('td');
      netCell.textContent = formatCurrency(statement.totals?.net, statement.currency || currency);
      row.append(accountCell, openingCell, closingCell, incomeCell, spendCell, netCell);
      tbody.appendChild(row);
    });

    const transactions = statements
      .flatMap((statement) =>
        (statement.topTransactions || []).map((tx) => ({
          ...tx,
          accountName: statement.accountName || statement.institutionName || 'Account',
          currency: statement.currency || currency,
        }))
      )
      .filter((tx) => tx.amount !== null && tx.amount !== undefined)
      .sort((a, b) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0))
      .slice(0, 5);

    transactionList.innerHTML = '';
    if (!transactions.length) {
      transactionsContainer.hidden = true;
      return;
    }

    transactionsContainer.hidden = false;
    transactions.forEach((tx) => {
      const item = document.createElement('li');
      const label = document.createElement('div');
      label.className = 'transaction-label';
      const primary = document.createElement('span');
      primary.textContent = tx.description || 'Transaction';
      const secondary = document.createElement('span');
      secondary.textContent = `${formatDate(tx.date)} · ${tx.accountName}`;
      label.append(primary, secondary);
      const amount = document.createElement('span');
      amount.className = `transaction-amount ${tx.direction || (tx.amount >= 0 ? 'credit' : 'debit')}`;
      amount.textContent = formatCurrency(tx.amount, tx.currency || currency);
      item.append(label, amount);
      transactionList.appendChild(item);
    });
  }

  async function loadDocumentPreview(fileId, { force = false } = {}) {
    if (!fileId) {
      state.selectedDocumentId = null;
      clearDocumentPreview();
      return;
    }

    state.selectedDocumentId = fileId;
    renderDocumentList();
    const doc = getDocumentById(fileId);
    updateDocumentPreviewHeader(doc);
    setDocumentPreviewLoading();

    const previewPromise =
      !force && documentPreviewCache.has(fileId)
        ? Promise.resolve(documentPreviewCache.get(fileId))
        : App.Api.getDashboardDocumentPreview(fileId).then((value) => {
            documentPreviewCache.set(fileId, value);
            return value;
          });

    const jsonPromise =
      !force && documentDetailsCache.has(fileId)
        ? Promise.resolve(documentDetailsCache.get(fileId))
        : App.Api.getDashboardDocumentJson(fileId).then((value) => {
            documentDetailsCache.set(fileId, value);
            return value;
          });

    const [previewResult, jsonResult] = await Promise.allSettled([previewPromise, jsonPromise]);

    if (state.selectedDocumentId !== fileId) {
      return;
    }

    const frame = document.getElementById('document-preview-frame');
    const frameEmpty = document.getElementById('document-preview-empty');
    const json = document.getElementById('document-json');
    const jsonEmpty = document.getElementById('document-json-empty');

    if (previewResult.status === 'fulfilled' && previewResult.value?.url) {
      if (frame) {
        frame.src = previewResult.value.url;
        frame.hidden = false;
      }
      if (frameEmpty) {
        frameEmpty.hidden = true;
        frameEmpty.textContent = '';
      }
    } else {
      if (frame) {
        frame.hidden = true;
        frame.removeAttribute('src');
      }
      if (frameEmpty) {
        const message =
          previewResult.status === 'rejected'
            ? previewResult.reason?.message || 'Unable to load preview.'
            : 'Preview unavailable.';
        frameEmpty.hidden = false;
        frameEmpty.textContent = message;
      }
    }

    if (jsonResult.status === 'fulfilled') {
      const detail = jsonResult.value || {};
      if (detail.docupipe) {
        const index = state.documents.findIndex((item) => item.fileId === fileId);
        if (index !== -1) {
          const existing = state.documents[index];
          const nextDoc = { ...existing, docupipe: detail.docupipe };
          state.documents.splice(index, 1, nextDoc);
          renderDocumentList();
          if (state.selectedDocumentId === fileId) {
            updateDocumentPreviewHeader(nextDoc);
          }
        }
      }
      if (json) {
        const payload = detail;
        let display = payload;
        if (payload && typeof payload === 'object' && payload.raw !== undefined) {
          display = payload.raw ?? payload;
        }
        json.textContent = JSON.stringify(display, null, 2);
        json.hidden = false;
      }
      if (jsonEmpty) {
        jsonEmpty.hidden = true;
        jsonEmpty.textContent = '';
      }
      setJsonCopyButtonEnabled(true);
    } else {
      if (json) {
        json.hidden = true;
        json.textContent = '';
      }
      if (jsonEmpty) {
        const message = jsonResult.reason?.message || 'Unable to load JSON output.';
        jsonEmpty.hidden = false;
        jsonEmpty.textContent = message;
      }
      setJsonCopyButtonEnabled(false);
    }
  }

  async function loadDocuments({ preserveSelection = false } = {}) {
    const empty = document.getElementById('document-list-empty');
    if (empty && !state.documents.length) {
      empty.hidden = false;
      if (!empty.dataset.defaultText) {
        empty.dataset.defaultText = empty.textContent || '';
      }
      empty.textContent = 'Loading documents…';
    }

    try {
      const data = await App.Api.getDashboardDocuments();
      state.documents = Array.isArray(data.documents) ? data.documents : [];
      const validIds = new Set(state.documents.map((doc) => doc.fileId));
      Array.from(documentPreviewCache.keys()).forEach((key) => {
        if (!validIds.has(key)) {
          documentPreviewCache.delete(key);
        }
      });
      Array.from(documentDetailsCache.keys()).forEach((key) => {
        if (!validIds.has(key)) {
          documentDetailsCache.delete(key);
        }
      });
      const hasSelection = state.documents.some((doc) => doc.fileId === state.selectedDocumentId);
      if (!preserveSelection || !hasSelection) {
        state.selectedDocumentId = state.documents[0]?.fileId || null;
      }
      renderDocumentList();
      if (state.selectedDocumentId) {
        await loadDocumentPreview(state.selectedDocumentId, { force: true });
      } else {
        clearDocumentPreview();
      }
    } catch (error) {
      state.documents = [];
      state.selectedDocumentId = null;
      renderDocumentList();
      if (empty) {
        empty.hidden = false;
        empty.textContent = error.message || 'Unable to load uploaded documents.';
      }
      clearDocumentPreview(error.message);
    }
  }

  async function loadAnalytics(month) {
    const loader = document.getElementById('analytics-loading');
    if (loader) loader.hidden = false;
    try {
      const data = await App.Api.getDashboardAnalytics(month);
      state.months = data.months || [];
      state.selectedMonth = data.selectedMonth || null;
      updateMonthSelect(state.months, state.selectedMonth);
      renderSummary(data.summary || null);
      const currency = data.summary?.currency || data.payslips?.[0]?.currency || data.statements?.[0]?.currency || 'GBP';
      renderPayslips(data.payslips || [], currency);
      renderStatements(data.statements || [], currency);
    } catch (error) {
      const container = document.getElementById('summary-grid');
      const empty = document.getElementById('summary-empty');
      if (container) container.innerHTML = '';
      if (empty) {
        empty.hidden = false;
        empty.textContent = error.message || 'Unable to load analytics at the moment.';
      }
      renderPayslips([], 'GBP');
      renderStatements([], 'GBP');
    } finally {
      if (loader) loader.hidden = true;
    }
  }

  async function handleUpload(file) {
    if (!file || isUploading) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (!isPdf) {
      resetUploadStatus();
      setUploadFeedback('Please upload a PDF document.', 'error');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      resetUploadStatus();
      setUploadFeedback('This file is larger than 20 MB. Please choose a smaller document.', 'error');
      return;
    }
    isUploading = true;
    resetUploadStatus();
    setUploadFeedback('', 'info');
    setUploadStatus('upload', 'active');
    setUploadStatus('docupipe', null);
    setUploadStatus('analytics', null);

    const docupipeTimer = setTimeout(() => setUploadStatus('docupipe', 'active'), 500);
    const analyticsTimer = setTimeout(() => setUploadStatus('analytics', 'active'), 1200);

    const formData = new FormData();
    formData.append('document', file);

    try {
      const response = await App.Api.uploadDocument(formData);
      clearTimeout(docupipeTimer);
      clearTimeout(analyticsTimer);
      setUploadStatus('upload', 'success');
      setUploadStatus('docupipe', 'success');
      setUploadStatus('analytics', 'success');
      const tone = response.status === 'duplicate' ? 'success' : 'success';
      const message = response.message || 'Document processed successfully.';
      setUploadFeedback(message, tone);
      await loadAnalytics(response.month || state.selectedMonth);
      await loadDocuments({ preserveSelection: false });
    } catch (error) {
      clearTimeout(docupipeTimer);
      clearTimeout(analyticsTimer);
      setUploadStatus('upload', 'error');
      setUploadStatus('docupipe', 'error');
      setUploadStatus('analytics', 'error');
      setUploadFeedback(error.message || 'We could not process this document.', 'error');
    } finally {
      isUploading = false;
    }
  }

  function bindUploadControls() {
    const fileInput = document.getElementById('document-input');
    const button = document.getElementById('document-button');
    const dropzone = document.getElementById('upload-dropzone');
    if (!fileInput || !button || !dropzone) return;

    button.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', () => {
      const [file] = fileInput.files || [];
      if (file) {
        handleUpload(file).finally(() => {
          fileInput.value = '';
        });
      }
    });

    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('drag-active');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-active');
    });

    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag-active');
      const [file] = event.dataTransfer?.files || [];
      if (file) {
        handleUpload(file);
      }
    });
  }

  function bindMonthSelect() {
    const select = document.getElementById('analytics-month');
    if (!select || select.dataset.bound === 'true') return;
    select.addEventListener('change', (event) => {
      const month = event.target.value;
      if (month) {
        loadAnalytics(month);
      }
    });
    select.dataset.bound = 'true';
  }

  document.addEventListener('DOMContentLoaded', () => {
    App.bootstrap('vault')
      .then(() => {
        bindUploadControls();
        bindMonthSelect();
        bindJsonCopy();
        resetUploadStatus();
        return Promise.all([loadAnalytics(), loadDocuments()]);
      })
      .catch((error) => {
        console.error('Document vault initialisation failed', error);
        const empty = document.getElementById('summary-empty');
        if (empty) {
          empty.hidden = false;
          empty.textContent = 'We could not load your account details. Please refresh the page to try again.';
        }
      });
  });
})();
