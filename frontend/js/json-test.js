(function () {
  const dropzone = document.getElementById('json-test-dropzone');
  const fileInput = dropzone?.querySelector('input[type="file"]');
  const output = document.getElementById('json-test-output');
  const errorBox = document.getElementById('json-test-error');
  const statusPill = document.getElementById('json-test-status');
  const labelBadge = document.getElementById('json-test-label');
  const asyncToggleEl = document.getElementById('asyncMode');

  const trimReview = createTrimReview();
  const asyncFeatureEnabled = (window.JSON_TEST_ASYNC ?? 'true') !== 'false';
  if (asyncToggleEl && !asyncFeatureEnabled) {
    asyncToggleEl.checked = false;
    asyncToggleEl.disabled = true;
    const asyncLabel = asyncToggleEl.closest('label');
    if (asyncLabel) asyncLabel.style.opacity = '0.6';
  }

  if (!dropzone || !fileInput || !output) return;

  init().catch((err) => {
    console.error('Failed to initialise JSON test page', err);
    showError('Unable to initialise authentication context.');
  });

  async function init() {
    await Auth.requireAuth();
    document.body.classList.add('app-shell-ready');
    setupDropzone();
    setStatus('Ready', false);
  }

  function setupDropzone() {
    ['dragenter', 'dragover'].forEach((event) => {
      dropzone.addEventListener(event, (ev) => {
        ev.preventDefault();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach((event) => {
      dropzone.addEventListener(event, () => {
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const file = ev.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) handleFile(file);
      fileInput.value = '';
    });
  }

  function setStatus(text, busy) {
    if (!statusPill) return;
    statusPill.classList.toggle('d-none', !text);
    const label = statusPill.querySelector('span');
    if (label) label.textContent = text;
    statusPill.classList.toggle('bg-warning-subtle', !!busy);
    statusPill.classList.toggle('text-warning', !!busy);
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || 'Something went wrong.';
    errorBox.classList.remove('d-none');
  }

  function clearError() {
    if (!errorBox) return;
    errorBox.classList.add('d-none');
    errorBox.textContent = '';
  }

  async function handleFile(file) {
    clearError();
    labelBadge?.setAttribute('hidden', '');
    output.textContent = 'Analysing document…';
    setStatus('Checking document…', true);
    let pollTimer = null;
    const cancelPoll = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    try {
      const docTypeEl = document.getElementById('docType');
      const docType = docTypeEl ? docTypeEl.value : (window.DEFAULT_DOC_TYPE || 'bank');
      const useAsync = !!(asyncToggleEl && asyncToggleEl.checked && asyncFeatureEnabled);

      const fileForProcessing = await trimReview.reviewIfNeeded(file, {
        onProgress: (message, busy = true) => setStatus(message, busy),
      });

      if (!fileForProcessing) {
        setStatus('Ready', false);
        output.textContent = 'Upload a document to view the parsed JSON payload.';
        return;
      }

      setStatus(useAsync ? 'Submitting to DocuPipe…' : 'Processing…', true);

      if (useAsync) {
        const form = new FormData();
        form.append('file', fileForProcessing);
        form.append('docType', docType);

        const submitRes = await Auth.fetch('/api/json-test/submit', { method: 'POST', body: form });
        let submitJson = null;
        try {
          submitJson = await submitRes.json();
        } catch (err) {
          throw new Error('Failed to parse submit response');
        }
        if (!submitRes.ok || !submitJson?.ok) {
          throw new Error(submitJson?.error || submitRes.statusText || 'Submit failed');
        }

        const stdJobId = submitJson.stdJobId;
        const standardizationId = submitJson.standardizationId;
        if (!stdJobId || !standardizationId) {
          throw new Error('Missing job identifiers');
        }

        output.textContent = 'Waiting for DocuPipe standardization…';

        await new Promise((resolve, reject) => {
          const intervalMs = 3000;

          const poll = async () => {
            try {
              const statusRes = await Auth.fetch(`/api/json-test/status?stdJobId=${encodeURIComponent(stdJobId)}&standardizationId=${encodeURIComponent(standardizationId)}`);
              const statusJson = await statusRes.json();
              if (!statusRes.ok) {
                throw new Error(statusJson?.error || statusRes.statusText || 'Status check failed');
              }
              if (statusJson?.state === 'completed') {
                cancelPoll();
                renderResult(statusJson.data);
                resolve();
                return;
              }
              if (statusJson?.state === 'failed' || statusJson?.state === 'error' || statusJson?.ok === false) {
                cancelPoll();
                reject(new Error(statusJson?.error || 'Processing failed'));
                return;
              }
              pollTimer = setTimeout(poll, intervalMs);
            } catch (pollErr) {
              cancelPoll();
              reject(pollErr);
            }
          };

          poll();
        });

        setStatus('Complete', false);
      } else {
        const form = new FormData();
        form.append('file', fileForProcessing);
        if (docType) form.append('docType', docType);
        const res = await Auth.fetch('/api/json-test/upload', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const contentType = res.headers.get('content-type') || '';
          let reason = res.statusText || 'Upload failed';
          if (contentType.includes('application/json')) {
            try { reason = (await res.json())?.error || reason; } catch { /* ignore */ }
          } else {
            try { reason = await res.text(); } catch { /* ignore */ }
          }
          throw new Error(reason || `Upload failed (${res.status})`);
        }
        const payload = await res.json();
        renderResult(payload);
        setStatus('Complete', false);
      }
    } catch (err) {
      console.error('JSON test upload failed', err);
      showError(err.message || 'Upload failed. Please try again.');
      output.textContent = 'Upload a document to view the parsed JSON payload.';
      setStatus('Ready', false);
    } finally {
      cancelPoll();
      trimReview.reset();
    }
  }

  function renderResult(payload) {
    if (!payload) return;
    try {
      output.textContent = JSON.stringify(payload, null, 2);
    } catch (err) {
      output.textContent = 'Unable to serialise payload.';
    }
    const label = payload?.classification?.label
      || payload?.classification?.entry?.label
      || payload?.classification?.entry?.key
      || null;
    if (label && labelBadge) {
      labelBadge.textContent = label;
      labelBadge.removeAttribute('hidden');
    }
  }
})();

function createTrimReview() {
  const section = document.getElementById('trim-review');
  if (!section) {
    return {
      async reviewIfNeeded(file) { return file; },
      reset() {},
    };
  }

  const meta = document.getElementById('trimMeta');
  const pagesTable = document.getElementById('trimPages');
  const previewFrame = document.getElementById('trimPreview');
  const btnApply = document.getElementById('btnTrimApply');
  const btnKeepAll = document.getElementById('btnTrimKeepAll');
  const btnReset = document.getElementById('btnTrimReset');
  const btnAnalyze = document.getElementById('btnTrimAnalyze');
  const btnDownload = document.getElementById('btnDownloadTrim');
  const threshold = document.getElementById('trimThreshold');
  const thresholdValue = document.getElementById('trimThresholdValue');
  const notice = document.getElementById('trimReviewNotice');
  const badge = document.getElementById('trimReviewBadge');

  const state = {
    active: false,
    file: null,
    analysis: null,
    suggestedPages: new Set(),
    selectedPages: new Set(),
    resolve: null,
    trimmedBlob: null,
    previewUrl: null,
    busy: false,
  };

  function resetPreview() {
    if (state.previewUrl) {
      try { URL.revokeObjectURL(state.previewUrl); } catch (err) { console.warn('Failed to revoke preview URL', err); }
      state.previewUrl = null;
    }
    state.trimmedBlob = null;
    if (previewFrame) previewFrame.src = '';
    if (btnDownload) {
      btnDownload.disabled = true;
      btnDownload.onclick = null;
    }
  }

  function setNotice(message, tone = 'info') {
    if (!notice) return;
    notice.classList.remove('alert-success', 'alert-danger', 'alert-info');
    if (!message) {
      notice.classList.add('alert-info');
      notice.classList.add('d-none');
      notice.textContent = '';
      return;
    }
    if (tone === 'success') notice.classList.add('alert-success');
    else if (tone === 'danger') notice.classList.add('alert-danger');
    else notice.classList.add('alert-info');
    notice.textContent = message;
    notice.classList.remove('d-none');
  }

  function setMeta(message) {
    if (!meta) return;
    meta.textContent = message || '';
  }

  function updateThresholdLabel() {
    if (threshold && thresholdValue) {
      thresholdValue.textContent = String(threshold.value ?? '');
    }
  }

  function hideSection() {
    section.classList.add('d-none');
  }

  function showSection() {
    section.classList.remove('d-none');
  }

  function normaliseSelectionIndices(list) {
    const set = new Set();
    const pageCount = state.analysis?.pageCount || 0;
    if (!Array.isArray(list)) return set;
    list.forEach((value) => {
      const idx = Number(value);
      if (Number.isInteger(idx) && idx >= 0 && idx < pageCount) {
        set.add(idx);
      }
    });
    return set;
  }

  function computeSuggestedFromThreshold(thresholdValue) {
    const analysis = state.analysis;
    if (!analysis) return new Set();
    const limit = Number.isFinite(thresholdValue) ? thresholdValue : Number(analysis.highThreshold) || 6;
    const set = new Set();
    const scores = Array.isArray(analysis.scores) ? analysis.scores : [];
    for (let i = 0; i < (analysis.pageCount || 0); i++) {
      const value = Number(scores[i] ?? 0);
      if (value >= limit) set.add(i);
    }
    if (analysis.transactionRange && Number.isInteger(analysis.transactionRange.start) && Number.isInteger(analysis.transactionRange.end)) {
      for (let i = analysis.transactionRange.start; i <= analysis.transactionRange.end; i++) {
        if (i >= 0 && i < analysis.pageCount) set.add(i);
      }
    }
    const margin = Number.isFinite(analysis.adjMargin) ? Math.max(0, Math.floor(analysis.adjMargin)) : 1;
    if (margin > 0 && set.size) {
      const extras = new Set();
      set.forEach((idx) => {
        for (let j = Math.max(0, idx - margin); j <= Math.min(analysis.pageCount - 1, idx + margin); j++) {
          extras.add(j);
        }
      });
      extras.forEach((idx) => set.add(idx));
    }
    const minFirst = Number.isFinite(analysis.minFirst) ? Math.max(0, Math.floor(analysis.minFirst)) : 0;
    for (let i = 0; i < Math.min(minFirst, analysis.pageCount || 0); i++) {
      set.add(i);
    }
    return set;
  }

  function updateRowStyles() {
    if (!state.analysis || !pagesTable) return;
    const rows = pagesTable.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      const input = row.querySelector('input[data-page]');
      if (!input) return;
      const idx = Number(input.getAttribute('data-page'));
      const isSelected = state.selectedPages.has(idx);
      const isSuggested = state.suggestedPages.has(idx);
      row.classList.toggle('table-success', isSelected);
      row.classList.toggle('table-warning', !isSelected && isSuggested);
      const badgeEl = row.querySelector('.trim-suggested');
      if (badgeEl) {
        badgeEl.classList.toggle('d-none', !(isSuggested && !isSelected));
      }
      input.checked = isSelected;
    });
  }

  function refreshControls() {
    updateThresholdLabel();
    const hasAnalysis = !!state.analysis;
    if (threshold) threshold.disabled = !hasAnalysis || state.busy;
    if (btnKeepAll) btnKeepAll.disabled = !hasAnalysis || state.busy;
    if (btnReset) btnReset.disabled = !hasAnalysis || state.busy;
    if (btnAnalyze) btnAnalyze.disabled = !hasAnalysis || state.busy;
    if (btnApply) btnApply.disabled = !hasAnalysis || state.busy || state.selectedPages.size === 0;

    if (hasAnalysis && meta) {
      const selectedList = Array.from(state.selectedPages).sort((a, b) => a - b).map((n) => n + 1).join(', ') || 'none';
      const suggestedList = Array.from(state.suggestedPages).sort((a, b) => a - b).map((n) => n + 1).join(', ') || 'none';
      const txn = state.analysis.transactionRange && Number.isInteger(state.analysis.transactionRange.start) && Number.isInteger(state.analysis.transactionRange.end)
        ? ` | Transaction block: ${state.analysis.transactionRange.start + 1}–${state.analysis.transactionRange.end + 1}`
        : '';
      meta.textContent = `Selected ${state.selectedPages.size}/${state.analysis.pageCount} pages (${selectedList}). Suggested: ${suggestedList}${txn}.`;
    }

    if (!hasAnalysis && meta) {
      meta.textContent = '';
    }

    updateRowStyles();
  }

  function renderPages() {
    if (!pagesTable) return;
    if (!state.analysis || !state.analysis.pageCount) {
      pagesTable.innerHTML = '<tbody><tr><td class="text-muted">No analysis available.</td></tr></tbody>';
      return;
    }
    const scores = Array.isArray(state.analysis.scores) ? state.analysis.scores : [];
    const flags = Array.isArray(state.analysis.flags) ? state.analysis.flags : [];
    let html = '<thead><tr><th style="width:55%;">Page</th><th style="width:15%;">Score</th><th>Flags</th></tr></thead><tbody>';
    for (let i = 0; i < state.analysis.pageCount; i++) {
      const isSelected = state.selectedPages.has(i);
      const isSuggested = state.suggestedPages.has(i);
      const rowClass = isSelected ? 'table-success' : (isSuggested ? 'table-warning' : '');
      const score = Number(scores[i] ?? 0);
      const high = Number.isFinite(state.analysis.highThreshold) ? state.analysis.highThreshold : 6;
      const low = Number.isFinite(state.analysis.lowThreshold) ? state.analysis.lowThreshold : 3;
      let badgeClass = 'bg-secondary';
      if (score >= high) badgeClass = 'bg-success';
      else if (score >= low) badgeClass = 'bg-warning text-dark';
      const scoreLabel = Number.isFinite(score) ? score.toFixed(1) : '0.0';
      const flag = flags[i] || {};
      const flagBadges = [];
      if (flag.hasHeader) flagBadges.push('<span class="badge bg-primary-subtle text-primary-emphasis me-1">Header</span>');
      if (flag.hasManyAmounts) flagBadges.push('<span class="badge bg-info-subtle text-info-emphasis me-1">Amounts</span>');
      if (flag.hasClosingBalance) flagBadges.push('<span class="badge bg-success-subtle text-success-emphasis me-1">Closing</span>');
      const flagsHtml = flagBadges.length ? flagBadges.join('') : '<span class="text-muted">—</span>';
      html += `<tr class="${rowClass}"><td><label class="d-flex align-items-center gap-2 mb-0"><input type="checkbox" data-page="${i}" ${isSelected ? 'checked' : ''}> <span>Page ${i + 1}</span><span class="badge bg-warning-subtle text-dark trim-suggested${isSuggested && !isSelected ? '' : ' d-none'}">Suggested</span></label></td><td><span class="badge ${badgeClass}">${scoreLabel}</span></td><td>${flagsHtml}</td></tr>`;
    }
    html += '</tbody>';
    pagesTable.innerHTML = html;
    pagesTable.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', (event) => {
        if (state.busy) return;
        const idx = Number(event.target.getAttribute('data-page'));
        if (!Number.isInteger(idx)) return;
        if (event.target.checked) state.selectedPages.add(idx);
        else state.selectedPages.delete(idx);
        updateRowStyles();
        refreshControls();
        setNotice('', 'info');
      });
    });
    updateRowStyles();
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/pdf' });
  }

  function enableDownload(blob, filename) {
    if (!btnDownload) return;
    btnDownload.disabled = false;
    btnDownload.onclick = () => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'trimmed.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }

  function setBusy(isBusy) {
    state.busy = !!isBusy;
    refreshControls();
  }

  async function analyseFile(file, onProgress) {
    onProgress?.('Analysing for trim…', true);
    const form = new FormData();
    form.append('file', file);
    const response = await Auth.fetch('/api/pdf/analyze', { method: 'POST', body: form });
    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error('Failed to parse trim analysis response.');
    }
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || 'Trim analysis failed.');
    }
    const pageCount = Number(payload.pageCount) || 0;
    const transactionRange = payload.transactionRange && Number.isInteger(payload.transactionRange.start) && Number.isInteger(payload.transactionRange.end)
      ? { start: payload.transactionRange.start, end: payload.transactionRange.end }
      : null;
    return {
      pageCount,
      scores: Array.isArray(payload.scores) ? payload.scores : [],
      flags: Array.isArray(payload.flags) ? payload.flags : [],
      transactionRange,
      minFirst: Number.isFinite(Number(payload.minFirst)) ? Number(payload.minFirst) : undefined,
      adjMargin: Number.isFinite(Number(payload.adjMargin)) ? Number(payload.adjMargin) : undefined,
      highThreshold: Number.isFinite(Number(payload.highThreshold)) ? Number(payload.highThreshold) : undefined,
      lowThreshold: Number.isFinite(Number(payload.lowThreshold)) ? Number(payload.lowThreshold) : undefined,
      keepAllRatio: Number.isFinite(Number(payload.keepAllRatio)) ? Number(payload.keepAllRatio) : undefined,
      suggestedKeptPages: Array.isArray(payload.suggestedKeptPages) ? payload.suggestedKeptPages : [],
    };
  }

  function makeTrimmedFilename(originalName) {
    if (!originalName) return 'trimmed.pdf';
    const dot = originalName.lastIndexOf('.');
    if (dot === -1) return `${originalName}-trimmed.pdf`;
    return `${originalName.slice(0, dot)}-trimmed${originalName.slice(dot)}`;
  }

  async function applySelection() {
    if (!state.analysis) {
      setNotice('Analyse the PDF before confirming a selection.', 'danger');
      return;
    }
    if (!state.file) {
      setNotice('Original PDF unavailable for trimming.', 'danger');
      return;
    }
    const pages = Array.from(state.selectedPages).sort((a, b) => a - b);
    if (!pages.length) {
      setNotice('Select at least one page to keep.', 'danger');
      return;
    }

    if (pages.length === state.analysis.pageCount) {
      setNotice('Keeping all pages. Continuing without trimming.', 'info');
      setMeta('All pages will be processed.');
      resolveReview(state.file);
      return;
    }

    setBusy(true);
    setMeta('Building trimmed PDF…');
    setNotice('', 'info');
    try {
      const form = new FormData();
      form.append('file', state.file);
      form.append('keptPages', JSON.stringify(pages));
      const response = await Auth.fetch('/api/pdf/apply', { method: 'POST', body: form });
      let payload = null;
      try {
        payload = await response.json();
      } catch (err) {
        throw new Error('Failed to parse trim response.');
      }
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Unable to apply trim.');
      }
      resetPreview();
      const blob = await base64ToBlob(payload.data_base64, payload.mime);
      state.trimmedBlob = blob;
      const filename = payload.filename || makeTrimmedFilename(state.file.name);
      state.previewUrl = URL.createObjectURL(blob);
      if (previewFrame) previewFrame.src = state.previewUrl;
      enableDownload(blob, filename);
      setMeta('Trim applied successfully.');
      setNotice('Trim confirmed. Continuing with the trimmed document.', 'success');
      resolveReview(new File([blob], filename, { type: blob.type || 'application/pdf' }));
    } catch (err) {
      console.error('Trim apply failed', err);
      setNotice(err?.message || 'Unable to trim this PDF right now.', 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function reanalyse() {
    if (!state.file) return;
    try {
      setBusy(true);
      setMeta('Re-analysing pages…');
      setNotice('', 'info');
      const analysis = await analyseFile(state.file, null);
      state.analysis = analysis;
      if (threshold && analysis.highThreshold != null && analysis.highThreshold !== '') {
        const nextThreshold = Number(analysis.highThreshold);
        if (!Number.isNaN(nextThreshold)) {
          threshold.value = String(nextThreshold);
        }
      }
      updateThresholdLabel();
      state.suggestedPages = normaliseSelectionIndices(analysis.suggestedKeptPages || []);
      if (!state.suggestedPages.size) {
        const thresholdValue = Number(threshold?.value);
        state.suggestedPages = computeSuggestedFromThreshold(thresholdValue);
      }
      if (!state.suggestedPages.size && analysis.pageCount) {
        state.suggestedPages = new Set(Array.from({ length: analysis.pageCount }, (_, i) => i));
      }
      state.selectedPages = new Set(state.suggestedPages);
      renderPages();
      refreshControls();
      setMeta('Review suggested pages to keep.');
      setNotice('Trim suggestions refreshed.', 'info');
    } catch (err) {
      console.error('Trim re-analysis failed', err);
      setNotice(err?.message || 'Unable to refresh trim suggestions.', 'danger');
    } finally {
      setBusy(false);
    }
  }

  function resolveReview(fileForProcessing) {
    if (typeof state.resolve === 'function') {
      const resolver = state.resolve;
      state.resolve = null;
      state.active = false;
      resolver(fileForProcessing);
    }
  }

  function clearState() {
    state.active = false;
    state.file = null;
    state.analysis = null;
    state.suggestedPages = new Set();
    state.selectedPages = new Set();
    state.resolve = null;
    setMeta('');
    setNotice('', 'info');
    resetPreview();
    if (pagesTable) pagesTable.innerHTML = '';
    if (threshold) {
      threshold.value = '6';
      threshold.disabled = true;
    }
    if (btnApply) btnApply.disabled = true;
    if (btnKeepAll) btnKeepAll.disabled = true;
    if (btnReset) btnReset.disabled = true;
    if (btnAnalyze) btnAnalyze.disabled = true;
    if (badge) badge.textContent = 'Review required';
    hideSection();
  }

  if (threshold) {
    threshold.addEventListener('input', () => {
      updateThresholdLabel();
      if (!state.analysis || state.busy) return;
      state.suggestedPages = computeSuggestedFromThreshold(Number(threshold.value));
      if (!state.suggestedPages.size && state.analysis.pageCount) {
        state.suggestedPages = new Set(Array.from({ length: state.analysis.pageCount }, (_, i) => i));
      }
      state.selectedPages = new Set(state.suggestedPages);
      renderPages();
      refreshControls();
      setNotice('Suggestions updated for the new threshold.', 'info');
    });
  }

  if (btnApply) {
    btnApply.addEventListener('click', () => {
      if (state.busy) return;
      applySelection();
    });
  }

  if (btnKeepAll) {
    btnKeepAll.addEventListener('click', () => {
      if (!state.analysis || state.busy) return;
      state.selectedPages = new Set(Array.from({ length: state.analysis.pageCount }, (_, i) => i));
      renderPages();
      refreshControls();
      setNotice('All pages selected. Confirm to continue without trimming.', 'info');
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (!state.analysis || state.busy) return;
      state.selectedPages = new Set(state.suggestedPages);
      renderPages();
      refreshControls();
      setNotice('', 'info');
    });
  }

  if (btnAnalyze) {
    btnAnalyze.addEventListener('click', () => {
      if (state.busy) return;
      reanalyse();
    });
  }

  return {
    async reviewIfNeeded(file, { onProgress } = {}) {
      if (!file) return null;
      clearState();
      try {
        const analysis = await analyseFile(file, onProgress);
        if (!analysis.pageCount || analysis.pageCount <= 4) {
          onProgress?.('Processing…', true);
          return file;
        }

        state.file = file;
        state.analysis = analysis;
        showSection();
        if (badge) badge.textContent = `${analysis.pageCount} pages`;
        if (threshold && analysis.highThreshold != null && analysis.highThreshold !== '') {
          const nextThreshold = Number(analysis.highThreshold);
          if (!Number.isNaN(nextThreshold)) {
            threshold.value = String(nextThreshold);
          }
        }
        updateThresholdLabel();
        state.suggestedPages = normaliseSelectionIndices(analysis.suggestedKeptPages || []);
        if (!state.suggestedPages.size) {
          state.suggestedPages = computeSuggestedFromThreshold(Number(threshold?.value));
        }
        if (!state.suggestedPages.size && analysis.pageCount) {
          state.suggestedPages = new Set(Array.from({ length: analysis.pageCount }, (_, i) => i));
        }
        state.selectedPages = new Set(state.suggestedPages);
        renderPages();
        refreshControls();
        setMeta('Review the suggested pages to keep before continuing.');
        setNotice('Page review required because the document is longer than 4 pages.', 'info');
        onProgress?.('Awaiting trim review…', true);
        state.active = true;
        return await new Promise((resolve) => {
          state.resolve = resolve;
        });
      } catch (err) {
        clearState();
        throw err;
      }
    },
    reset() {
      clearState();
    },
  };
}
