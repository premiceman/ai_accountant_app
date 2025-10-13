(function () {
  const dropzone = document.getElementById('json-test-dropzone');
  const fileInput = dropzone?.querySelector('input[type="file"]');
  const output = document.getElementById('json-test-output');
  const errorBox = document.getElementById('json-test-error');
  const statusPill = document.getElementById('json-test-status');
  const labelBadge = document.getElementById('json-test-label');
  const asyncToggleEl = document.getElementById('asyncMode');

  const trimReview = createTrimReview();
  const jsonErrorEditor = createJsonErrorEditor({
    onApply: (patchedPayload, { data }) => {
      try {
        renderResult(patchedPayload, { force: true });
        clearError();
        const previewSource = patchedPayload?.data ?? patchedPayload ?? data;
        if (previewSource) {
          output.textContent = JSON.stringify(previewSource, null, 2);
        }
        setStatus('Manual fixes applied', false);
      } catch (renderErr) {
        console.error('Failed to apply manual JSON fixes', renderErr);
        showError(renderErr?.message || 'Unable to update JSON preview with the new data.');
      }
    },
  });
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

  let lastPayload = null;

  async function handleFile(file) {
    clearError();
    jsonErrorEditor.reset();
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

    const docTypeEl = document.getElementById('docType');
    const docType = docTypeEl ? docTypeEl.value : (window.DEFAULT_DOC_TYPE || 'bank');

    try {
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
                await renderResult(statusJson.data, { docType });
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

      } else {
        const form = new FormData();
        form.append('file', fileForProcessing);
        if (docType) form.append('docType', docType);
        const res = await Auth.fetch('/api/json-test/upload', {
          method: 'POST',
          body: form,
        });
        const payload = await parseJsonTestResponse(res);
        renderResult(payload);
        setStatus('Complete', false);
      }
    } catch (err) {
      console.error('JSON test upload failed', err);
      const handled = jsonErrorEditor.openForMissingFields(err, {
        docType,
        sourcePayload: err?.payload || err?.data || lastPayload,
      });
      if (handled) {
        showError('Required fields are missing. Complete the highlighted values to finish the JSON record.');
        const preview = jsonErrorEditor.currentData();
        if (preview) {
          try {
            output.textContent = JSON.stringify(preview, null, 2);
          } catch (serialiseErr) {
            console.warn('Unable to preview manual JSON data', serialiseErr);
            output.textContent = 'Unable to preview current JSON structure.';
          }
        } else {
          output.textContent = 'Fill in the required fields to generate the JSON payload.';
        }
      } else {
        showError(err.message || 'Upload failed. Please try again.');
        output.textContent = 'Upload a document to view the parsed JSON payload.';
      }
      setStatus('Ready', false);
    } finally {
      cancelPoll();
      trimReview.reset();
    }
  }

  function normalisePayloadForDisplay(payload) {
    if (payload == null) {
      return { processedPayload: payload, shouldStandardize: false };
    }

    if (typeof payload === 'object') {
      if (Object.prototype.hasOwnProperty.call(payload, 'data') && typeof payload.data !== 'undefined') {
        return { processedPayload: payload.data, shouldStandardize: false };
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'record') && typeof payload.record !== 'undefined') {
        return { processedPayload: payload.record, shouldStandardize: false };
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'payload') && typeof payload.payload !== 'undefined') {
        return { processedPayload: payload.payload, shouldStandardize: false };
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'result') && typeof payload.result !== 'undefined') {
        return { processedPayload: payload.result, shouldStandardize: false };
      }
    }

    return { processedPayload: payload, shouldStandardize: false };
  }

  function renderResult(payload, { force = false } = {}) {
    if (!payload) return;
    if (!force && payload?.ok === false) {
      const err = new Error(payload?.error || 'Processing failed');
      err.code = payload?.code;
      err.payload = payload;
      err.data = payload?.data || payload?.record || payload?.payload || null;
      throw err;
    }
    const { processedPayload, shouldStandardize } = normalisePayloadForDisplay(payload);
    lastPayload = payload;
    jsonErrorEditor.reset();
    try {
      const preview = JSON.stringify(processedPayload, null, 2);
      if (preview != null) {
        output.textContent = preview;
      } else {
        const fallbackPreview = JSON.stringify(payload, null, 2);
        output.textContent = fallbackPreview != null ? fallbackPreview : String(payload);
      }
    } catch (err) {
      output.textContent = 'Unable to serialise payload.';
    }
    const labelSource = processedPayload && typeof processedPayload === 'object' ? processedPayload : payload;
    const label = labelSource?.classification?.label
      || labelSource?.classification?.entry?.label
      || labelSource?.classification?.entry?.key
      || null;
    if (label && labelBadge) {
      labelBadge.textContent = label;
      labelBadge.removeAttribute('hidden');
    }
    if (!shouldStandardize) {
      setStatus('Complete', false);
    }
    return processedPayload;
  }
  async function parseJsonTestResponse(res) {
    if (!res) throw new Error('No response received');
    const contentType = res.headers?.get?.('content-type') || '';
    let payload = null;
    let rawText = null;

    if (contentType.includes('application/json')) {
      try {
        payload = await res.json();
      } catch (err) {
        throw new Error('Failed to parse server response.');
      }
    } else {
      try {
        rawText = await res.text();
        if (rawText) {
          try {
            payload = JSON.parse(rawText);
          } catch (jsonErr) {
            payload = null;
          }
        }
      } catch (err) {
        rawText = null;
      }
    }

    if (!res.ok || (payload && payload.ok === false)) {
      const message = payload?.error
        || payload?.message
        || rawText
        || res.statusText
        || `Upload failed (${res.status})`;
      const error = new Error(message || 'Upload failed.');
      if (payload && typeof payload === 'object') {
        error.payload = payload;
        error.code = payload.code;
        error.data = payload.data || payload.record || payload.payload || null;
      }
      throw error;
    }

    if (payload !== null) return payload;

    if (rawText) {
      try {
        return JSON.parse(rawText);
      } catch (err) {
        return { ok: true, raw: rawText };
      }
    }

    throw new Error('Empty response from server.');
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


function createJsonErrorEditor(options = {}) {
  const overlay = document.getElementById('jsonErrorOverlay');
  if (!overlay) {
    return {
      reset() {},
      openForMissingFields() { return false; },
      currentData() { return null; },
    };
  }

  const fieldsContainer = overlay.querySelector('[data-json-error-fields]');
  const messageEl = overlay.querySelector('#jsonErrorMessage');
  const closeBtn = overlay.querySelector('[data-dismiss-json-error]');
  const form = overlay.querySelector('#jsonErrorForm');
  const addFieldBtn = overlay.querySelector('[data-add-json-field]');

  const REQUIRED_FIELDS = {
    bank: ['period.startDate', 'period.endDate'],
    payslip: ['period.startDate', 'period.endDate', 'period.issueDate'],
  };

  const state = {
    basePayload: null,
    dataLocation: 'data',
    data: {},
    docType: null,
    message: '',
    addedFieldCount: 0,
  };

  function deepClone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      console.warn('Failed to clone value', err);
      return value;
    }
  }

  function detectData(payload) {
    if (payload == null) return { location: 'self', data: {} };
    if (typeof payload === 'object') {
      if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return { location: 'data', data: payload.data };
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'payload')) {
        return { location: 'payload', data: payload.payload };
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'record')) {
        return { location: 'record', data: payload.record };
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'result')) {
        return { location: 'result', data: payload.result };
      }
      if (!payload.ok && Object.prototype.hasOwnProperty.call(payload, 'json')) {
        return { location: 'json', data: payload.json };
      }
      return { location: 'self', data: payload };
    }
    return { location: 'self', data: payload };
  }

  function detectValueType(path, value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') {
      const lower = (path || '').toLowerCase();
      if (lower.includes('date')) {
        const iso = toISODate(value);
        if (iso) return 'date';
      }
      return 'string';
    }
    return 'string';
  }

  function toISODate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  function normaliseDisplayValue(value, type) {
    if (value == null) return '';
    if (type === 'date') {
      const iso = toISODate(value);
      return iso || '';
    }
    if (type === 'object' || type === 'array') {
      try {
        return JSON.stringify(value);
      } catch (err) {
        return String(value);
      }
    }
    return String(value);
  }

  function flatten(data, prefix = '') {
    const entries = [];
    const pushEntry = (path, value) => {
      entries.push({ path, value, type: detectValueType(path, value) });
    };

    if (data === null) {
      pushEntry(prefix || '(root)', null);
      return entries;
    }

    if (typeof data !== 'object') {
      pushEntry(prefix || '(value)', data);
      return entries;
    }

    if (Array.isArray(data)) {
      if (!data.length) {
        pushEntry(prefix || '(array)', '');
        return entries;
      }
      data.forEach((value, index) => {
        const nextPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
        if (value !== null && typeof value === 'object') {
          entries.push(...flatten(value, nextPrefix));
        } else {
          pushEntry(nextPrefix, value);
        }
      });
      return entries;
    }

    const keys = Object.keys(data);
    if (!keys.length) {
      pushEntry(prefix || '(root)', '');
      return entries;
    }

    keys.forEach((key) => {
      const value = data[key];
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object') {
        entries.push(...flatten(value, nextPrefix));
      } else {
        pushEntry(nextPrefix, value);
      }
    });
    return entries;
  }

  function showOverlay() {
    overlay.classList.remove('d-none');
    overlay.style.display = 'flex';
  }

  function hideOverlay() {
    overlay.classList.add('d-none');
    overlay.style.display = 'none';
    state.basePayload = null;
    state.dataLocation = 'data';
    state.data = {};
    state.docType = null;
    state.message = '';
    state.addedFieldCount = 0;
    if (fieldsContainer) fieldsContainer.innerHTML = '';
  }

  function splitPath(path) {
    const segments = [];
    let buffer = '';
    let inBracket = false;
    for (let i = 0; i < path.length; i += 1) {
      const char = path[i];
      if (char === '.' && !inBracket) {
        if (buffer) {
          segments.push(buffer);
          buffer = '';
        }
        continue;
      }
      if (char === '[') {
        if (buffer) {
          segments.push(buffer);
          buffer = '';
        }
        inBracket = true;
        continue;
      }
      if (char === ']') {
        if (buffer) {
          segments.push(buffer);
          buffer = '';
        }
        inBracket = false;
        continue;
      }
      buffer += char;
    }
    if (buffer) segments.push(buffer);
    return segments;
  }

  function setByPath(target, path, value) {
    const segments = splitPath(path);
    if (!segments.length) return;
    let current = target;
    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1;
      const nextSegment = segments[index + 1];
      const nextIsIndex = nextSegment != null && !Number.isNaN(Number(nextSegment));
      const isIndex = !Number.isNaN(Number(segment));
      if (isLast) {
        if (isIndex && Array.isArray(current)) {
          current[Number(segment)] = value;
        } else {
          current[segment] = value;
        }
        return;
      }
      if (isIndex) {
        const idx = Number(segment);
        if (!Array.isArray(current)) {
          if (typeof current[segment] !== 'object') {
            current[segment] = nextIsIndex ? [] : {};
          }
          current = current[segment];
        } else {
          if (!current[idx] || typeof current[idx] !== 'object') {
            current[idx] = nextIsIndex ? [] : {};
          }
          current = current[idx];
        }
      } else {
        if (!current[segment] || typeof current[segment] !== 'object') {
          current[segment] = nextIsIndex ? [] : {};
        }
        current = current[segment];
      }
    });
  }

  function parseValue(inputValue, type) {
    if (type === 'number') {
      const number = Number(inputValue);
      return Number.isNaN(number) ? null : number;
    }
    if (type === 'boolean') {
      if (typeof inputValue === 'string') {
        const normalised = inputValue.trim().toLowerCase();
        if (normalised === 'true') return true;
        if (normalised === 'false') return false;
      }
      return !!inputValue;
    }
    if (type === 'date') {
      return inputValue ? new Date(inputValue).toISOString().slice(0, 10) : '';
    }
    if (type === 'json') {
      try {
        return JSON.parse(inputValue);
      } catch (err) {
        return inputValue;
      }
    }
    if (type === 'null') {
      return inputValue ? inputValue : null;
    }
    if (!type || type === 'auto') {
      if (inputValue === 'true' || inputValue === 'false') return inputValue === 'true';
      const number = Number(inputValue);
      if (!Number.isNaN(number) && inputValue !== '') return number;
      return inputValue;
    }
    return inputValue;
  }

  function buildFieldRow(entry, required) {
    const row = document.createElement('div');
    row.className = 'json-error-field-row';

    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = entry.path;
    label.setAttribute('for', `json-error-field-${state.addedFieldCount}`);
    if (required) {
      const badge = document.createElement('span');
      badge.className = 'badge bg-danger-subtle text-danger-emphasis ms-2';
      badge.textContent = 'Required';
      label.appendChild(badge);
    }

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'd-flex gap-2 align-items-center';

    const valueInput = document.createElement('input');
    valueInput.className = 'form-control';
    valueInput.dataset.type = entry.type;
    valueInput.dataset.valueInput = 'true';
    valueInput.id = `json-error-field-${state.addedFieldCount}`;
    valueInput.placeholder = 'Enter value';
    valueInput.value = normaliseDisplayValue(entry.value, entry.type);
    if (required) valueInput.required = true;
    if (entry.type === 'number') valueInput.type = 'number';
    else if (entry.type === 'date') valueInput.type = 'date';
    else valueInput.type = 'text';

    if (entry.type === 'boolean') {
      valueInput.placeholder = 'true / false';
    }

    const hiddenPath = document.createElement('input');
    hiddenPath.type = 'hidden';
    hiddenPath.dataset.pathInput = 'true';
    hiddenPath.value = entry.path;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-link text-danger p-0 ms-2';
    removeBtn.innerHTML = '<i class="bi bi-x-circle"></i>';
    removeBtn.title = 'Remove field';
    removeBtn.addEventListener('click', () => row.remove());
    removeBtn.hidden = required;

    inputWrapper.append(valueInput, removeBtn, hiddenPath);
    row.append(label, inputWrapper);
    state.addedFieldCount += 1;
    return row;
  }

  function buildCustomFieldRow() {
    const row = document.createElement('div');
    row.className = 'json-error-field-row';
    row.dataset.customField = 'true';

    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = 'New field';
    label.setAttribute('for', `json-error-custom-${state.addedFieldCount}`);

    const pathInput = document.createElement('input');
    pathInput.className = 'form-control';
    pathInput.placeholder = 'e.g. period.startDate';
    pathInput.dataset.customPath = 'true';
    pathInput.required = true;

    const valueInput = document.createElement('input');
    valueInput.className = 'form-control';
    valueInput.placeholder = 'Value';
    valueInput.dataset.type = 'auto';
    valueInput.dataset.valueInput = 'true';
    valueInput.id = `json-error-custom-${state.addedFieldCount}`;
    valueInput.required = true;

    const typeSelect = document.createElement('select');
    typeSelect.className = 'form-select';
    typeSelect.dataset.typeSelect = 'true';
    ['string', 'number', 'boolean', 'date', 'json'].forEach((type) => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
      typeSelect.appendChild(option);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-link text-danger p-0';
    removeBtn.innerHTML = '<i class="bi bi-x-circle"></i>';
    removeBtn.title = 'Remove field';
    removeBtn.addEventListener('click', () => row.remove());

    const valueRow = document.createElement('div');
    valueRow.className = 'd-flex flex-wrap gap-2';
    valueRow.append(valueInput, typeSelect, removeBtn);

    const body = document.createElement('div');
    body.className = 'd-flex flex-column gap-2';
    body.append(pathInput, valueRow);

    row.append(label, body);
    state.addedFieldCount += 1;
    return row;
  }

  function gatherData() {
    const result = state.data && typeof state.data === 'object' ? deepClone(state.data) : {};
    if (!fieldsContainer) return result;
    const rows = fieldsContainer.querySelectorAll('.json-error-field-row');
    rows.forEach((row) => {
      const pathInput = row.querySelector('input[data-path-input="true"]');
      const customPath = row.querySelector('input[data-custom-path="true"]');
      const select = row.querySelector('select[data-type-select="true"]');
      const valueInput = row.querySelector('input[data-value-input="true"]');
      const path = customPath ? customPath.value.trim() : pathInput?.value?.trim();
      if (!path) return;
      const type = select ? select.value : valueInput?.dataset.type || 'string';
      const value = parseValue(valueInput?.value ?? '', type);
      setByPath(result, path, value);
    });
    state.data = deepClone(result);
    return result;
  }

  function buildEntries(data, requiredFields) {
    if (!fieldsContainer) return;
    fieldsContainer.innerHTML = '';
    state.addedFieldCount = 0;
    const entries = flatten(data);
    const requiredSet = new Set(requiredFields || []);
    requiredSet.forEach((path) => {
      if (!entries.some((entry) => entry.path === path)) {
        entries.push({ path, value: '', type: detectValueType(path, '') });
      }
    });
    entries.forEach((entry) => {
      const required = requiredSet.has(entry.path);
      fieldsContainer.appendChild(buildFieldRow(entry, required));
    });
  }

  function openForMissingFields(error, { docType = 'bank', sourcePayload = null } = {}) {
    const message = (error?.message || '').toLowerCase();
    if (!message) return false;
    if (!message.includes('missing') && !message.includes('required')) return false;

    const payload = sourcePayload && typeof sourcePayload === 'object'
      ? deepClone(sourcePayload)
      : (error?.payload && typeof error.payload === 'object' ? deepClone(error.payload) : null);

    const { location, data } = detectData(payload || {});
    state.basePayload = payload || {};
    state.dataLocation = location;
    state.data = data && typeof data === 'object' ? deepClone(data) : {};
    state.docType = docType;
    state.message = error?.message || 'Required fields missing';

    if (messageEl) messageEl.textContent = state.message;

    const requiredList = new Set(REQUIRED_FIELDS[docType] || []);
    if (message.includes('period')) {
      requiredList.add('period.startDate');
      requiredList.add('period.endDate');
    }

    buildEntries(state.data, Array.from(requiredList));
    showOverlay();
    return true;
  }

  function currentData() {
    return deepClone(state.data);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const updated = gatherData();
    const payloadClone = state.basePayload ? deepClone(state.basePayload) : {};
    if (!payloadClone || typeof payloadClone !== 'object' || state.dataLocation === 'self') {
      options.onApply?.(updated, { data: updated });
    } else {
      if (state.dataLocation === 'data') payloadClone.data = updated;
      else if (state.dataLocation === 'payload') payloadClone.payload = updated;
      else if (state.dataLocation === 'record') payloadClone.record = updated;
      else if (state.dataLocation === 'result') payloadClone.result = updated;
      else if (state.dataLocation === 'json') payloadClone.json = updated;
      else payloadClone[state.dataLocation] = updated;
      if (payloadClone && payloadClone.ok === false) payloadClone.ok = true;
      delete payloadClone.error;
      delete payloadClone.code;
      options.onApply?.(payloadClone, { data: updated });
    }
    hideOverlay();
  }

  function handleAddField() {
    if (!fieldsContainer) return;
    fieldsContainer.appendChild(buildCustomFieldRow());
  }

  if (closeBtn) closeBtn.addEventListener('click', hideOverlay);
  if (form) form.addEventListener('submit', handleSubmit);
  if (addFieldBtn) addFieldBtn.addEventListener('click', handleAddField);

  return {
    openForMissingFields,
    reset: hideOverlay,
    currentData,
  };
}
