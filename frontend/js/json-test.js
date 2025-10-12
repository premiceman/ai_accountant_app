(function () {
  const dropzone = document.getElementById('json-test-dropzone');
  const fileInput = dropzone?.querySelector('input[type="file"]');
  const output = document.getElementById('json-test-output');
  const errorBox = document.getElementById('json-test-error');
  const statusPill = document.getElementById('json-test-status');
  const labelBadge = document.getElementById('json-test-label');

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
    setStatus('Processing…', true);
    labelBadge?.setAttribute('hidden', '');
    output.textContent = 'Analysing document…';
    try {
      const form = new FormData();
      form.append('file', file);
      const docTypeEl = document.getElementById('docType');
      if (docTypeEl) form.append('docType', docTypeEl.value); // 'bank' | 'payslip'
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
    } catch (err) {
      console.error('JSON test upload failed', err);
      showError(err.message || 'Upload failed. Please try again.');
      output.textContent = 'Upload a document to view the parsed JSON payload.';
      setStatus('Ready', false);
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

(function(){
  const trimLabSection = document.getElementById('trim-lab');
  if (!trimLabSection) return;
  const trimFile = document.getElementById('trimFile');
  const btnAnalyze = document.getElementById('btnTrimAnalyze');
  const btnApply = document.getElementById('btnTrimApply');
  const btnKeepAll = document.getElementById('btnTrimKeepAll');
  const btnReset = document.getElementById('btnTrimReset');
  const trimMeta = document.getElementById('trimMeta');
  const trimPages = document.getElementById('trimPages');
  const trimPreview = document.getElementById('trimPreview');
  const btnDownloadTrim = document.getElementById('btnDownloadTrim');
  const trimThreshold = document.getElementById('trimThreshold');
  const trimThresholdValue = document.getElementById('trimThresholdValue');

  let analysis = null;
  let suggestedPages = new Set();
  let selectedPages = new Set();
  let originalFile = null;
  let trimmedBlob = null;
  let previewUrl = null;

  function updateThresholdLabel() {
    if (trimThresholdValue && trimThreshold) {
      trimThresholdValue.textContent = String(trimThreshold.value ?? '');
    }
  }

  async function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/pdf' });
  }

  function setMeta(message) {
    if (!trimMeta) return;
    trimMeta.textContent = message || '';
  }

  function resetPreview() {
    trimmedBlob = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if (trimPreview) trimPreview.src = '';
    if (btnDownloadTrim) {
      btnDownloadTrim.disabled = true;
      btnDownloadTrim.onclick = null;
    }
  }

  function normaliseSelectionIndices(list) {
    const set = new Set();
    if (!analysis || !Array.isArray(list)) return set;
    const max = analysis.pageCount || 0;
    list.forEach((value) => {
      const idx = Number(value);
      if (Number.isInteger(idx) && idx >= 0 && idx < max) {
        set.add(idx);
      }
    });
    return set;
  }

  function updateRowStyles() {
    if (!analysis || !trimPages) return;
    const rows = trimPages.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      const input = row.querySelector('input[data-page]');
      if (!input) return;
      const idx = Number(input.getAttribute('data-page'));
      const isSelected = selectedPages.has(idx);
      const isSuggested = suggestedPages.has(idx);
      row.classList.toggle('table-success', isSelected);
      row.classList.toggle('table-warning', !isSelected && isSuggested);
      const badge = row.querySelector('.trim-suggested');
      if (badge) {
        badge.classList.toggle('d-none', !(isSuggested && !isSelected));
      }
      input.checked = isSelected;
    });
  }

  function refreshControls() {
    updateThresholdLabel();
    if (!analysis) {
      if (btnApply) btnApply.disabled = true;
      if (btnKeepAll) btnKeepAll.disabled = true;
      if (btnReset) btnReset.disabled = true;
      if (trimThreshold) trimThreshold.disabled = true;
      setMeta('Select a PDF and click Analyze to review pages.');
      return;
    }
    if (trimThreshold) trimThreshold.disabled = false;
    if (btnKeepAll) btnKeepAll.disabled = false;
    if (btnReset) btnReset.disabled = false;
    if (btnApply) btnApply.disabled = selectedPages.size === 0;

    if (trimMeta) {
      const selectedList = Array.from(selectedPages).sort((a, b) => a - b).map((n) => n + 1).join(', ') || 'none';
      const suggestedList = Array.from(suggestedPages).sort((a, b) => a - b).map((n) => n + 1).join(', ') || 'none';
      const txn = analysis.transactionRange && Number.isInteger(analysis.transactionRange.start) && Number.isInteger(analysis.transactionRange.end)
        ? ` | Transaction block: ${analysis.transactionRange.start + 1}–${analysis.transactionRange.end + 1}`
        : '';
      trimMeta.textContent = `Selected ${selectedPages.size}/${analysis.pageCount} pages (${selectedList}). Suggested: ${suggestedList}${txn}.`;
    }
    updateRowStyles();
  }

  function renderPages() {
    if (!trimPages) return;
    if (!analysis || !analysis.pageCount) {
      trimPages.innerHTML = '<p class="text-muted">Analyze a bank statement PDF to inspect page scores.</p>';
      return;
    }
    const scores = Array.isArray(analysis.scores) ? analysis.scores : [];
    const flags = Array.isArray(analysis.flags) ? analysis.flags : [];
    let html = '<table class="table table-sm align-middle mb-0"><thead><tr><th style="width:55%;">Page</th><th style="width:15%;">Score</th><th>Flags</th></tr></thead><tbody>';
    for (let i = 0; i < analysis.pageCount; i++) {
      const isSelected = selectedPages.has(i);
      const isSuggested = suggestedPages.has(i);
      const rowClass = isSelected ? 'table-success' : (isSuggested ? 'table-warning' : '');
      const score = Number(scores[i] ?? 0);
      const high = Number.isFinite(analysis.highThreshold) ? analysis.highThreshold : 6;
      const low = Number.isFinite(analysis.lowThreshold) ? analysis.lowThreshold : 3;
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
    html += '</tbody></table>';
    trimPages.innerHTML = html;
    trimPages.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', (event) => {
        const idx = Number(event.target.getAttribute('data-page'));
        if (!Number.isInteger(idx)) return;
        if (event.target.checked) selectedPages.add(idx);
        else selectedPages.delete(idx);
        updateRowStyles();
        refreshControls();
      });
    });
    updateRowStyles();
  }

  function computeSuggestedFromThreshold(threshold) {
    if (!analysis) return new Set();
    const limit = Number.isFinite(threshold) ? threshold : Number(analysis.highThreshold) || 6;
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

  if (trimLabSection && window.Auth && typeof Auth.fetch === 'function') {
    Auth.fetch('/api/flags', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((flags) => {
        if (flags && flags.JSON_TEST_ENABLE_TRIMLAB === false) {
          trimLabSection.style.display = 'none';
        }
      })
      .catch(() => {});
  }

  if (trimThreshold) {
    trimThreshold.addEventListener('input', () => {
      updateThresholdLabel();
      if (!analysis) return;
      const threshold = Number(trimThreshold.value);
      suggestedPages = computeSuggestedFromThreshold(threshold);
      selectedPages = new Set(suggestedPages);
      renderPages();
      refreshControls();
    });
  }

  if (btnAnalyze) {
    btnAnalyze.addEventListener('click', async () => {
      const file = trimFile?.files?.[0];
      if (!file) {
        setMeta('Choose a PDF first.');
        return;
      }
      originalFile = file;
      analysis = null;
      suggestedPages = new Set();
      selectedPages = new Set();
      resetPreview();
      if (trimPages) trimPages.innerHTML = '';
      if (btnApply) btnApply.disabled = true;
      if (btnKeepAll) btnKeepAll.disabled = true;
      if (btnReset) btnReset.disabled = true;
      if (trimThreshold) trimThreshold.disabled = true;
      setMeta('Analyzing…');

      try {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/pdf/analyze', { method: 'POST', body: form });
        const payload = await response.json();
        if (!payload?.ok) {
          setMeta('Analyze failed: ' + (payload?.error || 'Unknown error'));
          renderPages();
          return;
        }
        const pageCount = Number(payload.pageCount) || 0;
        const transactionRange = payload.transactionRange && Number.isInteger(payload.transactionRange.start) && Number.isInteger(payload.transactionRange.end)
          ? { start: payload.transactionRange.start, end: payload.transactionRange.end }
          : null;
        analysis = {
          pageCount,
          scores: Array.isArray(payload.scores) ? payload.scores : [],
          flags: Array.isArray(payload.flags) ? payload.flags : [],
          transactionRange,
          minFirst: Number.isFinite(Number(payload.minFirst)) ? Number(payload.minFirst) : undefined,
          adjMargin: Number.isFinite(Number(payload.adjMargin)) ? Number(payload.adjMargin) : undefined,
          highThreshold: Number.isFinite(Number(payload.highThreshold)) ? Number(payload.highThreshold) : undefined,
          lowThreshold: Number.isFinite(Number(payload.lowThreshold)) ? Number(payload.lowThreshold) : undefined,
          keepAllRatio: Number.isFinite(Number(payload.keepAllRatio)) ? Number(payload.keepAllRatio) : undefined,
        };
        if (trimThreshold && payload.highThreshold != null && payload.highThreshold !== '') {
          const nextThreshold = Number(payload.highThreshold);
          if (!Number.isNaN(nextThreshold)) {
            trimThreshold.value = String(nextThreshold);
          }
        }
        updateThresholdLabel();
        suggestedPages = normaliseSelectionIndices(payload.suggestedKeptPages || []);
        if (!suggestedPages.size) {
          const threshold = Number(trimThreshold?.value);
          suggestedPages = computeSuggestedFromThreshold(threshold);
        }
        selectedPages = new Set(suggestedPages);
        renderPages();
        refreshControls();
      } catch (err) {
        console.error('Trim analyze failed', err);
        setMeta('Analyze failed: ' + (err?.message || 'Unexpected error'));
        renderPages();
      }
    });
  }

  if (btnKeepAll) {
    btnKeepAll.addEventListener('click', () => {
      if (!analysis) return;
      selectedPages = new Set(Array.from({ length: analysis.pageCount }, (_, i) => i));
      renderPages();
      refreshControls();
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (!analysis) return;
      selectedPages = new Set(suggestedPages);
      renderPages();
      refreshControls();
    });
  }

  if (btnApply) {
    btnApply.addEventListener('click', async () => {
      if (!analysis) {
        setMeta('Analyze a PDF before applying a selection.');
        return;
      }
      if (!originalFile) {
        setMeta('Please re-select the PDF to apply trimming.');
        return;
      }
      const pages = Array.from(selectedPages).sort((a, b) => a - b);
      if (!pages.length) {
        setMeta('Select at least one page to keep.');
        return;
      }
      setMeta('Building trimmed PDF…');
      if (btnApply) btnApply.disabled = true;
      try {
        const form = new FormData();
        form.append('file', originalFile);
        form.append('keptPages', JSON.stringify(pages));
        const response = await fetch('/api/pdf/apply', { method: 'POST', body: form });
        const payload = await response.json();
        if (!payload?.ok) {
          setMeta('Apply failed: ' + (payload?.error || 'Unknown error'));
          return;
        }
        trimmedBlob = await base64ToBlob(payload.data_base64, payload.mime);
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }
        previewUrl = URL.createObjectURL(trimmedBlob);
        if (trimPreview) {
          trimPreview.src = previewUrl;
        }
        if (btnDownloadTrim) {
          btnDownloadTrim.disabled = false;
          btnDownloadTrim.onclick = () => {
            const link = document.createElement('a');
            link.href = previewUrl;
            link.download = payload.filename || 'trimmed.pdf';
            link.click();
          };
        }
        refreshControls();
      } catch (err) {
        console.error('Trim apply failed', err);
        setMeta('Apply failed: ' + (err?.message || 'Unexpected error'));
      } finally {
        if (btnApply && analysis) {
          btnApply.disabled = selectedPages.size === 0;
        }
      }
    });
  }

  updateThresholdLabel();
  renderPages();
  refreshControls();
})();
