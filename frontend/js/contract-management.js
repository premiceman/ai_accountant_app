// frontend/js/contract-management.js
(function () {
  const state = {
    documents: [],
    selected: null,
    docStatuses: [],
    summaryRaw: '',
    qaHistory: [],
    qaMessages: [],
    qaBusy: false,
    summaryBusy: false
  };

  const stageBox = document.getElementById('contract-stage');
  const stageLabel = document.getElementById('contract-stage-label');
  const stageDetail = document.getElementById('contract-stage-detail');

  const docLoader = document.getElementById('contract-doc-loader');
  const docError = document.getElementById('contract-doc-error');
  const docEmpty = document.getElementById('contract-doc-empty');
  const docList = document.getElementById('contract-doc-list');
  const docSelected = document.getElementById('contract-selected');
  const docSelectedMeta = document.getElementById('contract-selected-meta');
  const docStatus = document.getElementById('contract-doc-status');

  const summaryLoader = document.getElementById('contract-summary-loader');
  const summaryError = document.getElementById('contract-summary-error');
  const summaryWrap = document.getElementById('contract-summary');
  const summaryList = document.getElementById('contract-summary-list');
  const summaryUpdated = document.getElementById('contract-summary-updated');

  const qaHistoryEl = document.getElementById('contract-qa-history');
  const qaLoader = document.getElementById('contract-qa-loader');
  const qaError = document.getElementById('contract-qa-error');
  const qaForm = document.getElementById('contract-qa-form');
  const qaInput = document.getElementById('contract-qa-input');
  const qaSubmit = document.getElementById('contract-qa-submit');

  const QA_SYSTEM = {
    role: 'system',
    content: 'You are an expert contract analyst. Answer succinctly in UK English, referencing only the provided contract.'
  };

  init().catch((err) => {
    console.error('[contract-management] init failed', err);
    showStage('Unable to initialise', 'Refresh once connectivity resumes.');
    if (docError) {
      docError.textContent = err?.message || 'Unable to load contract workspace.';
      docError.classList.remove('d-none');
    }
  });

  async function init() {
    showStage('Authenticating…', 'Securing your contract intelligence workspace.');
    await Auth.requireAuth();

    resetChat();

    showStage('Collecting documents…', 'Scanning custom collections for agreements.');
    await loadDocuments();

    hideStage();
    bindEvents();
    renderDocuments();

    if (state.selected) {
      generateSummary().catch((err) => console.warn('Summary generation failed on init', err));
    } else {
      renderSummary();
    }
  }

  function bindEvents() {
    if (docList) {
      docList.addEventListener('click', (ev) => {
        const openLink = ev.target.closest('a[data-action="open"]');
        if (openLink) return;
        const item = ev.target.closest('.contract-doc-item');
        if (!item) return;
        const id = item.getAttribute('data-id');
        const doc = state.documents.find((entry) => entry.id === id);
        if (!doc) return;
        if (state.summaryBusy || state.qaBusy) return; // prevent switching mid-stream
        state.selected = doc;
        state.docStatuses = [];
        resetChat();
        renderDocuments();
        generateSummary().catch((err) => {
          console.error('[contract-management] summary error', err);
          summaryError.textContent = err?.message || 'Unable to summarise this contract. Try again later.';
          summaryError.classList.remove('d-none');
        });
      });
    }

    if (qaForm) {
      qaForm.addEventListener('submit', handleQuestion);
    }
  }

  function resetChat() {
    state.qaHistory = [];
    state.qaMessages = [QA_SYSTEM];
    renderQAHistory();
    qaError?.classList.add('d-none');
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

      const docs = [];
      for (const collection of customCollections) {
        showLoader(docLoader, `Loading ${collection?.name || 'collection'}…`);
        const filesRes = await Auth.fetch(`/api/vault/collections/${encodeURIComponent(collection.id)}/files`, { cache: 'no-store' });
        if (!filesRes.ok) {
          console.warn('[contract-management] failed to load files for collection', collection.id);
          continue;
        }
        const payload = await filesRes.json().catch(() => []);
        const files = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.files)
            ? payload.files
            : [];
        files.forEach((file) => {
          const normalised = {
            id: String(file.id || file.fileId || ''),
            name: file.name || file.originalName || `Document ${file.id || ''}`,
            collectionId: file.collectionId || collection.id,
            collectionName: file.collectionName || collection.name,
            uploadedAt: file.uploadedAt || file.updatedAt || null,
            size: Number(file.size || file.bytes || 0),
            viewUrl: file.viewUrl || `/api/vault/files/${encodeURIComponent(file.id || file.fileId)}/view`
          };
          if (normalised.id) docs.push(normalised);
        });
      }

      const dedupe = new Map();
      docs.forEach((doc) => dedupe.set(doc.id, doc));
      state.documents = Array.from(dedupe.values()).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
      state.selected = state.documents.length ? state.documents[0] : null;

      renderDocuments();
      renderSelected();
    } catch (err) {
      console.error('[contract-management] loadDocuments failed', err);
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
      renderSelected();
      return;
    }
    docEmpty?.classList.add('d-none');

    state.documents.forEach((doc) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-group-item list-group-item-action contract-doc-item text-start';
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

    renderSelected();
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
    renderDocStatuses();
  }

  async function generateSummary() {
    if (!state.selected) {
      renderSummary();
      return;
    }
    state.docStatuses = [];
    renderDocStatuses();
    state.summaryBusy = true;
    summaryError?.classList.add('d-none');
    showLoader(summaryLoader, 'Analysing contract with OpenAI…');
    state.summaryRaw = '';
    renderSummary();

    try {
      const messages = [
        {
          role: 'system',
          content: 'You are a contract analyst. Summaries must be concise bullet points highlighting parties, purpose, payment, duration, renewal, termination and penalties. Use UK English.'
        },
        {
          role: 'user',
          content: 'Provide five concise bullet points covering: parties & purpose, payment obligations, contract length & renewal, termination triggers & notice, and any penalties or service levels.'
        }
      ];

      const { text } = await callChat({
        messages,
        vaultFileIds: [state.selected.id],
        onStatus: updateDocStatuses,
      });

      state.summaryRaw = text || '';
      renderSummary();
    } catch (err) {
      console.error('[contract-management] summary error', err);
      if (summaryError) {
        summaryError.textContent = err?.message || 'Unable to summarise this contract.';
        summaryError.classList.remove('d-none');
      }
    } finally {
      hideLoader(summaryLoader);
      state.summaryBusy = false;
      if (summaryUpdated) {
        summaryUpdated.textContent = state.summaryRaw ? `Updated ${new Date().toLocaleTimeString()}` : '';
      }
    }
  }

  function renderSummary() {
    if (!summaryWrap || !summaryList) return;
    summaryList.innerHTML = '';
    if (!state.summaryRaw) {
      summaryWrap.classList.add('d-none');
      return;
    }

    const bullets = state.summaryRaw
      .split(/\n+/)
      .map((line) => line.replace(/^[-•\s]+/, '').trim())
      .filter(Boolean);

    if (!bullets.length) {
      summaryWrap.classList.add('d-none');
      return;
    }

    bullets.forEach((line) => {
      const li = document.createElement('li');
      li.innerHTML = `<i class="bi bi-dot me-1 text-primary"></i>${escapeHtml(line)}`;
      summaryList.appendChild(li);
    });

    summaryWrap.classList.remove('d-none');
  }

  async function handleQuestion(ev) {
    ev.preventDefault();
    if (!state.selected) {
      if (qaError) {
        qaError.textContent = 'Select a contract before asking a question.';
        qaError.classList.remove('d-none');
      }
      return;
    }
    if (state.qaBusy) return;

    const question = (qaInput?.value || '').trim();
    if (!question) return;
    qaInput.value = '';
    qaError?.classList.add('d-none');

    const userEntry = { role: 'user', content: question };
    state.qaHistory.push(userEntry);
    state.qaMessages.push({ role: 'user', content: question });
    trimChatHistory();

    const assistantEntry = { role: 'assistant', content: '' };
    state.qaHistory.push(assistantEntry);
    renderQAHistory();

    state.qaBusy = true;
    disableQA(true);
    showLoader(qaLoader, 'Consulting the contract copilot…');

    try {
      const { text } = await callChat({
        messages: state.qaMessages,
        vaultFileIds: [state.selected.id],
        onStatus: updateDocStatuses,
        onChunk: (partial) => {
          assistantEntry.content = partial;
          renderQAHistory();
        }
      });

      assistantEntry.content = text || 'I could not find an answer in this contract.';
      state.qaMessages.push({ role: 'assistant', content: assistantEntry.content });
      trimChatHistory();
      renderQAHistory();
    } catch (err) {
      console.error('[contract-management] QA error', err);
      assistantEntry.content = `Error: ${err?.message || 'Unable to answer right now.'}`;
      renderQAHistory();
      if (qaError) {
        qaError.textContent = 'Unable to answer that question right now. Try again later.';
        qaError.classList.remove('d-none');
      }
    } finally {
      hideLoader(qaLoader);
      state.qaBusy = false;
      disableQA(false);
    }
  }

  function renderQAHistory() {
    if (!qaHistoryEl) return;
    qaHistoryEl.innerHTML = '';
    if (!state.qaHistory.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'text-muted small';
      placeholder.textContent = 'Ask a question about the selected contract to begin.';
      qaHistoryEl.appendChild(placeholder);
      return;
    }

    state.qaHistory.forEach((entry) => {
      const block = document.createElement('div');
      block.className = `contract-qa-entry ${entry.role}`;
      const title = entry.role === 'user' ? 'You' : 'Contract copilot';
      block.innerHTML = `<div class="fw-semibold mb-1">${title}</div><div class="small">${formatMultiline(entry.content || '')}</div>`;
      qaHistoryEl.appendChild(block);
    });
  }

  function disableQA(disabled) {
    if (qaInput) qaInput.disabled = disabled;
    if (qaSubmit) {
      qaSubmit.disabled = disabled;
      qaSubmit.innerHTML = disabled ? '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Working…' : 'Ask';
    }
  }

  function updateDocStatuses(statuses) {
    if (!Array.isArray(statuses)) return;
    state.docStatuses = statuses;
    renderDocStatuses();
  }

  function renderDocStatuses() {
    if (!docStatus) return;
    docStatus.innerHTML = '';
    if (!state.docStatuses.length) {
      docStatus.classList.add('d-none');
      return;
    }
    docStatus.classList.remove('d-none');

    state.docStatuses.forEach((entry) => {
      const wrap = document.createElement('div');
      const tone = entry.status === 'included' ? 'success' : 'warning';
      const icon = tone === 'success' ? 'bi-check-circle' : entry.status === 'error' ? 'bi-x-octagon' : 'bi-exclamation-triangle';
      wrap.className = `alert alert-${tone === 'success' ? 'success' : 'warning'} mb-2 py-2 px-3`;
      wrap.innerHTML = `
        <div class="d-flex align-items-start gap-2">
          <i class="bi ${icon} mt-1"></i>
          <div>
            <div class="fw-semibold small">${entry.name ? escapeHtml(entry.name) : 'Contract source'}</div>
            <div class="small mb-0">${escapeHtml(entry.reason || (entry.status === 'included' ? 'Included in analysis.' : 'Referenced for context.'))}</div>
          </div>
        </div>`;
      docStatus.appendChild(wrap);
    });
  }

  function trimChatHistory(limit = 12) {
    if (!Array.isArray(state.qaMessages) || state.qaMessages.length <= limit) return;
    const system = state.qaMessages[0];
    const tail = state.qaMessages.slice(-1 * (limit - 1));
    state.qaMessages = [system, ...tail];
  }

  async function callChat({ messages, vaultFileIds, onStatus, onChunk }) {
    const body = { messages, vaultFileIds };
    const res = await Auth.fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || 'AI request failed');
    }

    if (!res.body) {
      const text = await res.text().catch(() => '');
      return { text };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let output = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trimEnd();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let json;
        try {
          json = JSON.parse(payload);
        } catch (err) {
          console.warn('[contract-management] failed to parse SSE chunk', err);
          continue;
        }

        if (Array.isArray(json.docStatuses)) {
          onStatus?.(json.docStatuses);
          continue;
        }
        if (json.error) {
          throw new Error(json.error);
        }
        if (json.delta) {
          output += json.delta;
          onChunk?.(output);
        }
      }
    }

    if (buffer.trim()) {
      const payload = buffer.replace(/^data:/, '').trim();
      if (payload) {
        try {
          const json = JSON.parse(payload);
          if (Array.isArray(json.docStatuses)) onStatus?.(json.docStatuses);
          else if (json.error) throw new Error(json.error);
          else if (json.delta) {
            output += json.delta;
            onChunk?.(output);
          }
        } catch (err) {
          console.warn('[contract-management] trailing SSE parse error', err);
        }
      }
    }

    return { text: output.trim() };
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
        <span>${escapeHtml(text || 'Processing…')}</span>
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

  function formatMultiline(str) {
    return escapeHtml(str).replace(/\n/g, '<br>');
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
})();
