// frontend/js/schematic-builder.js
// Minimal statement schematic builder UI
(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const apiBase = window.__API_BASE || '';
  const params = new URLSearchParams(window.location.search);
  const schematicId = params.get('id');

  const elName = $('#schematic-name');
  const elMeta = $('#schematic-meta');
  const elSave = $('#save-btn');
  const elAlert = $('#builder-alert');
  const elFirstRow = $('#first-row');
  const elRowStride = $('#row-stride');
  const elMaxRows = $('#max-rows');
  const elStopRegex = $('#stop-regex');
  const elColumnRows = $('#column-rows');
  const elClusterHint = $('#cluster-hint');
  const elAddColumn = $('#add-column-btn');

  let schematic = null;
  let fieldRules = {};

  function showAlert(type, message) {
    if (!elAlert) return;
    elAlert.className = `alert alert-${type}`;
    elAlert.textContent = message;
    elAlert.classList.remove('d-none');
  }

  function clearAlert() {
    if (!elAlert) return;
    elAlert.classList.add('d-none');
    elAlert.textContent = '';
  }

  function createColumnRow(data = {}) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <select class="form-select" data-field="key">
          <option value="date">Date</option>
          <option value="description">Description</option>
          <option value="amount">Amount</option>
          <option value="ignore">Ignore</option>
        </select>
      </td>
      <td><input type="number" class="form-control" data-field="start" placeholder="e.g. 0"></td>
      <td><input type="number" class="form-control" data-field="end" placeholder="e.g. 24"></td>
      <td><input type="text" class="form-control" data-field="regex" placeholder="Optional capture regex"></td>
      <td class="text-end">
        <button type="button" class="btn btn-outline-danger" data-action="remove-column" title="Remove column">
          <i class="bi bi-x-lg"></i>
        </button>
      </td>
    `;
    const keySelect = $('[data-field="key"]', row);
    const startInput = $('[data-field="start"]', row);
    const endInput = $('[data-field="end"]', row);
    const regexInput = $('[data-field="regex"]', row);

    if (data.key) keySelect.value = data.key;
    if (typeof data.start === 'number') startInput.value = String(data.start);
    if (typeof data.end === 'number') endInput.value = String(data.end);
    if (data.regex) regexInput.value = data.regex;

    $('[data-action="remove-column"]', row)?.addEventListener('click', () => {
      row.remove();
    });

    elColumnRows?.appendChild(row);
  }

  function loadColumns(columns) {
    elColumnRows.innerHTML = '';
    if (!Array.isArray(columns) || !columns.length) {
      ['date', 'description', 'amount'].forEach((key) => createColumnRow({ key }));
      return;
    }
    columns.forEach((col) => createColumnRow(col));
  }

  function serialiseColumns() {
    return $$('#column-rows tr').map((row) => {
      const key = $('[data-field="key"]', row)?.value || 'description';
      const startRaw = $('[data-field="start"]', row)?.value ?? '';
      const endRaw = $('[data-field="end"]', row)?.value ?? '';
      const regex = $('[data-field="regex"]', row)?.value?.trim() || undefined;
      const start = startRaw ? Number.parseInt(startRaw, 10) : undefined;
      const end = endRaw ? Number.parseInt(endRaw, 10) : undefined;
      return {
        key,
        start: Number.isFinite(start) ? start : undefined,
        end: Number.isFinite(end) ? end : undefined,
        regex,
      };
    });
  }

  function extractFieldRules(rawRules) {
    if (!rawRules || typeof rawRules !== 'object') return {};
    if (rawRules.fields && typeof rawRules.fields === 'object') {
      return rawRules.fields;
    }
    const entries = Object.entries(rawRules).filter(([, value]) => value && typeof value === 'object' && value.strategy);
    if (entries.length) {
      return Object.fromEntries(entries);
    }
    return {};
  }

  function hydrate(template) {
    if (!template) {
      elFirstRow.value = '';
      elRowStride.value = '1';
      elMaxRows.value = '';
      elStopRegex.value = '';
      loadColumns([]);
      return;
    }
    elFirstRow.value = template.startLine != null ? String(template.startLine + 1) : '';
    elRowStride.value = template.lineStride != null ? String(template.lineStride) : '1';
    elMaxRows.value = template.maxRows != null ? String(template.maxRows) : '';
    elStopRegex.value = template.stopRegex || '';
    loadColumns(template.columns || []);
  }

  function updateClusterHint(template) {
    if (!template || !elClusterHint) {
      elClusterHint.hidden = true;
      return;
    }
    const stride = template.lineStride && template.lineStride > 1 ? template.lineStride : 1;
    const message = stride > 1 ? `Repeating every ${stride} lines` : 'Repeating every line';
    elClusterHint.textContent = message;
    elClusterHint.hidden = false;
  }

  async function fetchSchematic() {
    if (!schematicId) {
      showAlert('danger', 'Missing schematic ID in query string.');
      elSave.disabled = true;
      return;
    }
    try {
      const res = await fetch(`${apiBase}/api/schematics/${encodeURIComponent(schematicId)}`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      schematic = await res.json();
      fieldRules = extractFieldRules(schematic.rules || {});
      const statement = schematic.rules?.statement || {};
      const template = Array.isArray(statement.templates) ? statement.templates[0] : null;
      if (elName) elName.textContent = schematic.name || 'Untitled schematic';
      if (elMeta) {
        const docLabel = schematic.docType ? schematic.docType.replace(/_/g, ' ') : 'document';
        elMeta.textContent = `${docLabel} · ${schematic.status || 'draft'}`;
      }
      hydrate(template);
      updateClusterHint(template);
      elSave.disabled = false;
      clearAlert();
    } catch (err) {
      console.error('[schematic-builder] failed to load schematic', err);
      showAlert('danger', 'Unable to load schematic. Please try again.');
      elSave.disabled = true;
    }
  }

  function buildTemplatePayload() {
    const firstRow = Number.parseInt(elFirstRow.value, 10);
    const stride = Number.parseInt(elRowStride.value || '1', 10) || 1;
    const maxRows = Number.parseInt(elMaxRows.value, 10);
    const columns = serialiseColumns().filter((col) => col && col.key);
    return {
      startLine: Number.isFinite(firstRow) && firstRow > 0 ? firstRow - 1 : 0,
      lineStride: Number.isFinite(stride) && stride > 0 ? stride : 1,
      maxRows: Number.isFinite(maxRows) && maxRows > 0 ? maxRows : undefined,
      stopRegex: elStopRegex.value.trim() || undefined,
      columns,
      id: 'template-1',
      label: 'Statement rows',
    };
  }

  async function saveSchematic() {
    if (!schematic) return;
    clearAlert();
    elSave.disabled = true;
    elSave.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving…';

    const template = buildTemplatePayload();
    const rules = {
      fields: fieldRules,
      statement: { templates: [template] },
    };

    try {
      const res = await fetch(`${apiBase}/api/schematics/${encodeURIComponent(schematic._id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: schematic.name,
          docType: schematic.docType,
          fingerprint: schematic.fingerprint ?? null,
          rules,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      showAlert('success', 'Schematic saved successfully.');
      updateClusterHint(template);
    } catch (err) {
      console.error('[schematic-builder] failed to save schematic', err);
      showAlert('danger', err instanceof Error ? err.message : 'Failed to save schematic');
    } finally {
      elSave.disabled = false;
      elSave.innerHTML = '<i class="bi bi-save me-1"></i>Save schematic';
    }
  }

  async function init() {
    if (window.Auth && typeof Auth.enforce === 'function') {
      try {
        await Auth.enforce({ validateWithServer: true });
      } catch (err) {
        console.warn('[schematic-builder] auth enforcement failed', err);
      }
    }
    if (!schematicId) {
      showAlert('danger', 'Provide a schematic ID using ?id= in the URL.');
      return;
    }
    await fetchSchematic();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    elSave?.addEventListener('click', (event) => {
      event.preventDefault();
      saveSchematic();
    });
    elAddColumn?.addEventListener('click', (event) => {
      event.preventDefault();
      createColumnRow({ key: 'description' });
    });
  });
})();
