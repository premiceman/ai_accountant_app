// frontend/js/vault-schematics.js
(function () {
  const API_BASE = '/api/schematics';
  const state = {
    sessionId: null,
    docType: 'document',
    text: '',
    values: {},
    anchors: [],
    fieldMappings: {},
    builderMetadata: {
      sessionId: null,
      samples: [],
      colourPalette: {
        primary: '',
        secondary: '',
        accent: '',
        background: '',
        text: '',
      },
      columnTemplates: [],
      notes: '',
    },
    selection: '',
    busy: false,
  };

  const elements = {
    root: document.getElementById('schematic-builder'),
    openButton: document.getElementById('schematic-open'),
    closeButton: document.getElementById('schematic-close'),
    status: document.getElementById('schematic-status'),
    docType: document.getElementById('schematic-doc-type'),
    schemaName: document.getElementById('schematic-schema-name'),
    sampleInput: document.getElementById('schematic-sample'),
    sampleMeta: document.getElementById('schematic-sample-meta'),
    textPreview: document.getElementById('schematic-text-preview'),
    selection: document.getElementById('schematic-selection'),
    useSelection: document.getElementById('schematic-use-selection'),
    inferredFields: document.getElementById('schematic-inferred-fields'),
    mappingForm: document.getElementById('schematic-mapping-form'),
    fieldKey: document.getElementById('schematic-field-key'),
    anchorSelect: document.getElementById('schematic-anchor-select'),
    expectedType: document.getElementById('schematic-expected-type'),
    sampleValue: document.getElementById('schematic-sample-value'),
    clearForm: document.getElementById('schematic-clear-form'),
    mappingsList: document.getElementById('schematic-mappings-list'),
    colourPrimary: document.getElementById('schematic-colour-primary'),
    colourSecondary: document.getElementById('schematic-colour-secondary'),
    colourAccent: document.getElementById('schematic-colour-accent'),
    colourBackground: document.getElementById('schematic-colour-background'),
    colourText: document.getElementById('schematic-colour-text'),
    columnTemplates: document.getElementById('schematic-column-templates'),
    notes: document.getElementById('schematic-notes'),
    saveDraft: document.getElementById('schematic-save-draft'),
    saveActivate: document.getElementById('schematic-save-activate'),
  };

  let initialised = false;

  function authFetch(path, options) {
    if (window.Auth && typeof window.Auth.fetch === 'function') {
      return window.Auth.fetch(path, options);
    }
    return fetch(path, options);
  }

  function ensureMappingMap(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const result = {};
    Object.entries(raw).forEach(([key, value]) => {
      if (typeof key !== 'string') return;
      const trimmedKey = key.trim();
      if (!trimmedKey) return;
      if (!value || typeof value !== 'object') return;
      const expectedType = ['number', 'string', 'date'].includes(value.expectedType)
        ? value.expectedType
        : 'string';
      const entry = {
        strategy: typeof value.strategy === 'string' ? value.strategy : 'anchor+regex',
        expectedType,
      };
      if (typeof value.anchor === 'string') {
        entry.anchor = value.anchor;
      }
      if (entry.strategy === 'line-offset') {
        entry.lineOffset = Number.isInteger(value.lineOffset) ? value.lineOffset : 0;
      } else if (entry.strategy === 'box') {
        entry.top = Number.isFinite(Number(value.top)) ? Number(value.top) : 0;
        entry.left = Number.isFinite(Number(value.left)) ? Number(value.left) : 0;
        entry.width = Number.isFinite(Number(value.width)) ? Number(value.width) : 0;
        entry.height = Number.isFinite(Number(value.height)) ? Number(value.height) : 0;
      } else {
        entry.regex = typeof value.regex === 'string' ? value.regex : '';
      }
      if (Object.prototype.hasOwnProperty.call(value, 'sample')) {
        entry.sample = value.sample;
      }
      if (typeof value.notes === 'string') {
        entry.notes = value.notes;
      }
      result[trimmedKey] = entry;
    });
    return result;
  }

  function parseColumnTemplatesInput(text) {
    if (!text) return [];
    return text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length)
      .map((line) => {
        const [namePart, fieldsPart] = line.split('|');
        const name = (namePart || '').trim();
        if (!name) return null;
        const fields = (fieldsPart || '')
          .split(',')
          .map((field) => field.trim())
          .filter((field) => field.length);
        return { name, description: '', fields };
      })
      .filter(Boolean);
  }

  function serialiseColumnTemplates(templates) {
    if (!Array.isArray(templates)) return '';
    return templates
      .map((template) => {
        if (!template) return null;
        const name = (template.name || '').trim();
        const fields = Array.isArray(template.fields) ? template.fields.filter(Boolean).join(', ') : '';
        if (!name && !fields) return null;
        return fields ? `${name} | ${fields}` : name;
      })
      .filter(Boolean)
      .join('\n');
  }

  function formatBytes(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0) return '';
    const UNITS = ['B', 'KB', 'MB', 'GB'];
    let index = 0;
    let amount = size;
    while (amount >= 1024 && index < UNITS.length - 1) {
      amount /= 1024;
      index += 1;
    }
    return `${amount.toFixed(amount < 10 && index > 0 ? 1 : 0)} ${UNITS[index]}`;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  function detectExpectedType(payload) {
    const value = payload != null && typeof payload === 'object' && 'value' in payload ? payload.value : payload;
    if (typeof value === 'number') return 'number';
    if (value == null) return 'string';
    const asString = String(value).trim();
    if (!asString) return 'string';
    if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(asString)) return 'date';
    if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return 'date';
    if (/^-?\d{1,3}(?:[\s,]\d{3})*(?:\.\d+)?$/.test(asString)) return 'number';
    if (/^-?\d+(?:\.\d+)?$/.test(asString)) return 'number';
    return 'string';
  }

  function showStatus(message, tone = 'info') {
    if (!elements.status) return;
    elements.status.textContent = message || '';
    elements.status.classList.remove('is-error');
    if (tone === 'error') {
      elements.status.classList.add('is-error');
    }
  }

  function clearStatus() {
    showStatus('');
  }

  function setBusy(flag) {
    state.busy = flag;
    if (elements.saveDraft) elements.saveDraft.disabled = flag;
    if (elements.saveActivate) elements.saveActivate.disabled = flag;
    if (elements.mappingForm) {
      const submit = elements.mappingForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = flag;
    }
  }

  function applyPaletteInputs() {
    if (!state.builderMetadata.colourPalette) {
      state.builderMetadata.colourPalette = {
        primary: '',
        secondary: '',
        accent: '',
        background: '',
        text: '',
      };
    }
    const palette = state.builderMetadata.colourPalette;
    if (elements.colourPrimary) elements.colourPrimary.value = palette.primary || '';
    if (elements.colourSecondary) elements.colourSecondary.value = palette.secondary || '';
    if (elements.colourAccent) elements.colourAccent.value = palette.accent || '';
    if (elements.colourBackground) elements.colourBackground.value = palette.background || '';
    if (elements.colourText) elements.colourText.value = palette.text || '';
  }

  function renderAnchors() {
    if (!elements.anchorSelect) return;
    const previous = elements.anchorSelect.value;
    elements.anchorSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.anchors.length ? 'Select anchor…' : 'No anchors available';
    placeholder.disabled = !state.anchors.length;
    placeholder.selected = true;
    elements.anchorSelect.appendChild(placeholder);
    state.anchors.forEach((anchor) => {
      const option = document.createElement('option');
      option.value = anchor;
      option.textContent = anchor;
      if (anchor === previous) {
        option.selected = true;
      }
      elements.anchorSelect.appendChild(option);
    });
  }

  function renderSampleMeta() {
    if (!elements.sampleMeta) return;
    const samples = Array.isArray(state.builderMetadata.samples) ? state.builderMetadata.samples : [];
    if (!samples.length) {
      elements.sampleMeta.textContent = '';
      return;
    }
    const latest = samples[samples.length - 1];
    const parts = [];
    if (latest.name) parts.push(latest.name);
    if (latest.size) parts.push(formatBytes(latest.size));
    if (latest.uploadedAt) parts.push(formatDate(latest.uploadedAt));
    elements.sampleMeta.textContent = parts.join(' • ');
  }

  function renderTextPreview() {
    if (elements.textPreview) {
      elements.textPreview.value = state.text || '';
    }
  }

  function renderSelection() {
    if (!elements.selection) return;
    if (!state.selection) {
      elements.selection.textContent = '';
      return;
    }
    const preview = state.selection.length > 160 ? `${state.selection.slice(0, 157)}…` : state.selection;
    elements.selection.textContent = `Selection: “${preview}”`;
  }

  function renderInferredFields() {
    if (!elements.inferredFields) return;
    elements.inferredFields.innerHTML = '';
    const entries = Object.entries(state.values || {});
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'schematic-empty';
      empty.textContent = 'Upload a sample to see inferred fields.';
      elements.inferredFields.appendChild(empty);
      return;
    }
    entries
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([field, payload]) => {
        const item = document.createElement('div');
        item.className = 'schematic-list__item';
        const meta = document.createElement('div');
        const value = payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload;
        const source = payload && typeof payload === 'object' && payload.source ? payload.source : 'heuristic';
        meta.innerHTML = `<strong>${field}</strong>`;
        const details = document.createElement('div');
        details.className = 'schematic-list__meta';
        const valuePreview = value == null || value === '' ? '—' : String(value);
        details.innerHTML = `<span>${valuePreview}</span><span>${source}</span>`;
        meta.appendChild(details);
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'btn btn-outline-primary btn-sm';
        action.textContent = 'Use';
        action.addEventListener('click', () => {
          if (elements.fieldKey) elements.fieldKey.value = field;
          const inferredType = detectExpectedType(payload);
          if (elements.expectedType) elements.expectedType.value = inferredType;
          if (elements.sampleValue) elements.sampleValue.value = value == null ? '' : String(value);
          showStatus(`Loaded “${field}” into the mapping form.`);
        });
        item.appendChild(meta);
        item.appendChild(action);
        elements.inferredFields.appendChild(item);
      });
  }

  function renderMappings() {
    if (!elements.mappingsList) return;
    elements.mappingsList.innerHTML = '';
    const entries = Object.entries(state.fieldMappings || {});
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'schematic-empty';
      empty.textContent = 'No custom mappings yet.';
      elements.mappingsList.appendChild(empty);
      return;
    }
    entries.forEach(([field, mapping]) => {
      const item = document.createElement('div');
      item.className = 'schematic-mapping';
      const body = document.createElement('div');
      body.innerHTML = `<div class="schematic-mapping__title">${field}</div>`;
      const meta = document.createElement('div');
      meta.className = 'schematic-mapping__meta';
      const anchor = mapping.anchor ? `Anchor: ${mapping.anchor}` : 'No anchor';
      const strategy = mapping.strategy || 'anchor+regex';
      const sample = mapping.sample == null || mapping.sample === '' ? null : String(mapping.sample);
      meta.innerHTML = `
        <span>Strategy: ${strategy}</span>
        <span>Type: ${mapping.expectedType || 'string'}</span>
        <span>${anchor}</span>
        <span>${sample ? `Sample: ${sample}` : ''}</span>
      `;
      body.appendChild(meta);
      const actions = document.createElement('div');
      actions.className = 'schematic-mapping__actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-outline-secondary btn-sm';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        if (elements.fieldKey) elements.fieldKey.value = field;
        if (elements.expectedType) elements.expectedType.value = mapping.expectedType || 'string';
        if (elements.anchorSelect) elements.anchorSelect.value = mapping.anchor || '';
        if (elements.sampleValue) elements.sampleValue.value = mapping.sample == null ? '' : String(mapping.sample);
        showStatus(`Loaded mapping for “${field}” for editing.`);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-outline-danger btn-sm';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        delete state.fieldMappings[field];
        state.builderMetadata.fieldMappings = { ...state.fieldMappings };
        renderMappings();
        persistSessionPatch();
        showStatus(`Removed mapping for “${field}”.`);
      });
      actions.appendChild(edit);
      actions.appendChild(remove);
      item.appendChild(body);
      item.appendChild(actions);
      elements.mappingsList.appendChild(item);
    });
  }

  function renderBuilderMetadata() {
    applyPaletteInputs();
    if (elements.columnTemplates) {
      elements.columnTemplates.value = serialiseColumnTemplates(state.builderMetadata.columnTemplates);
    }
    if (elements.notes) {
      elements.notes.value = state.builderMetadata.notes || '';
    }
    renderSampleMeta();
  }

  function renderAll() {
    if (elements.docType) elements.docType.value = state.docType || 'document';
    renderAnchors();
    renderSampleMeta();
    renderTextPreview();
    renderSelection();
    renderInferredFields();
    renderMappings();
    renderBuilderMetadata();
  }

  function applySession(session) {
    if (!session || typeof session !== 'object') return;
    state.sessionId = session.id || session.sessionId || state.sessionId;
    state.docType = session.docType || state.docType || 'document';
    state.text = session.text || '';
    state.values = session.values || {};
    state.anchors = Array.isArray(session.anchors) ? session.anchors : [];
    const fieldMappings = session.builderMetadata?.fieldMappings || session.fieldMappings;
    state.fieldMappings = ensureMappingMap(fieldMappings);
    state.builderMetadata = {
      sessionId: session.builderMetadata?.sessionId || state.sessionId || null,
      samples: Array.isArray(session.builderMetadata?.samples) ? session.builderMetadata.samples : [],
      colourPalette: session.builderMetadata?.colourPalette || {
        primary: '',
        secondary: '',
        accent: '',
        background: '',
        text: '',
      },
      columnTemplates: Array.isArray(session.builderMetadata?.columnTemplates)
        ? session.builderMetadata.columnTemplates
        : [],
      notes: session.builderMetadata?.notes || '',
      fieldMappings: ensureMappingMap(fieldMappings),
    };
    renderAll();
  }

  async function persistSessionPatch(extraPayload) {
    if (!state.sessionId) return;
    const payload = {
      docType: state.docType,
      fieldMappings: state.fieldMappings,
      builderMetadata: {
        sessionId: state.sessionId,
        samples: state.builderMetadata.samples,
        colourPalette: state.builderMetadata.colourPalette,
        columnTemplates: state.builderMetadata.columnTemplates,
        fieldMappings: state.fieldMappings,
        notes: state.builderMetadata.notes,
      },
      ...extraPayload,
    };
    try {
      await authFetch(`${API_BASE}/sessions/${state.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.warn('Failed to persist schematic session', error);
    }
  }

  async function uploadSample(file) {
    if (!file) return;
    if (!elements.sampleInput) return;
    setBusy(true);
    showStatus(`Uploading “${file.name}”…`);
    const formData = new FormData();
    formData.append('sample', file);
    formData.append('docType', state.docType || 'document');
    if (state.sessionId) {
      formData.append('sessionId', state.sessionId);
    }
    try {
      const response = await authFetch(`${API_BASE}/preview`, { method: 'POST', body: formData });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Preview request failed');
      }
      const payload = await response.json();
      applySession(payload.session);
      showStatus(`Preview updated using “${file.name}”.`);
    } catch (error) {
      console.error('Failed to upload preview sample', error);
      showStatus(error.message || 'Failed to process sample upload', 'error');
    } finally {
      setBusy(false);
    }
  }

  function buildRegexForSample(expectedType) {
    if (expectedType === 'number') return '([0-9.,-]+)';
    if (expectedType === 'date') return '([0-9A-Za-z\s/.-]+)';
    return '(.+?)';
  }

  function handleAddMapping(event) {
    event.preventDefault();
    if (!elements.fieldKey || !elements.sampleValue) return;
    const key = elements.fieldKey.value.trim();
    const anchor = elements.anchorSelect ? elements.anchorSelect.value.trim() : '';
    const expectedType = elements.expectedType ? elements.expectedType.value : 'string';
    const sample = elements.sampleValue.value.trim();
    if (!key) {
      showStatus('Enter a schema key before adding a mapping.', 'error');
      return;
    }
    if (!anchor) {
      showStatus('Select an anchor to bind the mapping to.', 'error');
      return;
    }
    const mapping = {
      strategy: 'anchor+regex',
      expectedType,
      anchor,
      regex: buildRegexForSample(expectedType),
    };
    if (sample) {
      mapping.sample = sample;
    }
    state.fieldMappings = { ...state.fieldMappings, [key]: mapping };
    state.builderMetadata.fieldMappings = { ...state.fieldMappings };
    renderMappings();
    persistSessionPatch();
    showStatus(`Saved mapping for “${key}”.`);
    elements.mappingForm.reset();
    renderAnchors();
  }

  function handleClearForm() {
    if (elements.mappingForm) elements.mappingForm.reset();
    renderAnchors();
    showStatus('Mapping form cleared.');
  }

  function captureSelection() {
    if (!elements.textPreview) return;
    const start = elements.textPreview.selectionStart;
    const end = elements.textPreview.selectionEnd;
    if (typeof start !== 'number' || typeof end !== 'number' || end <= start) {
      state.selection = '';
    } else {
      const snippet = elements.textPreview.value.slice(start, end).trim();
      state.selection = snippet.slice(0, 512);
    }
    renderSelection();
  }

  function useSelectionAsSample() {
    if (!state.selection) {
      showStatus('Highlight text in the preview to populate the sample value.', 'error');
      return;
    }
    if (elements.sampleValue) {
      elements.sampleValue.value = state.selection;
    }
    showStatus('Selection added to the mapping form.');
  }

  function updatePaletteFromInputs() {
    state.builderMetadata.colourPalette = {
      primary: elements.colourPrimary ? elements.colourPrimary.value.trim() : '',
      secondary: elements.colourSecondary ? elements.colourSecondary.value.trim() : '',
      accent: elements.colourAccent ? elements.colourAccent.value.trim() : '',
      background: elements.colourBackground ? elements.colourBackground.value.trim() : '',
      text: elements.colourText ? elements.colourText.value.trim() : '',
    };
    persistSessionPatch();
  }

  function updateColumnTemplates() {
    state.builderMetadata.columnTemplates = parseColumnTemplatesInput(elements.columnTemplates ? elements.columnTemplates.value : '');
    persistSessionPatch();
  }

  function updateNotes() {
    state.builderMetadata.notes = elements.notes ? elements.notes.value : '';
    persistSessionPatch();
  }

  async function saveSchematic(activate) {
    if (!elements.schemaName) return;
    const name = elements.schemaName.value.trim();
    if (!name) {
      showStatus('Enter a name for the schematic.', 'error');
      return;
    }
    if (!Object.keys(state.fieldMappings).length) {
      showStatus('Add at least one mapping before saving.', 'error');
      return;
    }
    setBusy(true);
    clearStatus();
    const payload = {
      docType: state.docType || 'document',
      name,
      rules: state.fieldMappings,
      builderMetadata: {
        sessionId: state.sessionId,
        samples: state.builderMetadata.samples,
        colourPalette: state.builderMetadata.colourPalette,
        columnTemplates: state.builderMetadata.columnTemplates,
        fieldMappings: state.fieldMappings,
        notes: state.builderMetadata.notes,
      },
    };
    try {
      const response = await authFetch(`${API_BASE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save schematic');
      }
      showStatus('Schematic saved as draft.');
      if (activate && data && data._id) {
        const activateResponse = await authFetch(`${API_BASE}/${data._id}/activate`, { method: 'POST' });
        if (!activateResponse.ok) {
          const text = await activateResponse.text();
          throw new Error(text || 'Failed to activate schematic');
        }
        showStatus('Schematic saved and activated.');
      }
    } catch (error) {
      console.error('Failed to save schematic', error);
      showStatus(error.message || 'Failed to save schematic', 'error');
    } finally {
      setBusy(false);
    }
  }

  function open() {
    if (!elements.root) return;
    elements.root.hidden = false;
    clearStatus();
    if (elements.root.scrollIntoView) {
      elements.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (elements.schemaName && !elements.schemaName.value) {
      elements.schemaName.focus();
    }
  }

  function close() {
    if (!elements.root) return;
    elements.root.hidden = true;
  }

  function bindEvents() {
    if (elements.openButton) {
      elements.openButton.addEventListener('click', (event) => {
        event.preventDefault();
        open();
      });
    }
    if (elements.closeButton) {
      elements.closeButton.addEventListener('click', () => {
        close();
      });
    }
    if (elements.docType) {
      elements.docType.addEventListener('change', () => {
        state.docType = elements.docType.value || 'document';
        persistSessionPatch({ docType: state.docType });
      });
    }
    if (elements.sampleInput) {
      elements.sampleInput.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) {
          uploadSample(file).catch(() => {});
          event.target.value = '';
        }
      });
    }
    if (elements.textPreview) {
      ['mouseup', 'keyup', 'selectionchange'].forEach((eventName) => {
        elements.textPreview.addEventListener(eventName, () => {
          captureSelection();
        });
      });
    }
    if (elements.useSelection) {
      elements.useSelection.addEventListener('click', (event) => {
        event.preventDefault();
        useSelectionAsSample();
      });
    }
    if (elements.mappingForm) {
      elements.mappingForm.addEventListener('submit', handleAddMapping);
    }
    if (elements.clearForm) {
      elements.clearForm.addEventListener('click', handleClearForm);
    }
    if (elements.colourPrimary) {
      [
        elements.colourPrimary,
        elements.colourSecondary,
        elements.colourAccent,
        elements.colourBackground,
        elements.colourText,
      ].forEach((input) => {
        if (!input) return;
        input.addEventListener('change', updatePaletteFromInputs);
        input.addEventListener('blur', updatePaletteFromInputs);
      });
    }
    if (elements.columnTemplates) {
      elements.columnTemplates.addEventListener('blur', updateColumnTemplates);
    }
    if (elements.notes) {
      elements.notes.addEventListener('blur', updateNotes);
    }
    if (elements.saveDraft) {
      elements.saveDraft.addEventListener('click', () => {
        saveSchematic(false);
      });
    }
    if (elements.saveActivate) {
      elements.saveActivate.addEventListener('click', () => {
        saveSchematic(true);
      });
    }
  }

  function init() {
    if (initialised) return;
    initialised = true;
    if (!elements.root) return;
    bindEvents();
    renderAnchors();
    renderBuilderMetadata();
  }

  init();

  window.VaultSchematics = {
    open,
    init,
    applySession,
  };
})();
