// frontend/js/documents.js
let ALL_FILES = []; // cache of /api/docs to render lists & modals

(async function init() {
  try {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Documents');
    await renderDocsTable();  // table + progress + actions
  } catch (e) {
    console.error(e);
    setMsg('Failed to load documents.');
  }
})();

// ---- Catalogue (required + helpful) ----
const DOCS = [
  { key: 'proof_of_id',   label: 'Proof of ID',                       cadence:{months:60},  why:'Verify identity for KYC/AML and secure account changes.', where:'Passport or Driving Licence (DVLA).',                 required:true },
  { key: 'address_proof', label: 'Proof of Address',                  cadence:{months:6},   why:'Confirm residency for tax rules and correspondence.',      where:'Utility bill, bank statement, council tax bill (≤3m).', required:true },
  { key: 'bank_statements', label:'Bank Statements (last 3 months)',  cadence:{months:1},   why:'Reconcile income/expenses; evidence for SA computations.', where:'Download PDF statements from online banking.',          required:true },
  { key: 'p60',           label: 'P60 (latest)',                      cadence:{yearlyBy:'06-01'}, why:'Year-end summary of pay & tax for SA.',              where:'Employer/Payroll portal; issued after 5 April.',        required:true },
  { key: 'p45',           label: 'P45 (if changed jobs)',             cadence:{adhoc:true}, why:'Shows tax paid to date when leaving an employer.',        where:'Issued by previous employer.',                          required:false },
  { key: 'invoices',      label: 'Invoices (self-employed)',          cadence:{months:1},   why:'Evidence of income for SA; helps compute profit.',         where:'Your bookkeeping tool or invoice PDFs.',                required:false },
  { key: 'receipts',      label: 'Expense Receipts',                  cadence:{months:1},   why:'Evidence of allowable expenses for relief claims.',        where:'Photos/PDFs; accounting app exports.',                  required:false },
  { key: 'vat_returns',   label: 'VAT Returns',                       cadence:{months:3},   why:'Evidence of VAT submissions and payments.',               where:'HMRC VAT portal or VAT software export.',               required:false }
];

// ---- Render table and progress ----
async function renderDocsTable() {
  setMsg('Loading…');

  // fetch all files (best-effort)
  ALL_FILES = [];
  try {
    const r = await Auth.fetch('/api/docs');
    if (r.ok) {
      const j = await r.json();
      ALL_FILES = Array.isArray(j.files) ? j.files : [];
    }
  } catch {}

  // latest per type
  const latestByType = {};
  for (const f of ALL_FILES) {
    const t = f.type || 'other';
    if (!latestByType[t] || new Date(f.uploadDate) > new Date(latestByType[t].uploadDate)) {
      latestByType[t] = f;
    }
  }

  // completion
  const cmp = computeCompletion(latestByType);
  updateProgress(cmp);

  // table
  const tbody = document.getElementById('docs-table-body');
  tbody.innerHTML = '';

  for (const d of DOCS) {
    const latest = latestByType[d.key] || null;
    const lastUploaded = latest?.uploadDate ? new Date(latest.uploadDate) : null;
    const overdue = isOverdue(d.cadence, lastUploaded);

    const tr = document.createElement('tr');
    tr.dataset.key = d.key;
    tr.innerHTML = `
      <td class="fw-semibold">${d.label}</td>
      <td>${d.required ? '<span class="badge text-bg-danger">Required</span>' : '<span class="badge text-bg-secondary">Helpful</span>'}</td>
      <td>${statusBadge(latest, overdue)}</td>
      <td>${lastUploaded ? fmtDateTime(lastUploaded) : '—'}</td>
      <td>${dueLabel(d.cadence, lastUploaded)}</td>
      <td class="small text-muted doc-why">${escapeHtml(d.why)}</td>
      <td class="small text-muted doc-where">${escapeHtml(d.where)}</td>
      <td class="text-end">
        <div class="btn-group">
          <button class="btn btn-sm btn-primary" data-action="upload" data-type="${d.key}">Upload</button>
          <button class="btn btn-sm btn-outline-secondary" data-action="view" data-type="${d.key}">View files (${countFiles(d.key)})</button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete-latest" data-type="${d.key}" ${latest ? '' : 'disabled'}>Delete latest</button>
        </div>
      </td>
    `;

    // actions
    tr.querySelector('[data-action="upload"]').addEventListener('click', () => triggerUpload(d.key));
    tr.querySelector('[data-action="view"]').addEventListener('click', () => openFilesModal(d.key, d.label));
    const delLatest = tr.querySelector('[data-action="delete-latest"]');
    if (delLatest) delLatest.addEventListener('click', async () => {
      if (!latest) return;
      if (!confirm('Delete the latest uploaded file for this document?')) return;
      await deleteFile(latest.id);
    });

    tbody.appendChild(tr);
  }

  setMsg('');
}

// ---- Progress helpers ----
function computeCompletion(latestByType) {
  const required = DOCS.filter(d => d.required);
  const overall  = DOCS;

  const isUpToDate = (d) => {
    const last = latestByType[d.key]?.uploadDate ? new Date(latestByType[d.key].uploadDate) : null;
    return !!last && !isOverdue(d.cadence, last);
  };

  const reqDone = required.filter(isUpToDate).length;
  const allDone = overall.filter(isUpToDate).length;

  return {
    required: { done: reqDone, total: required.length, pct: pct(reqDone, required.length) },
    overall:  { done: allDone, total: overall.length,  pct: pct(allDone, overall.length) }
  };
}

function updateProgress(cmp) {
  const bar = document.getElementById('progress-bar');
  const cap = document.getElementById('progress-caption');
  const sub = document.getElementById('progress-subcaption');
  bar.style.width = `${cmp.required.pct}%`;
  bar.setAttribute('aria-valuenow', String(cmp.required.pct));
  bar.textContent = `${cmp.required.pct}%`;
  cap.textContent = `${cmp.required.done} / ${cmp.required.total} complete`;
  sub.textContent = `Overall (required + helpful): ${cmp.overall.done} / ${cmp.overall.total} (${cmp.overall.pct}%)`;
}

function pct(a,b){ return b ? Math.round((a/b)*100) : 0; }

// ---- Modal (list all files per type, delete individually) ----
function openFilesModal(typeKey, label) {
  const list = ALL_FILES.filter(f => (f.type || 'other') === typeKey)
                        .sort((a,b)=> new Date(b.uploadDate)-new Date(a.uploadDate));
  const body = document.getElementById('filesModalBody');
  const title = document.getElementById('filesModalLabel');
  title.textContent = `${label} — Files`;

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="text-muted small">No files uploaded yet.</td></tr>`;
  } else {
    body.innerHTML = '';
    for (const f of list) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(f.filename || 'file')}</td>
        <td>${f.uploadDate ? fmtDateTime(new Date(f.uploadDate)) : '—'}</td>
        <td>${humanSize(f.length)}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger" data-id="${f.id}">Delete</button>
        </td>
      `;
      tr.querySelector('button').addEventListener('click', async () => {
        if (!confirm(`Delete "${f.filename}"?`)) return;
        await deleteFile(f.id, /*refreshModal*/true, typeKey, label);
      });
      body.appendChild(tr);
    }
  }

  const modal = new bootstrap.Modal(document.getElementById('filesModal'));
  modal.show();
}

async function deleteFile(fileId, refreshModal=false, typeKey=null, label='') {
  try {
    const res = await Auth.fetch(`/api/docs/${fileId}`, { method: 'DELETE' });
    if (!res.ok) {
      const t = await res.text().catch(()=> '');
      alert('Delete failed: ' + t);
      return;
    }
    // refresh cache + UI
    await renderDocsTable();
    if (refreshModal && typeKey) openFilesModal(typeKey, label);
  } catch (e) {
    alert('Delete failed (network).');
  }
}

// ---- Upload flow (unchanged, with size hint) ----
function triggerUpload(typeKey) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.jpeg,.png,.csv,.heic,.webp';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const year = currentTaxYearStart(new Date());
    try {
      const r = await fetch(window.API?.url(`/api/docs?type=${encodeURIComponent(typeKey)}&year=${year}`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${Auth.getToken()}` },
        body: fd
      });
      if (!r.ok) {
        let msg = 'Upload failed.';
        try { const j = await r.json(); if (j?.error) msg = j.error; } catch { const t = await r.text().catch(()=> ''); if (t) msg = t; }
        alert(msg);
        return;
      }
      await renderDocsTable();
    } catch {
      alert('Upload failed (network).');
    }
  };
  input.click();
}

// ---- Utilities ----
function statusBadge(latest, overdue) {
  if (!latest) return '<span class="badge text-bg-secondary">Missing</span>';
  if (overdue) return '<span class="badge text-bg-warning">Overdue</span>';
  return '<span class="badge text-bg-success">Up to date</span>';
}

function isOverdue(cadence, last) {
  if (cadence?.adhoc) return false;
  const now = new Date();
  if (cadence?.yearlyBy) {
    const [mm, dd] = cadence.yearlyBy.split('-').map(Number);
    const due = new Date(now.getFullYear(), mm - 1, dd);
    return now > due && (!last || last < due);
  }
  if (cadence?.months) {
    if (!last) return true;
    const next = new Date(last); next.setMonth(next.getMonth() + cadence.months);
    return now > next;
  }
  if (!last) return true;
  const next = new Date(last); next.setMonth(next.getMonth() + 12);
  return now > next;
}

function dueLabel(cadence, last) {
  if (cadence?.adhoc) return 'As needed';
  const now = new Date();
  if (cadence?.yearlyBy) {
    const [mm, dd] = cadence.yearlyBy.split('-').map(Number);
    const due = new Date(now.getFullYear(), mm - 1, dd);
    return (now > due && (!last || last < due)) ? `Overdue (was due ${due.toLocaleDateString()})` : `Due by ${due.toLocaleDateString()}`;
  }
  if (cadence?.months) {
    if (!last) return 'Overdue (no upload yet)';
    const next = new Date(last); next.setMonth(next.getMonth() + cadence.months);
    return (now > next) ? `Overdue (was due ${next.toLocaleDateString()})` : `Due ${next.toLocaleDateString()}`;
  }
  if (!last) return 'Overdue (no upload yet)';
  const next = new Date(last); next.setMonth(next.getMonth() + 12);
  return (now > next) ? `Overdue (was due ${next.toLocaleDateString()})` : `Due ${next.toLocaleDateString()}`;
}

function fmtDateTime(d) { try { return d.toLocaleString(); } catch { return '—'; } }
function humanSize(bytes) {
  const b = Number(bytes||0);
  if (b < 1024) return `${b} B`;
  const kb = b/1024; if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb/1024; if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb/1024; return `${gb.toFixed(1)} GB`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setMsg(t){ const el=document.getElementById('docs-msg'); if(el) el.textContent=t||''; }
function currentTaxYearStart(d){ const y=d.getFullYear(); const starts=new Date(y,3,6); return d>=starts?y:y-1; }
function countFiles(typeKey){ return ALL_FILES.filter(f => (f.type||'other')===typeKey).length; }

  