// frontend/js/scenario-lab.js
(function () {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

    const chatBody = $('#chat-body');
    const chatForm = $('#chat-form');
    const chatText = $('#chat-text');
    const btnSend  = $('#btn-send');
    const btnStop  = $('#btn-stop');
    const btnNew   = $('#btn-new');

    const docPanel       = $('#doc-panel');
    const docLoading     = $('#doc-loading');
    const docError       = $('#doc-error');
    const docSelected    = $('#doc-selected');
    const docSelectedRow = $('#doc-selected-list');
    const docSections    = $('#doc-sections');
    const docRequired    = $('#doc-required');
    const docHelpful     = $('#doc-helpful');
    const docAll         = $('#doc-all');
    const docNotices     = $('#doc-notices');
    const docRefresh     = $('#doc-refresh');

    const composer = chatForm; // semantic alias

    let messages = [];     // in-memory only (no persistence)
    let aborter  = null;   // AbortController for a streaming request
    let activeDocStatuses = [];

    const docState = {
      catalogue: null,
      files: new Map(),
      checkboxes: new Map(), // id -> Set<HTMLInputElement>
      selected: new Map()    // id -> metadata { id, name, viewUrl, size, collectionName }
    };

    function scrollToBottom() {
      chatBody.scrollTop = chatBody.scrollHeight;
    }

    function addMessage(role, content) {
      const wrap = document.createElement('div');
      wrap.className = `msg ${role}`;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';

      const main = document.createElement('div');
      main.className = 'bubble-content';
      if (content) main.textContent = content;
      bubble.appendChild(main);

      const meta = document.createElement('div');
      meta.className = 'bubble-meta';
      bubble.appendChild(meta);

      wrap.appendChild(bubble);
      chatBody.appendChild(wrap);
      scrollToBottom();
      return { wrap, bubble, main, meta };
    }

    function addSkeleton() {
      const wrap = document.createElement('div');
      wrap.className = 'msg assistant';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      for (let i = 0; i < 3; i++) {
        const sk = document.createElement('div');
        sk.className = 'skeleton';
        sk.style.width = (70 + Math.random() * 25) + '%';
        bubble.appendChild(sk);
      }
      const meta = document.createElement('div');
      meta.className = 'bubble-meta';
      bubble.appendChild(meta);
      wrap.appendChild(bubble);
      chatBody.appendChild(wrap);
      scrollToBottom();
      return { wrap, bubble, meta };
    }

    // Auto-expand textarea (ChatGPT-like)
    function autosize() {
      chatText.style.height = 'auto';
      const max = 180; // px (matches CSS max-height)
      const next = Math.min(chatText.scrollHeight, max);
      chatText.style.height = next + 'px';
    }

    // UI state helpers (purely aesthetic)
    function setComposerEmpty(isEmpty) {
      composer.classList.toggle('composer--empty', !!isEmpty);
      composer.classList.toggle('composer--ready', !isEmpty);
      btnSend.disabled = !!isEmpty;
    }

    function setStreaming(on) {
      composer.classList.toggle('composer--streaming', !!on);
      btnStop.disabled = !on;
      btnSend.disabled = true;
      chatText.disabled = !!on;
      if (on) chatText.blur();
    }

    function resetChat() {
      messages = [];
      chatBody.innerHTML = '';
      chatText.value = '';
      autosize();
      setComposerEmpty(true);
      setStreaming(false);
      chatText.focus();
    }

    function formatSize(bytes) {
      if (!Number.isFinite(bytes)) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function ensureCheckboxEntry(id) {
      if (!docState.checkboxes.has(id)) docState.checkboxes.set(id, new Set());
      return docState.checkboxes.get(id);
    }

    function syncCheckboxes(id, checked) {
      const set = docState.checkboxes.get(id);
      if (!set) return;
      for (const input of set) {
        input.checked = checked;
      }
    }

    function updateDocSelectionUI() {
      if (!docSelected) return;
      docSelectedRow.innerHTML = '';
      if (!docState.selected.size) {
        docSelected.classList.add('d-none');
        return;
      }
      docSelected.classList.remove('d-none');
      for (const [id, meta] of docState.selected) {
        const badge = document.createElement('div');
        badge.className = 'doc-badge';
        const link = document.createElement('a');
        link.href = meta.viewUrl || '#';
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = meta.name || `Document ${id}`;
        badge.appendChild(link);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', 'Remove document');
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => deselectDoc(id));
        badge.appendChild(removeBtn);
        docSelectedRow.appendChild(badge);
      }
    }

    function selectDoc(id, meta) {
      docState.selected.set(id, {
        id,
        name: meta?.name || `Document ${id}`,
        viewUrl: meta?.viewUrl || `/api/vault/files/${encodeURIComponent(id)}/view`,
        size: meta?.size,
        collectionName: meta?.collectionName || null
      });
      syncCheckboxes(id, true);
      updateDocSelectionUI();
    }

    function deselectDoc(id) {
      docState.selected.delete(id);
      syncCheckboxes(id, false);
      updateDocSelectionUI();
    }

    function onDocToggle(ev) {
      const input = ev.currentTarget;
      const fileId = input.dataset.fileId;
      if (!fileId) return;
      const fileMeta = docState.files.get(fileId) || {
        id: fileId,
        name: input.dataset.fileName,
        viewUrl: input.dataset.viewUrl
      };
      if (input.checked) selectDoc(fileId, fileMeta);
      else deselectDoc(fileId);
    }

    function createDocCheckbox(file, { hint = null } = {}) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.fileId = file.id;
      input.dataset.fileName = file.name || '';
      input.dataset.viewUrl = file.viewUrl || '';
      input.checked = docState.selected.has(file.id);
      input.addEventListener('change', onDocToggle);
      ensureCheckboxEntry(file.id).add(input);
      label.appendChild(input);

      const textWrap = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = file.name || 'Untitled document';
      textWrap.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'doc-entry-meta';
      const parts = [];
      if (file.collectionName) parts.push(file.collectionName);
      if (Number.isFinite(file.size)) parts.push(formatSize(file.size));
      if (hint) parts.push(hint);
      meta.textContent = parts.join(' • ');
      textWrap.appendChild(meta);
      label.appendChild(textWrap);

      return label;
    }

    function renderDocSection(container, docs) {
      container.innerHTML = '';
      if (!docs || !docs.length) {
        const empty = document.createElement('div');
        empty.className = 'doc-empty';
        empty.textContent = 'No catalogue entries yet.';
        container.appendChild(empty);
        return;
      }
      for (const doc of docs) {
        const card = document.createElement('div');
        card.className = 'doc-entry';
        const header = document.createElement('div');
        header.className = 'doc-entry-header';

        const textWrap = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'doc-entry-title';
        title.textContent = doc.label || doc.key;
        textWrap.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'doc-entry-meta';
        meta.textContent = doc.why || '';
        textWrap.appendChild(meta);

        header.appendChild(textWrap);
        card.appendChild(header);

        const filesWrap = document.createElement('div');
        filesWrap.className = 'doc-files';
        if (Array.isArray(doc.matches) && doc.matches.length) {
          for (const match of doc.matches) {
            const checkbox = createDocCheckbox(match, {
              hint: match.collectionName ? `From ${match.collectionName}` : null
            });
            filesWrap.appendChild(checkbox);
          }
        } else {
          const empty = document.createElement('div');
          empty.className = 'doc-empty';
          empty.textContent = 'No matching files yet.';
          filesWrap.appendChild(empty);
        }
        card.appendChild(filesWrap);
        container.appendChild(card);
      }
    }

    function renderAllFiles(container, files) {
      container.innerHTML = '';
      if (!files.length) {
        const empty = document.createElement('div');
        empty.className = 'doc-empty';
        empty.textContent = 'No documents uploaded yet.';
        container.appendChild(empty);
        return;
      }
      for (const file of files) {
        const card = document.createElement('div');
        card.className = 'doc-entry';
        const name = document.createElement('div');
        name.className = 'doc-entry-title';
        name.textContent = file.name || 'Untitled document';
        card.appendChild(name);
        const meta = document.createElement('div');
        meta.className = 'doc-entry-meta';
        const bits = [];
        if (file.collectionName) bits.push(file.collectionName);
        if (Number.isFinite(file.size)) bits.push(formatSize(file.size));
        meta.textContent = bits.join(' • ');
        card.appendChild(meta);
        const chooser = document.createElement('div');
        chooser.className = 'doc-files';
        chooser.appendChild(createDocCheckbox(file));
        card.appendChild(chooser);
        container.appendChild(card);
      }
    }

    function setDocError(msg) {
      if (!docError) return;
      if (msg) {
        docError.textContent = msg;
        docError.classList.remove('d-none');
      } else {
        docError.classList.add('d-none');
        docError.textContent = '';
      }
    }

    function setDocLoading(isLoading) {
      if (!docLoading) return;
      docLoading.classList.toggle('d-none', !isLoading);
      if (docRefresh) docRefresh.disabled = !!isLoading;
    }

    function setDocNotices(statuses) {
      activeDocStatuses = Array.isArray(statuses) ? statuses : [];
      if (!docNotices) return;
      docNotices.innerHTML = '';
      const included = activeDocStatuses.filter(s => s.status === 'included');
      const issues = activeDocStatuses.filter(s => s.status !== 'included');
      if (!included.length && !issues.length) {
        docNotices.classList.add('d-none');
        return;
      }
      docNotices.classList.remove('d-none');
      if (included.length) {
        const success = document.createElement('div');
        success.className = 'doc-notice success';
        const names = included.map(s => s.name || docState.selected.get(s.id)?.name || `Document ${s.id}`);
        success.textContent = `Grounding with ${names.join(', ')}.`;
        docNotices.appendChild(success);
      }
      for (const issue of issues) {
        const warn = document.createElement('div');
        warn.className = 'doc-notice';
        const label = issue.name || docState.selected.get(issue.id)?.name || `Document ${issue.id}`;
        const link = issue.viewUrl || docState.selected.get(issue.id)?.viewUrl;
        if (link) {
          const anchor = document.createElement('a');
          anchor.href = link;
          anchor.target = '_blank';
          anchor.rel = 'noopener';
          anchor.textContent = label;
          warn.appendChild(anchor);
          warn.appendChild(document.createTextNode(`: ${issue.reason || 'Not available.'}`));
        } else {
          warn.textContent = `${label}: ${issue.reason || 'Not available.'}`;
        }
        docNotices.appendChild(warn);
      }
    }

    function renderDocCatalogue(data) {
      docState.catalogue = data;
      docState.checkboxes.clear();
      docState.files.clear();

      const files = Array.isArray(data?.files) ? data.files : [];
      files.forEach(file => {
        docState.files.set(file.id, file);
      });

      // Refresh selected metadata; drop selections that vanished
      for (const [id, meta] of Array.from(docState.selected.entries())) {
        const fresh = docState.files.get(id);
        if (!fresh) {
          docState.selected.delete(id);
          continue;
        }
        docState.selected.set(id, {
          id,
          name: fresh.name || meta.name,
          viewUrl: fresh.viewUrl || meta.viewUrl,
          size: fresh.size,
          collectionName: fresh.collectionName
        });
      }

      if (docRequired) renderDocSection(docRequired, data?.required || []);
      if (docHelpful) renderDocSection(docHelpful, data?.helpful || []);
      if (docAll) renderAllFiles(docAll, files);
      updateDocSelectionUI();
      setDocNotices(activeDocStatuses);
      if (docSections) docSections.classList.remove('d-none');
    }

    async function loadDocCatalogue() {
      if (!docPanel) return;
      setDocLoading(true);
      setDocError('');
      try {
        const resp = await Auth.fetch('/api/vault/catalogue', { cache: 'no-store' });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(text || 'Unable to load vault catalogue');
        }
        const json = await resp.json();
        renderDocCatalogue(json);
      } catch (err) {
        console.error('[scenario-lab] catalogue load failed', err);
        setDocError(err?.message || 'Unable to load vault catalogue.');
      } finally {
        setDocLoading(false);
      }
    }

    function renderAnswerBadges(metaEl, statuses) {
      if (!metaEl) return;
      metaEl.innerHTML = '';
      const included = (statuses || []).filter(s => s.status === 'included');
      if (!included.length) {
        metaEl.classList.remove('active');
        return;
      }
      metaEl.classList.add('active');
      const label = document.createElement('div');
      label.className = 'doc-entry-meta';
      label.textContent = 'Sources:';
      metaEl.appendChild(label);

      const row = document.createElement('div');
      row.className = 'doc-badge-row';
      for (const entry of included) {
        const badge = document.createElement('a');
        badge.className = 'doc-badge';
        badge.target = '_blank';
        badge.rel = 'noopener';
        const fileMeta = docState.selected.get(entry.id) || docState.files.get(entry.id) || {};
        badge.href = entry.viewUrl || fileMeta.viewUrl || `/api/vault/files/${encodeURIComponent(entry.id)}/view`;
        badge.textContent = entry.name || fileMeta.name || `Document ${entry.id}`;
        row.appendChild(badge);
      }
      metaEl.appendChild(row);
    }

    function clearDocNotices() {
      setDocNotices([]);
    }

    // Example buttons paste text (no backend change)
    $$('.example-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chatText.value = btn.getAttribute('data-example') || '';
        autosize();
        setComposerEmpty(!chatText.value.trim());
        chatText.focus();
      });
    });

    // Shift+Enter = newline, Enter = submit
    chatText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.requestSubmit();
      }
    });

    // Input dynamics: mint arrow when has text; grey otherwise; auto-expand
    chatText.addEventListener('input', () => {
      autosize();
      setComposerEmpty(!chatText.value.trim());
    });

    btnNew.addEventListener('click', resetChat);

    btnStop.addEventListener('click', () => {
      try { aborter?.abort(); } catch {}
    });

    if (docRefresh) {
      docRefresh.addEventListener('click', () => {
        loadDocCatalogue();
      });
    }

    chatForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = (chatText.value || '').trim();
      if (!text) return;

      // Push user msg
      const userMsg = addMessage('user', text);
      userMsg.main.textContent = text;
      messages.push({ role: 'user', content: text });
      chatText.value = '';
      autosize();
      setComposerEmpty(true);

      // Assistant placeholder we stream into
      const assistantMsg = addMessage('assistant', '');
      const assistantMain = assistantMsg.main;
      const assistantMeta = assistantMsg.meta;

      aborter = new AbortController();
      setStreaming(true);
      let hadChunk = false;
      let sawDone = false;
      clearDocNotices();

      const selectedIds = Array.from(docState.selected.keys());

      try {
        const resp = await Auth.fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            vaultFileIds: selectedIds
          }),
          signal: aborter.signal
        });

        if (!resp.ok || !resp.body) {
          const t = await resp.text().catch(() => '');
          assistantMain.textContent = t || 'Sorry — something went wrong.';
          setStreaming(false);
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const parts = buf.split('\n\n');
          buf = parts.pop();
          for (const chunk of parts) {
            const line = chunk.trim();
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            if (jsonStr === '[DONE]') continue;
            try {
              const ev = JSON.parse(jsonStr);
              if (Array.isArray(ev.docStatuses)) {
                setDocNotices(ev.docStatuses);
                renderAnswerBadges(assistantMeta, ev.docStatuses);
                continue;
              }
              if (ev.error) {
                assistantMain.textContent = ev.error || 'Error.';
                continue;
              }
              if (ev.delta) {
                assistantMain.textContent += ev.delta;
                hadChunk = true;
              }
              if (ev.done) {
                sawDone = true;
                messages.push({ role: 'assistant', content: assistantMain.textContent });
              }
            } catch {}
          }
          scrollToBottom();
        }

        if (hadChunk && !sawDone) {
          messages.push({ role: 'assistant', content: assistantMain.textContent });
        } else if (!hadChunk) {
          messages.push({ role: 'assistant', content: assistantMain.textContent || 'Done.' });
        }
      } catch (e) {
        if (e?.name === 'AbortError') {
          assistantMain.textContent += '\n\n[stopped]';
        } else {
          console.error(e);
          assistantMain.textContent = 'Network error.';
        }
      } finally {
        setStreaming(false);
        aborter = null;
        renderAnswerBadges(assistantMeta, activeDocStatuses);
      }
    });

    // Init
    document.addEventListener('DOMContentLoaded', async () => {
      try {
        await Auth.requireAuth();
        Auth.setBannerTitle('Scenario Lab');
        autosize();
        setComposerEmpty(true);
        chatText.focus();
        loadDocCatalogue();
      } catch (e) {
        console.error(e);
      }
    });
  })();
