// frontend/js/vault.js
(function () {
  const API_BASE = '/api/vault';
  const POLL_INTERVAL_UPLOAD = 3000;
  const POLL_INTERVAL_TILES = 10000;
  const POLL_INTERVAL_LISTS = 15000;
  const LIGHT_LABELS = { red: 'Waiting', amber: 'Processing', green: 'Complete' };
  const STORAGE_KEY = 'vault.uploadSessions.v1';

  const BRAND_THEMES = [
    { className: 'grid-card--brand-monzo', tokens: ['monzo'] },
    { className: 'grid-card--brand-halifax', tokens: ['halifax'] },
    { className: 'grid-card--brand-lloyds', tokens: ['lloyds', 'lloyd'] },
    { className: 'grid-card--brand-hsbc', tokens: ['hsbc'] },
    { className: 'grid-card--brand-natwest', tokens: ['natwest', 'nat west', 'royal bank of scotland'] },
    { className: 'grid-card--brand-santander', tokens: ['santander'] },
    { className: 'grid-card--brand-barclays', tokens: ['barclays', 'barclaycard'] },
    { className: 'grid-card--brand-starling', tokens: ['starling'] },
    { className: 'grid-card--brand-revolut', tokens: ['revolut'] },
    { className: 'grid-card--brand-nationwide', tokens: ['nationwide'] },
    { className: 'grid-card--brand-firstdirect', tokens: ['first direct'] },
    { className: 'grid-card--brand-tsb', tokens: ['tsb'] },
    { className: 'grid-card--brand-vanguard', tokens: ['vanguard'] },
    { className: 'grid-card--brand-fidelity', tokens: ['fidelity'] },
    { className: 'grid-card--brand-hl', tokens: ['hargreaves', 'lansdown'] },
    { className: 'grid-card--brand-aviva', tokens: ['aviva'] },
    { className: 'grid-card--brand-scottishwidows', tokens: ['scottish widows'] },
    { className: 'grid-card--brand-hmrc', tokens: ['hmrc', 'hm revenue', "her majesty's revenue"] },
    { className: 'grid-card--brand-amazon', tokens: ['amazon'] },
    { className: 'grid-card--brand-google', tokens: ['google', 'alphabet'] },
    { className: 'grid-card--brand-microsoft', tokens: ['microsoft'] },
    { className: 'grid-card--brand-apple', tokens: ['apple'] },
    { className: 'grid-card--brand-meta', tokens: ['meta', 'facebook'] },
    { className: 'grid-card--brand-tesco', tokens: ['tesco'] },
    { className: 'grid-card--brand-sainsbury', tokens: ["sainsbury", "sainsbury's"] },
    { className: 'grid-card--brand-shell', tokens: ['shell'] },
    { className: 'grid-card--brand-bp', tokens: ['^bp$', 'bp plc', 'british petroleum'] },
  ];

  function normaliseBrandName(name) {
    return String(name || '').toLowerCase();
  }

  function findBrandTheme(name) {
    if (!name) return null;
    const target = normaliseBrandName(name);
    return BRAND_THEMES.find((theme) =>
      theme.tokens.some((tokenRaw) => {
        const token = normaliseBrandName(tokenRaw);
        if (!token) return false;
        if (token.startsWith('^') && token.endsWith('$')) {
          return target === token.slice(1, -1);
        }
        return target.includes(token);
      })
    );
  }

  function hashNameToHue(name) {
    const input = normaliseBrandName(name);
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 360;
  }

  function applyEntityBranding(card, name) {
    if (!card) return;
    card.className = 'grid-card';
    card.style.removeProperty('--card-brand-hue');
    const theme = findBrandTheme(name);
    if (theme) {
      card.classList.add('grid-card--brand', theme.className);
      return;
    }
    if (name) {
      card.classList.add('grid-card--brand', 'grid-card--brand-generic');
      card.style.setProperty('--card-brand-hue', `${hashNameToHue(name)}`);
    }
  }

  const state = {
    sessions: new Map(),
    files: new Map(),
    timers: { uploads: null, tiles: null, lists: null },
    placeholders: new Map(),
  };

  let unauthorised = false;

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
  const progressContainer = document.getElementById('vault-progress');
  const progressPhase = document.getElementById('vault-progress-phase');
  const progressCount = document.getElementById('vault-progress-count');
  const progressBar = document.getElementById('vault-progress-bar');

  function authFetch(path, options) {
    if (window.Auth && typeof Auth.fetch === 'function') {
      return Auth.fetch(path, options);
    }
    return fetch(path, options);
  }

  function setProgress({ phase, completed, total, countLabel }) {
    if (!(progressContainer && progressPhase && progressCount && progressBar)) return;
    progressContainer.hidden = false;
    progressContainer.setAttribute('aria-hidden', 'false');
    progressPhase.textContent = phase;
    const safeTotal = Math.max(0, total || 0);
    let safeCompleted = Math.max(0, completed || 0);
    if (safeTotal) {
      safeCompleted = Math.min(safeCompleted, safeTotal);
    }
    progressBar.setAttribute('aria-label', phase);
    if (countLabel != null) {
      progressCount.textContent = countLabel;
    } else {
      progressCount.textContent = safeTotal ? `${safeCompleted}/${safeTotal} complete` : '';
    }
    const pct = safeTotal ? Math.round((safeCompleted / safeTotal) * 100) : safeCompleted ? 100 : 0;
    progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    progressBar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, pct))));
  }

  function hideProgress() {
    if (!(progressContainer && progressBar)) return;
    progressContainer.hidden = true;
    progressContainer.setAttribute('aria-hidden', 'true');
    progressBar.style.width = '0%';
    progressBar.setAttribute('aria-valuenow', '0');
  }

  function updateProgressUI() {
    if (!(progressContainer && progressPhase && progressCount && progressBar)) return;
    const placeholders = Array.from(state.placeholders.values());
    if (placeholders.length) {
      const total = placeholders.reduce((sum, item) => sum + (item.total || 1), 0);
      const completed = placeholders.reduce((sum, item) => sum + (item.completed || 0), 0);
      const hasZip = placeholders.some((item) => item.phase === 'Extracting zip');
      const phaseLabel = hasZip ? 'Extracting zip' : 'Uploading files';
      const countLabel = total ? `${completed}/${total} complete` : 'Preparing…';
      const phaseWithCount = total ? `${phaseLabel} (${completed}/${total})` : phaseLabel;
      setProgress({ phase: phaseWithCount, completed, total, countLabel });
      return;
    }

    const totalFiles = state.files.size;
    if (!totalFiles) {
      hideProgress();
      return;
    }

    const records = Array.from(state.files.values());
    const uploadCompleted = records.filter((file) => file.upload === 'green').length;
    const processingCompleted = records.filter((file) => file.processing === 'green').length;

    if (uploadCompleted < totalFiles) {
      const phase = `Uploading files (${uploadCompleted}/${totalFiles})`;
      setProgress({ phase, completed: uploadCompleted, total: totalFiles, countLabel: `${uploadCompleted}/${totalFiles} complete` });
      return;
    }

    if (processingCompleted < totalFiles) {
      const phase = `Extracting analytics (${processingCompleted}/${totalFiles})`;
      setProgress({ phase, completed: processingCompleted, total: totalFiles, countLabel: `${processingCompleted}/${totalFiles} complete` });
      return;
    }

    const phase = `All files processed (${totalFiles}/${totalFiles})`;
    setProgress({ phase, completed: totalFiles, total: totalFiles, countLabel: `${totalFiles}/${totalFiles} complete` });
  }

  function persistState() {
    if (typeof localStorage === 'undefined') return;
    try {
      const payload = {
        sessions: Array.from(state.sessions.entries()).map(([sessionId, session]) => ({
          sessionId,
          files: Array.from(session.files.values()).map((file) => ({
            fileId: file.fileId,
            originalName: file.originalName,
            upload: file.upload,
            processing: file.processing,
            message: file.message || '',
          })),
          rejected: Array.isArray(session.rejected)
            ? session.rejected.map((entry) => ({ originalName: entry.originalName, reason: entry.reason }))
            : [],
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to persist vault sessions', error);
    }
  }

  function restoreSessionsFromStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.sessions)) return;
      data.sessions.forEach((entry) => {
        if (!entry || !entry.sessionId) return;
        const session = upsertSession(entry.sessionId);
        session.rejected = Array.isArray(entry.rejected)
          ? entry.rejected.map((item) => ({ originalName: item.originalName, reason: item.reason }))
          : [];
        if (Array.isArray(entry.files)) {
          entry.files.forEach((file) => {
            if (!file || !file.fileId) return;
            const record = normaliseFileRecord(entry.sessionId, {
              fileId: file.fileId,
              originalName: file.originalName,
              upload: file.upload || 'amber',
              processing: file.processing || 'red',
              message: file.message || '',
            });
            session.files.set(file.fileId, record);
          });
        }
      });
      renderSessionPanel();
      queueStatusPolling();
    } catch (error) {
      console.warn('Failed to restore vault sessions', error);
    }
  }

  function beginPlaceholder({ phase }) {
    if (!phase) return null;
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `placeholder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.placeholders.set(id, { phase, total: 1, completed: 0 });
    updateProgressUI();
    return id;
  }

  function completePlaceholder(id) {
    if (!id) return;
    const placeholder = state.placeholders.get(id);
    if (placeholder) {
      placeholder.completed = placeholder.total || 1;
    }
    state.placeholders.delete(id);
    updateProgressUI();
  }

  function stopPolling() {
    if (state.timers.uploads) {
      clearInterval(state.timers.uploads);
      state.timers.uploads = null;
    }
    if (state.timers.tiles) {
      clearInterval(state.timers.tiles);
      state.timers.tiles = null;
    }
    if (state.timers.lists) {
      clearInterval(state.timers.lists);
      state.timers.lists = null;
    }
  }

  function handleUnauthorised(message) {
    if (unauthorised) return;
    unauthorised = true;
    stopPolling();
    showError(message || 'Your session has expired. Please sign in again.');
    if (window.Auth && typeof Auth.enforce === 'function') {
      Auth.enforce({ validateWithServer: true }).catch(() => {});
    }
  }

  async function apiFetch(path, options) {
    const response = await authFetch(`${API_BASE}${path}`, options);
    if (response.status === 401) {
      handleUnauthorised('Your session has expired. Please sign in again.');
    }
    return response;
  }

  function renderSessionPanel() {
    if (!(sessionRows && sessionEmpty)) return;
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
    updateProgressUI();
    persistState();
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
    const record = state.files.get(file.fileId) || {
      sessionId,
      fileId: file.fileId,
      upload: 'amber',
      processing: 'red',
      message: '',
    };
    if (file.originalName) {
      record.originalName = file.originalName;
    }
    if (file.upload) {
      record.upload = file.upload;
    } else if (!record.upload) {
      record.upload = 'amber';
    }
    if (file.processing) {
      record.processing = file.processing;
    } else if (!record.processing) {
      record.processing = 'red';
    }
    if (file.message != null) {
      record.message = file.message;
    } else if (record.message == null) {
      record.message = '';
    }
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
    const sessionId = payload.sessionId
      || ((typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const session = upsertSession(sessionId);
    if (Array.isArray(payload.files)) {
      payload.files.forEach((file) => {
        if (!file.fileId) return;
        const record = normaliseFileRecord(sessionId, { ...file, upload: 'green', processing: 'red' });
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
    sessionRows.innerHTML = '';
    sessionEmpty.style.display = '';
    sessionEmpty.textContent = message;
    hideProgress();
  }

  async function uploadFile(file, { placeholderId } = {}) {
    const formData = new FormData();
    formData.append('file', file, file.name);
    try {
      if (window.Auth && typeof Auth.requireAuth === 'function') {
        await Auth.requireAuth();
      }
      const response = await apiFetch('/upload', { method: 'POST', body: formData });
      if (!response.ok) {
        const text = await safeJson(response);
        const errorMessage = response.status === 401 ? 'Your session has expired. Please sign in again.' : (text?.error || 'Upload failed');
        throw new Error(errorMessage);
      }
      const json = await response.json();
      handleUploadResponse(json);
    } catch (error) {
      console.error('Upload error', error);
      if (error.message && error.message.toLowerCase().includes('sign in')) {
        handleUnauthorised(error.message);
      } else {
        showError(error.message || 'Upload failed');
      }
    } finally {
      completePlaceholder(placeholderId);
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
      const phase = ext.endsWith('.zip') ? 'Extracting zip' : 'Uploading files';
      const placeholderId = beginPlaceholder({ phase });
      uploadFile(file, { placeholderId });
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
      if (response.status === 404) {
        const record = state.files.get(fileId);
        if (record) {
          state.files.delete(fileId);
          const session = state.sessions.get(record.sessionId);
          if (session) {
            session.files.delete(fileId);
            if (session.files.size === 0 && session.rejected.length === 0) {
              state.sessions.delete(record.sessionId);
            }
          }
          renderSessionPanel();
        }
        return;
      }
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
      applyEntityBranding(card, employer.name);
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
      applyEntityBranding(card, inst.name);
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

  async function init() {
    if (window.Auth && typeof Auth.requireAuth === 'function') {
      try {
        await Auth.requireAuth();
      } catch (error) {
        console.warn('Auth required for vault page', error);
        handleUnauthorised('Please sign in to access your vault.');
        return;
      }
    }

    setupDropzone();
    restoreSessionsFromStorage();
    queueRefresh();
    fetchTiles();
    fetchPayslips();
    fetchStatements();
    fetchCollections();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('Failed to initialise vault page', error);
      showError('Something went wrong initialising the vault. Please try again.');
    });
  });
})();
