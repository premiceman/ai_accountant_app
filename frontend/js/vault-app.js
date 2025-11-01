(() => {
  const pipelineOrder = ['Uploaded', 'Queued', 'Classified', 'Standardized', 'Post-Processed', 'Indexed', 'Ready'];

  const els = {
    greeting: document.getElementById('vault-user-greeting'),
    refresh: document.getElementById('vault-refresh'),
    uploadTrigger: document.getElementById('vault-upload-trigger'),
    signOut: document.getElementById('vault-signout'),
    fileInput: document.getElementById('vault-file-input'),
    dropzone: document.getElementById('vault-dropzone'),
    uploadQueue: document.getElementById('vault-upload-queue'),
    tableBody: document.getElementById('vault-table-body'),
    emptyState: document.getElementById('vault-empty'),
    loadMore: document.getElementById('vault-load-more'),
    toastContainer: document.getElementById('vault-toasts'),
  };

  const state = {
    page: 1,
    loading: false,
    hasMore: false,
    documents: [],
  };

  function showToast(message, variant = 'info') {
    if (!els.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${variant}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>`;
    els.toastContainer.appendChild(toast);
    const Toast = window.bootstrap?.Toast;
    if (typeof Toast === 'function') {
      const toastObj = new Toast(toast, { delay: 4000 });
      toastObj.show();
      toast.addEventListener('hidden.bs.toast', () => toast.remove());
    } else {
      toast.classList.add('show');
      setTimeout(() => toast.remove(), 4000);
    }
  }

  function formatBytes(bytes) {
    const num = Number(bytes) || 0;
    if (num <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(num) / Math.log(1024)));
    const value = num / (1024 ** idx);
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '—';
      return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return '—';
    }
  }

  function setLoadingTable(isLoading, { reset = false } = {}) {
    if (!els.tableBody) return;
    if (isLoading) {
      if (reset) {
        els.tableBody.innerHTML = '';
        for (let i = 0; i < 3; i += 1) {
          const tr = document.createElement('tr');
          tr.className = 'placeholder-row';
          tr.innerHTML = `
            <td class="px-4">
              <span class="placeholder col-9"></span>
            </td>
            <td><span class="placeholder col-6"></span></td>
            <td><span class="placeholder col-4"></span></td>
            <td><span class="placeholder col-10"></span></td>
            <td class="text-end pe-4"><span class="placeholder col-3"></span></td>`;
          els.tableBody.appendChild(tr);
        }
      }
    } else if (reset) {
      els.tableBody.innerHTML = '';
    }
  }

  function statusBadgeClass(stepStatus) {
    switch (stepStatus) {
      case 'completed':
        return 'bg-success-subtle text-success-emphasis';
      case 'running':
        return 'bg-info-subtle text-info-emphasis';
      case 'failed':
        return 'bg-danger-subtle text-danger-emphasis';
      default:
        return 'bg-body-tertiary text-secondary';
    }
  }

  function deriveSteps(doc) {
    const jobSteps = Array.isArray(doc?.job?.steps) ? doc.job.steps : [];
    const stepByName = new Map(jobSteps.map((step) => [step.name, step]));
    const steps = pipelineOrder.map((name) => {
      const step = stepByName.get(name);
      return step ? { ...step } : { name, status: name === 'Uploaded' ? 'completed' : name === 'Queued' ? 'running' : 'pending' };
    });

    if (doc?.job?.status === 'failed' || doc?.status === 'failed') {
      steps.forEach((step) => { step.status = step.status === 'completed' ? 'completed' : 'failed'; });
      const final = steps[steps.length - 1];
      final.status = 'failed';
    } else if (doc?.job?.status === 'completed' || doc?.status === 'ready') {
      steps.forEach((step) => { step.status = 'completed'; });
    }

    return steps;
  }

  function renderDocuments() {
    if (!els.tableBody) return;
    els.tableBody.innerHTML = '';

    if (!state.documents.length) {
      els.emptyState?.classList.remove('d-none');
      els.loadMore?.setAttribute('hidden', 'hidden');
      return;
    }

    els.emptyState?.classList.add('d-none');

    state.documents.forEach((doc) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4">
          <div class="fw-semibold text-truncate" title="${doc.filename}">${doc.filename}</div>
          <small class="text-secondary">${doc.fileType || 'application/pdf'}</small>
        </td>
        <td>${formatDate(doc.uploadedAt)}</td>
        <td>${formatBytes(doc.fileSize)}</td>
        <td></td>
        <td class="text-end pe-4 vault-actions"></td>`;

      const statusCell = tr.children[3];
      const steps = deriveSteps(doc);
      const chips = document.createElement('div');
      chips.className = 'vault-status-chips d-flex flex-wrap';
      steps.forEach((step) => {
        const badge = document.createElement('span');
        badge.className = `badge rounded-pill ${statusBadgeClass(step.status)}`;
        badge.textContent = step.name;
        chips.appendChild(badge);
      });
      statusCell.appendChild(chips);

      const actionsCell = tr.children[4];
      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'btn btn-outline-secondary btn-sm me-2';
      previewBtn.innerHTML = '<i class="bi bi-eye"></i>';
      previewBtn.title = 'Preview';
      previewBtn.addEventListener('click', () => handlePreview(doc));

      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'btn btn-outline-primary btn-sm me-2';
      downloadBtn.innerHTML = '<i class="bi bi-download"></i>';
      downloadBtn.title = 'Download';
      downloadBtn.addEventListener('click', () => handleDownload(doc));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-outline-danger btn-sm';
      deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
      deleteBtn.title = 'Delete';
      deleteBtn.addEventListener('click', () => handleDelete(doc));

      actionsCell.append(previewBtn, downloadBtn, deleteBtn);
      els.tableBody.appendChild(tr);
    });

    if (state.hasMore) {
      els.loadMore?.removeAttribute('hidden');
    } else {
      els.loadMore?.setAttribute('hidden', 'hidden');
    }
  }

  async function fetchDocuments({ reset = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    setLoadingTable(true, { reset });

    const targetPage = reset ? 1 : state.page;
    try {
      const params = new URLSearchParams({ page: String(targetPage), limit: '10' });
      const res = await Auth.fetch(`/api/vault/list?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Failed to load documents (${res.status})`);
      }
      const data = await res.json();
      state.hasMore = !!data?.hasMore;
      state.page = (data?.page || targetPage) + 1;
      const items = Array.isArray(data?.items) ? data.items : [];
      state.documents = reset ? items : state.documents.concat(items);
      renderDocuments();
    } catch (err) {
      console.error('Failed to fetch documents', err);
      showToast('Unable to load documents. Please try again.', 'danger');
    } finally {
      state.loading = false;
      setLoadingTable(false, { reset });
    }
  }

  async function presignUpload(file) {
    const res = await Auth.fetch('/api/vault/presign-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
      }),
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody?.error || 'Failed to request upload');
    }
    return res.json();
  }

  function uploadWithProgress(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.responseType = 'text';
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onProgress === 'function') {
          const value = Math.round((event.loaded / event.total) * 100);
          onProgress(value);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.send(file);
    });
  }

  function createUploadEntry(file) {
    const item = document.createElement('div');
    item.className = 'vault-upload-item';
    item.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div class="file-name text-truncate" title="${file.name}">${file.name}</div>
          <small>${formatBytes(file.size)}</small>
        </div>
        <span class="status text-secondary">Preparing…</span>
      </div>
      <div class="progress mt-3" role="progressbar" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-bar" style="width: 0%"></div>
      </div>`;
    els.uploadQueue?.appendChild(item);
    els.uploadQueue?.removeAttribute('hidden');
    return {
      element: item,
      setStatus(text, variant = 'secondary') {
        const statusEl = item.querySelector('.status');
        if (statusEl) {
          statusEl.className = `status text-${variant}`;
          statusEl.textContent = text;
        }
      },
      setProgress(value) {
        const progressBar = item.querySelector('.progress-bar');
        if (progressBar) {
          progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
        }
      },
      markError(message) {
        item.classList.add('is-error');
        this.setStatus(message, 'danger');
      },
      done() {
        this.setStatus('Uploaded', 'success');
        setTimeout(() => {
          item.remove();
          if (!els.uploadQueue?.children.length) {
            els.uploadQueue?.setAttribute('hidden', 'hidden');
          }
        }, 1500);
      },
    };
  }

  async function handleUpload(file) {
    const entry = createUploadEntry(file);
    try {
      entry.setStatus('Requesting upload…');
      const { uploadUrl } = await presignUpload(file);
      entry.setStatus('Uploading…', 'primary');
      await uploadWithProgress(uploadUrl, file, (value) => entry.setProgress(value));
      entry.done();
      showToast(`Uploaded ${file.name}`, 'success');
      await fetchDocuments({ reset: true });
    } catch (err) {
      console.error('Upload failed', err);
      entry.markError(err.message || 'Upload failed');
      showToast(`Upload failed for ${file.name}`, 'danger');
    }
  }

  function handleFiles(fileList) {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).filter((file) => {
      const type = (file.type || '').toLowerCase();
      const isPdf = type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
      const isZip = type.includes('zip') || file.name.toLowerCase().endsWith('.zip');
      if (!isPdf && !isZip) {
        showToast(`${file.name} is not a supported file type`, 'warning');
        return false;
      }
      return true;
    });
    files.forEach((file) => handleUpload(file));
    if (els.fileInput) els.fileInput.value = '';
  }

  async function presignDownload(docId) {
    const res = await Auth.fetch(`/api/vault/presign-download/${encodeURIComponent(docId)}`, { cache: 'no-store' });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody?.error || 'Unable to generate download link');
    }
    return res.json();
  }

  async function handleDownload(doc) {
    try {
      const { downloadUrl } = await presignDownload(doc.id);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = doc.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Download failed', err);
      showToast('Download failed. Please try again.', 'danger');
    }
  }

  async function handlePreview(doc) {
    try {
      const { downloadUrl } = await presignDownload(doc.id);
      window.open(downloadUrl, '_blank', 'noopener');
    } catch (err) {
      console.error('Preview failed', err);
      showToast('Unable to open preview.', 'danger');
    }
  }

  async function handleDelete(doc) {
    const confirmed = window.confirm(`Delete ${doc.filename}? This action cannot be undone.`);
    if (!confirmed) return;
    try {
      const res = await Auth.fetch(`/api/vault/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to delete document');
      }
      showToast(`${doc.filename} deleted`, 'success');
      state.documents = state.documents.filter((item) => item.id !== doc.id);
      renderDocuments();
    } catch (err) {
      console.error('Delete failed', err);
      showToast('Unable to delete document.', 'danger');
    }
  }

  function setupDropzone() {
    if (!els.dropzone) return;
    ['dragenter', 'dragover'].forEach((evt) => {
      els.dropzone.addEventListener(evt, (event) => {
        event.preventDefault();
        event.stopPropagation();
        els.dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach((evt) => {
      els.dropzone.addEventListener(evt, (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (evt === 'drop') {
          const files = event.dataTransfer?.files;
          handleFiles(files);
        }
        if (!event.currentTarget.contains(event.relatedTarget)) {
          els.dropzone.classList.remove('dragover');
        }
      });
    });
    els.dropzone.addEventListener('click', () => {
      els.fileInput?.click();
    });
  }

  async function init() {
    if (!window.Auth || typeof Auth.requireAuth !== 'function') {
      console.error('Auth helpers missing');
      return;
    }
    try {
      const { me } = await Auth.requireAuth();
      if (me?.firstName) {
        els.greeting.textContent = `Hi, ${me.firstName}`;
      } else {
        els.greeting.textContent = 'Secure Vault';
      }
    } catch (err) {
      console.error('Authentication required', err);
      const url = (window.Auth && typeof Auth.buildWorkOSUrl === 'function')
        ? Auth.buildWorkOSUrl({ intent: 'login', next: window.location.pathname })
        : '/login.html';
      window.location.replace(url);
      return;
    }

    setupDropzone();

    els.fileInput?.addEventListener('change', (event) => handleFiles(event.target.files));
    els.uploadTrigger?.addEventListener('click', () => els.fileInput?.click());
    els.refresh?.addEventListener('click', () => fetchDocuments({ reset: true }));
    els.loadMore?.addEventListener('click', () => fetchDocuments({ reset: false }));
    els.signOut?.addEventListener('click', () => {
      if (window.Auth && typeof Auth.signOut === 'function') {
        Auth.signOut({ redirect: '/login.html', reason: 'user-initiated' });
      }
    });

    await fetchDocuments({ reset: true });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
