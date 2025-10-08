// frontend/js/vault.js
(function () {
  const API_BASE = '/api/vault';
  const POLL_INTERVAL_UPLOAD = 3000;
  const POLL_INTERVAL_TILES = 10000;
  const POLL_INTERVAL_LISTS = 15000;
  const LIGHT_LABELS = { red: 'Waiting', amber: 'Processing', green: 'Complete' };

  const state = {
    sessions: new Map(),
    files: new Map(),
    timers: { uploads: null, tiles: null, lists: null },
  };

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const sessionRows = document.getElementById('session-rows');
  const sessionEmpty = document.getElementById('session-empty');
  const tilesGrid = document.getElementById('tiles-grid');
  const payslipGrid = document.getElementById('payslip-grid');
  const statementGrid = document.getElementById('statement-grid');
  const collectionGrid = document.getElementById('collection-grid');
  const payslipMeta = document.getElementById('payslip-meta');
  const statementMeta = document.getElementById('statement-meta');
  const collectionMeta = document.getElementById('collection-meta');

  function authFetch(path, options) {
    if (window.Auth && typeof Auth.fetch === 'function') {
      return Auth.fetch(path, options);
    }
    return fetch(path, options);
  }

  function apiFetch(path, options) {
    return authFetch(`${API_BASE}${path}`, options);
  }

  function renderSessionPanel() {
    sessionRows.innerHTML = '';
    let rowCount = 0;
    for (const session of state.sessions.values()) {
      for (const file of session.files.values()) {
        rowCount += 1;
        sessionRows.appendChild(renderFileRow(file));
      }
      for (const rejected of session.rejected) {
        rowCount += 1;
        sessionRows.appendChild(renderRejectedRow(rejected));
      }
    }
    if (rowCount === 0) {
      sessionEmpty.style.display = '';
    } else {
      sessionEmpty.style.display = 'none';
    }
  }

  function renderFileRow(file) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const name = document.createElement('div');
    name.className = 'filename';
    name.textContent = file.originalName;
    row.appendChild(name);

    const uploadLight = createLight('Upload', file.upload || 'amber');
    const processingLight = createLight('Processing', file.processing || 'red');

    const lights = document.createElement('div');
    lights.className = 'lights';
    lights.append(uploadLight, processingLight);
    row.appendChild(lights);

    const message = document.createElement('div');
    message.className = 'message muted';
    message.textContent = file.message || '';
    row.appendChild(message);
    return row;
  }

  function renderRejectedRow(entry) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const name = document.createElement('div');
    name.className = 'filename';
    name.textContent = entry.originalName;
    row.appendChild(name);

    const lights = document.createElement('div');
    lights.className = 'lights';
    lights.appendChild(createLight('Upload', 'red'));
    lights.appendChild(createLight('Processing', 'red'));
    row.appendChild(lights);

    const message = document.createElement('div');
    message.className = 'message muted';
    message.textContent = entry.reason || 'Rejected';
    row.appendChild(message);
    return row;
  }

  function createLight(label, stateValue) {
    const light = document.createElement('span');
    light.className = 'light';
    light.dataset.state = stateValue;
    light.setAttribute('role', 'status');
    light.setAttribute('tabindex', '0');
    light.setAttribute('aria-label', `${label}: ${LIGHT_LABELS[stateValue] || stateValue}`);
    return light;
  }

  function normaliseFileRecord(sessionId, file) {
    const record = state.files.get(file.fileId) || { sessionId, fileId: file.fileId };
    record.originalName = file.originalName;
    if (file.upload) record.upload = file.upload;
    if (file.processing) record.processing = file.processing;
    if (file.message != null) record.message = file.message;
    state.files.set(file.fileId, record);
    return record;
  }

  function upsertSession(sessionId) {
    if (!state.sessions.has(sessionId)) {
      state.sessions.set(sessionId, { files: new Map(), rejected: [] });
    }
    return state.sessions.get(sessionId);
  }

  function handleUploadResponse(payload) {
    if (!payload) return;
    const session = upsertSession(payload.sessionId || crypto.randomUUID());
    if (Array.isArray(payload.files)) {
      payload.files.forEach((file) => {
        if (!file.fileId) return;
        const record = normaliseFileRecord(payload.sessionId, { ...file, upload: 'green', processing: 'red' });
        session.files.set(file.fileId, record);
      });
    }
    if (Array.isArray(payload.rejected)) {
      payload.rejected.forEach((entry) => {
        session.rejected.push({ originalName: entry.originalName, reason: entry.reason });
      });
    }
    renderSessionPanel();
    queueStatusPolling();
    queueRefresh();
  }

  function showError(message) {
    sessionEmpty.style.display = '';
    sessionEmpty.textContent = message;
  }

  async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file, file.name);
    try {
      const response = await apiFetch('/upload', { method: 'POST', body: formData });
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Upload failed');
      }
      const json = await response.json();
      handleUploadResponse(json);
    } catch (error) {
      console.error('Upload error', error);
      showError(error.message || 'Upload failed');
    }
  }

  function handleFiles(fileList) {
    if (!fileList || !fileList.length) return;
    Array.from(fileList).forEach((file) => {
      const ext = (file.name || '').toLowerCase();
      if (!(ext.endsWith('.pdf') || ext.endsWith('.zip'))) {
        showError('We only accept PDF or ZIP uploads.');
        return;
      }
      uploadFile(file);
    });
    fileInput.value = '';
  }

  function setupDropzone() {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('drag-active');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-active'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag-active');
      handleFiles(event.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => handleFiles(fileInput.files));
  }

  async function pollFileStatus(fileId) {
    try {
      const response = await apiFetch(`/files/${encodeURIComponent(fileId)}/status`);
      if (!response.ok) return;
      const data = await response.json();
      const record = state.files.get(fileId);
      if (!record) return;
      const previousProcessing = record.processing;
      record.upload = data.upload || record.upload;
      record.processing = data.processing || record.processing;
      record.message = data.message || '';
      const session = state.sessions.get(record.sessionId);
      if (session) {
        session.files.set(fileId, record);
      }
      renderSessionPanel();
      if (previousProcessing !== 'green' && record.processing === 'green') {
        queueRefresh();
      }
    } catch (error) {
      console.warn('Status poll failed', error);
    }
  }

  function queueStatusPolling() {
    if (state.timers.uploads) return;
    state.timers.uploads = setInterval(() => {
      for (const fileId of state.files.keys()) {
        pollFileStatus(fileId);
      }
    }, POLL_INTERVAL_UPLOAD);
  }

  async function fetchTiles() {
    try {
      const response = await apiFetch('/tiles');
      if (!response.ok) return;
      const data = await response.json();
      renderTiles(data);
    } catch (error) {
      console.warn('Tile fetch failed', error);
    }
  }

  function renderTiles(data) {
    const tiles = [];
    if (data?.tiles) {
      tiles.push({ label: 'Payslips', count: data.tiles.payslips?.count || 0, updated: data.tiles.payslips?.lastUpdated });
      const statementCount = (data.tiles.statements?.count || 0) + (data.tiles.savings?.count || 0);
      tiles.push({ label: 'Statements', count: statementCount, updated: data.tiles.statements?.lastUpdated });
      const savingsCount = (data.tiles.savings?.count || 0) + (data.tiles.isa?.count || 0);
      tiles.push({ label: 'Savings & ISA', count: savingsCount, updated: data.tiles.isa?.lastUpdated || data.tiles.savings?.lastUpdated });
      tiles.push({ label: 'Investments', count: data.tiles.investments?.count || 0, updated: data.tiles.investments?.lastUpdated });
      tiles.push({ label: 'Pensions', count: data.tiles.pension?.count || 0, updated: data.tiles.pension?.lastUpdated });
      tiles.push({ label: 'HMRC', count: data.tiles.hmrc?.count || 0, updated: data.tiles.hmrc?.lastUpdated });
    }
    tilesGrid.innerHTML = '';
    tiles.forEach((tile) => {
      const card = document.createElement('article');
      card.className = 'tile';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = tile.label;
      const count = document.createElement('strong');
      count.textContent = tile.count.toLocaleString();
      card.append(label, count);
      if (tile.updated) {
        const updated = document.createElement('span');
        updated.className = 'muted';
        updated.textContent = `Updated ${new Date(tile.updated).toLocaleString()}`;
        card.appendChild(updated);
      }
      tilesGrid.appendChild(card);
    });
    if ((data?.processing || 0) > 0) {
      const pill = document.createElement('div');
      pill.className = 'processing-pill';
      pill.textContent = `${data.processing} processing…`;
      tilesGrid.prepend(pill);
    }
  }

  async function fetchPayslips() {
    try {
      const response = await apiFetch('/payslips/employers');
      if (!response.ok) return;
      const data = await response.json();
      renderEmployerGrid(data?.employers || []);
    } catch (error) {
      console.warn('Payslip fetch failed', error);
    }
  }

  function renderEmployerGrid(employers) {
    payslipGrid.innerHTML = '';
    payslipMeta.textContent = employers.length ? `${employers.length} employer${employers.length === 1 ? '' : 's'}` : 'No payslips yet.';
    employers.forEach((employer) => {
      const card = document.createElement('article');
      card.className = 'grid-card';
      const title = document.createElement('h3');
      title.textContent = employer.name || 'Unknown employer';
      const dl = document.createElement('dl');
      dl.innerHTML = `
        <div><span>Files</span><span>${employer.count}</span></div>
        <div><span>Last pay date</span><span>${employer.lastPayDate ? new Date(employer.lastPayDate).toLocaleDateString() : '—'}</span></div>
      `;
      card.append(title, dl);
      payslipGrid.appendChild(card);
    });
  }

  async function fetchStatements() {
    try {
      const response = await apiFetch('/statements/institutions');
      if (!response.ok) return;
      const data = await response.json();
      renderInstitutionGrid(data?.institutions || []);
    } catch (error) {
      console.warn('Statements fetch failed', error);
    }
  }

  function renderInstitutionGrid(institutions) {
    statementGrid.innerHTML = '';
    statementMeta.textContent = institutions.length ? `${institutions.length} institution${institutions.length === 1 ? '' : 's'}` : 'No statements yet.';
    institutions.forEach((inst) => {
      const card = document.createElement('article');
      card.className = 'grid-card';
      const title = document.createElement('h3');
      title.textContent = inst.name || 'Institution';
      const dl = document.createElement('dl');
      dl.innerHTML = `
        <div><span>Accounts</span><span>${inst.accounts || 0}</span></div>
      `;
      card.append(title, dl);
      statementGrid.appendChild(card);
    });
  }

  async function fetchCollections() {
    try {
      const response = await apiFetch('/collections');
      if (!response.ok) return;
      const data = await response.json();
      renderCollections(data?.collections || []);
    } catch (error) {
      console.warn('Collections fetch failed', error);
    }
  }

  function renderCollections(collections) {
    collectionGrid.innerHTML = '';
    collectionMeta.textContent = collections.length ? `${collections.length} collection${collections.length === 1 ? '' : 's'}` : 'No collections yet.';
    collections.forEach((col) => {
      const card = document.createElement('article');
      card.className = 'grid-card';
      const title = document.createElement('h3');
      title.textContent = col.name || 'Collection';
      const dl = document.createElement('dl');
      dl.innerHTML = `
        <div><span>Files</span><span>${col.fileCount || 0}</span></div>
        <div><span>Updated</span><span>${col.lastUpdated ? new Date(col.lastUpdated).toLocaleDateString() : '—'}</span></div>
      `;
      card.append(title, dl);
      collectionGrid.appendChild(card);
    });
  }

  function queueRefresh() {
    if (!state.timers.tiles) {
      fetchTiles();
      state.timers.tiles = setInterval(fetchTiles, POLL_INTERVAL_TILES);
    }
    if (!state.timers.lists) {
      fetchPayslips();
      fetchStatements();
      fetchCollections();
      state.timers.lists = setInterval(() => {
        fetchPayslips();
        fetchStatements();
        fetchCollections();
      }, POLL_INTERVAL_LISTS);
    }
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function init() {
    setupDropzone();
    queueRefresh();
    fetchTiles();
    fetchPayslips();
    fetchStatements();
    fetchCollections();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
