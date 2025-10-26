(function () {
  const tableBody = document.querySelector('#evidenceTable tbody');
  const fileInput = document.querySelector('#evidenceUpload');
  if (!tableBody || !fileInput) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('project');
  if (!projectId) {
    tableBody.innerHTML = '<tr><td colspan="4" class="text-muted">Provide ?project=&lt;id&gt; in the URL to manage evidence.</td></tr>';
    return;
  }

  const API_BASE = window.__API_BASE || '';

  function readCookie(name) {
    return document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='))?.split('=')[1];
  }

  function csrf() {
    try {
      return decodeURIComponent(readCookie('csrfToken') || '');
    } catch (err) {
      return readCookie('csrfToken') || '';
    }
  }

  async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      headers: Object.assign({ 'x-csrf-token': csrf() }, options.headers || {}),
      ...options,
    });
    if (!res.ok) {
      const error = new Error('Request failed');
      error.status = res.status;
      error.body = await res.text();
      throw error;
    }
    return res.json();
  }

  function renderStatus(file) {
    const status = file.status || 'pending';
    const badgeMap = {
      pending: 'secondary',
      clean: 'success',
      quarantined: 'warning',
    };
    return `<span class="badge bg-${badgeMap[status] || 'secondary'} text-capitalize">${status}</span>`;
  }

  function renderActions(file) {
    const actions = [];
    const downloadUrl = `${API_BASE}/api/files/${file.id}/download`;
    actions.push(`<a class="btn btn-outline-secondary btn-sm" href="${downloadUrl}" target="_blank" rel="noopener">Download</a>`);
    if (file.status === 'clean' && !file.openAiFileId) {
      actions.push(`<button class="btn btn-success btn-sm ms-2" data-action="index" data-id="${file.id}">Index to retrieval</button>`);
    } else if (file.openAiFileId) {
      actions.push(`<span class="badge bg-info ms-2">Indexed</span>`);
    }
    return actions.join('');
  }

  function renderFiles(files) {
    if (!files.length) {
      tableBody.innerHTML = '<tr><td colspan="4" class="text-muted">No files uploaded yet.</td></tr>';
      return;
    }
    tableBody.innerHTML = files.map((file) => {
      const uploaded = file.uploadDate ? new Date(file.uploadDate).toLocaleString() : '—';
      return `<tr data-id="${file.id}">
        <td>${file.filename}</td>
        <td>${renderStatus(file)}</td>
        <td>${uploaded}</td>
        <td class="text-end">${renderActions(file)}</td>
      </tr>`;
    }).join('');
  }

  async function loadFiles() {
    tableBody.innerHTML = '<tr><td colspan="4" class="text-muted">Loading…</td></tr>';
    try {
      const data = await fetchJSON(`${API_BASE}/api/projects/${projectId}/files`);
      renderFiles(data.files || []);
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="4" class="text-danger">Failed to load files (HTTP ${err.status || 'error'}).</td></tr>`;
    }
  }

  async function uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    tableBody.innerHTML = '<tr><td colspan="4" class="text-muted">Uploading…</td></tr>';
    try {
      await fetch(`${API_BASE}/api/projects/${projectId}/files`, {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: { 'x-csrf-token': csrf() },
      });
      await loadFiles();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="4" class="text-danger">Upload failed (HTTP ${err.status || 'error'}).</td></tr>`;
    }
  }

  async function indexFile(fileId) {
    const row = tableBody.querySelector(`tr[data-id="${fileId}"]`);
    if (row) {
      row.classList.add('opacity-50');
    }
    try {
      await fetchJSON(`${API_BASE}/api/projects/${projectId}/rag/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: [fileId] }),
      });
      await loadFiles();
    } catch (err) {
      if (row) {
        row.classList.remove('opacity-50');
      }
      alert('Indexing failed. Please retry.');
    }
  }

  tableBody.addEventListener('click', (event) => {
    const target = event.target;
    if (target.matches('button[data-action="index"]')) {
      const id = target.getAttribute('data-id');
      if (id) {
        indexFile(id);
      }
    }
  });

  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    if (file) {
      uploadFile(file).finally(() => { fileInput.value = ''; });
    }
  });

  loadFiles();
})();
