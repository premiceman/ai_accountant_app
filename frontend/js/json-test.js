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
