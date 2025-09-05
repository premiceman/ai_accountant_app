// frontend/js/documents.js
let ALL_FILES = []; // cache of /api/docs to render lists & modals

// -------------------------------- Init ------------------------------------
(async function init() {
  try {
    await Auth.requireAuth();
    Auth.setBannerTitle('Documents');
    await renderDocsTable();  // table + progress + actions
  } catch (e) {
    console.error(e);
    setMsg('Failed to load documents.');
  }
})();

// ---- UK catalogue (required + helpful) ----
const DOCS = [
  // Identity & Residency
  { key: 'proof_of_id',         label: 'Proof of ID',                                 cadence:{months:60},  why:'Verify identity (KYC/AML), protect account changes.', where:'Passport or DVLA Driving Licence.',                          required:true },
  { key: 'proof_of_address',    label: 'Proof of Address',                            cadence:{months:6},   why:'Confirm UK residency for tax and correspondence.',     where:'Recent utility bill, bank/credit statement, council tax.',    required:true },

  // Self Assessment / HMRC
  { key: 'sa100_return_copy',   label: 'SA100 Self Assessment (copy)',                cadence:{yearlyBy:'01-31'}, why:'Record of filed return; carry-forwards, audit.',   where:'HMRC online → Self Assessment.',                               required:true },
  { key: 'sa302_tax_calc',      label: 'SA302 / Tax Calculation',                     cadence:{yearlyBy:'01-31'}, why:'Official calculation; supports mortgages/audit.',  where:'HMRC online → SA tax calculation.',                             required:true },
  { key: 'hmrc_statement',      label: 'HMRC Statement of Account',                   cadence:{yearlyBy:'01-31'}, why:'Shows balancing payment & payments on account.',    where:'HMRC online → SA account.',                                     required:true },

  // Employment & Payroll
  { key: 'p60',                 label: 'P60 End of Year Certificate',                 cadence:{yearlyBy:'06-01'}, why:'Summary of pay & tax; essential for SA.',          where:'Employer/Payroll portal (by 31 May).',                         required:true },
  { key: 'p11d',                label: 'P11D Benefits in Kind',                       cadence:{yearlyBy:'07-06'}, why:'Taxable benefits (car, medical, etc.).',           where:'Employer/Payroll portal (by 6 July).',                         required:true },
  { key: 'p45',                 label: 'P45 (leaver\'s certificate)',                 cadence:{adhoc:true},        why:'Pay/tax to date when leaving a job.',            where:'Provided by former employer.',                                  required:false },
  { key: 'payslips',            label: 'Payslips (monthly)',                          cadence:{months:1},          why:'Reconcile vs bank & P60/P11D.',                  where:'Employer/Payroll portal.',                                      required:false },

  // Pensions & Wrappers
  { key: 'pension_statement',   label: 'Pension Annual Statement (SIPP/Workplace)',   cadence:{yearlyBy:'06-30'},  why:'Tracks contributions (PIA) vs Annual Allowance.', where:'Pension provider portal/annual pack.',                          required:true },
  { key: 'pension_pia',         label: 'Pension Input Amounts (last 3 years)',        cadence:{yearlyBy:'06-30'},  why:'Needed for carry-forward and AA charges.',        where:'Pension schemes provide PIA per tax year.',                     required:true },
  { key: 'isa_statement',       label: 'ISA Annual Statement',                        cadence:{yearlyBy:'05-31'},  why:'Evidence of ISA subscriptions/limits.',           where:'ISA provider annual statement.',                                required:false },

  // Savings & Investments Income
  { key: 'interest_certs',      label: 'Bank/Building Society Interest Certificates', cadence:{yearlyBy:'06-30'},  why:'Declare savings interest beyond PSA.',            where:'Bank portals (tax certificates) or statements.',                required:true },
  { key: 'dividend_vouchers',   label: 'Dividend Vouchers',                           cadence:{months:12},         why:'Evidence of dividend income & withholding.',     where:'Broker portal or registrar.',                                   required:true },
  { key: 'broker_tax_pack',     label: 'Broker Annual Tax Pack / CTC',                cadence:{yearlyBy:'06-30'},  why:'Summarises dividends, interest & disposals.',    where:'Broker portal (HL, AJ Bell, IBKR, etc.).',                      required:true },

  // Capital Gains (Shares/Funds/Crypto)
  { key: 'trade_confirmations', label: 'Trade Confirmations / Contract Notes',        cadence:{months:1},          why:'Evidence of acquisitions/disposals & fees.',     where:'Broker portal (PDF/CSV).',                                      required:true },
  { key: 'corp_actions',        label: 'Corporate Actions Evidence',                  cadence:{adhoc:true},        why:'Affects base cost (splits, rights, DRIP/scrip).', where:'Broker notices/registrar.',                                     required:false },
  { key: 'crypto_history',      label: 'Crypto Full Trade History (CSV/API)',         cadence:{months:1},          why:'HMRC requires records; pooling; staking/airdrops.', where:'Exchange CSV/API; wallet explorers; tax tools.',               required:true },

  // Property (Rental)
  { key: 'tenancy_agreements',  label: 'Tenancy Agreements (AST)',                    cadence:{adhoc:true},        why:'Evidence of rental terms & periods let.',        where:'Lettings agent or signed AST.',                                 required:false },
  { key: 'agent_statements',    label: 'Letting Agent Monthly Statements',            cadence:{months:1},          why:'Income/fees records for SA property pages.',     where:'Agent portal/email statements.',                                 required:true },
  { key: 'mortgage_interest',   label: 'Annual Mortgage Interest Certificate',        cadence:{yearlyBy:'05-31'},  why:'Loan interest deduction evidence (rental).',     where:'Lender annual certificate.',                                     required:true },
  { key: 'repairs_capital',     label: 'Repairs vs Capital Improvements Receipts',    cadence:{months:1},          why:'Split revenue vs capital for SA & future CGT.',  where:'Contractor invoices/receipts.',                                   required:true },

  // Property (Purchase/Sale/SDLT)
  { key: 'purchase_completion', label: 'Purchase Completion Statement',               cadence:{adhoc:true},        why:'Establishes base cost; incl. legal fees & SDLT.', where:'Conveyancer/solicitor pack.',                                   required:true },
  { key: 'sale_completion',     label: 'Sale Completion Statement',                   cadence:{adhoc:true},        why:'Proceeds & fees for CGT calculation.',           where:'Conveyancer/solicitor pack.',                                    required:true },
  { key: 'sdlt_return',         label: 'SDLT Return & Calculation',                   cadence:{adhoc:true},        why:'Confirms SDLT paid and rates used.',              where:'Conveyancer or HMRC SDLT copy.',                                 required:true },

  // Equity Compensation
  { key: 'equity_grants',       label: 'RSU/ESPP/Option Grant Agreements & Schedules', cadence:{adhoc:true},       why:'Defines vest/exercise terms; tax at vest.',       where:'Plan admin (Computershare/Equiniti/Fidelity).',                 required:true },
  { key: 'equity_events',       label: 'Vest/Exercise/Sell Confirmations',            cadence:{months:1},          why:'Taxed amounts at vest/exercise; basis updates.', where:'Plan/Broker statements.',                                        required:true },

  // Donations, Gifts & IHT
  { key: 'gift_aid',            label: 'Gift Aid Donation Schedule & Receipts',       cadence:{months:12},         why:'Gross-up claims in SA; higher rate relief.',      where:'Charity statements; CAF reports.',                               required:true },
  { key: 'gifts_log',           label: 'Gifts Log (7-year IHT tracking)',             cadence:{months:12},         why:'Track annual exemptions & PETs for IHT.',         where:'Self-maintained log with evidence.',                             required:false },

  // Education & Loans / Household
  { key: 'student_loans',       label: 'Student/Postgrad Loan Statements',            cadence:{yearlyBy:'04-30'},  why:'Plan type and balance; check PAYE/SA deductions.', where:'SLC online account.',                                           required:false },
  { key: 'child_benefit',       label: 'Child Benefit Award & Payments',              cadence:{months:12},         why:'Assess HICBC if income exceeds thresholds.',      where:'GOV.UK child benefit service.',                                  required:false },
  { key: 'marriage_allowance',  label: 'Marriage Allowance Transfer Confirmation',    cadence:{yearlyBy:'01-31'},  why:'Impacts personal allowance transfer between spouses.', where:'GOV.UK marriage allowance service.',                         required:false }
];

// --------------------------- Render table & progress ----------------------
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
        <div class="btn-group" role="group" aria-label="Actions">
          <!-- Upload -->
          <button
            class="btn btn-sm btn-primary btn-icon"
            data-action="upload"
            data-type="${d.key}"
            data-bs-toggle="tooltip"
            data-bs-title="Upload ${escapeHtml(d.label)}"
            aria-label="Upload ${escapeHtml(d.label)}">
            <i class="bi bi-upload"></i>
            <span class="visually-hidden">Upload</span>
          </button>

          <!-- View files -->
          <button
            class="btn btn-sm btn-outline-secondary btn-icon"
            data-action="view"
            data-type="${d.key}"
            data-bs-toggle="tooltip"
            data-bs-title="View files (${countFiles(d.key)})"
            aria-label="View files for ${escapeHtml(d.label)}">
            <i class="bi bi-eye"></i>
            <span class="visually-hidden">View files</span>
          </button>

          <!-- Delete latest -->
          <button
            class="btn btn-sm btn-outline-danger btn-icon"
            data-action="delete-latest"
            data-type="${d.key}"
            ${latest ? '' : 'disabled'}
            data-bs-toggle="tooltip"
            data-bs-title="${latest ? 'Delete latest upload' : 'Nothing to delete'}"
            aria-label="Delete latest for ${escapeHtml(d.label)}">
            <i class="bi bi-trash3"></i>
            <span class="visually-hidden">Delete latest</span>
          </button>
        </div>
      </td>
    `;

    // actions
    const uploadBtn = tr.querySelector('[data-action="upload"]');
    const viewBtn   = tr.querySelector('[data-action="view"]');
    const delLatest = tr.querySelector('[data-action="delete-latest"]');

    uploadBtn.addEventListener('click', (e) => triggerUpload(d.key, e.currentTarget));
    viewBtn.addEventListener('click', () => openFilesModal(d.key, d.label));
    if (delLatest) delLatest.addEventListener('click', async () => {
      if (!latest) return;
      if (!confirm('Delete the latest uploaded file for this document?')) return;
      await deleteFile(latest.id);
    });

    // enable tooltips for the three buttons
    [uploadBtn, viewBtn, delLatest].forEach(el => {
      if (el) new bootstrap.Tooltip(el, { container: 'body', placement: 'top' });
    });

    tbody.appendChild(tr);
  }

  setMsg('');
}

// ------------------------------ Progress math ----------------------------
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

// ------------------------------ Modal (files) ----------------------------
function openFilesModal(typeKey, label) {
  const list = ALL_FILES
    .filter(f => (f.type || 'other') === typeKey)
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
          <button class="btn btn-sm btn-outline-danger btn-icon"
                  data-id="${f.id}"
                  data-bs-toggle="tooltip"
                  data-bs-title="Delete file"
                  aria-label="Delete ${escapeHtml(f.filename || 'file')}">
            <i class="bi bi-trash3"></i>
            <span class="visually-hidden">Delete</span>
          </button>
        </td>
      `;
      const delBtn = tr.querySelector('button');
      new bootstrap.Tooltip(delBtn, { container: 'body', placement: 'top' });
      delBtn.addEventListener('click', async () => {
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

// ------------------------------ Upload flow ------------------------------
function triggerUpload(typeKey, btnEl) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.jpeg,.png,.csv,.heic,.webp';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    // Nearest table wrapper for thin top progress bar
    const tableWrap = btnEl?.closest('.table-responsive');

    const setWrapProgress = (pFloat) => {
      if (!tableWrap) return;
      tableWrap.classList.add('table-uploading');
      const pct = Math.max(2, Math.round(pFloat * 100));
      tableWrap.style.setProperty('--upload-w', pct + '%');
    };
    const clearWrapProgress = () => {
      if (!tableWrap) return;
      tableWrap.style.setProperty('--upload-w', '100%');
      setTimeout(() => {
        tableWrap.classList.remove('table-uploading');
        tableWrap.style.removeProperty('--upload-w');
      }, 350);
    };

    // Button loading overlay
    if (btnEl) btnEl.classList.add('is-loading');

    // Build upload URL consistent with server
    const year = currentTaxYearStart(new Date());
    const url = window.API?.url(`/api/docs?type=${encodeURIComponent(typeKey)}&year=${year}`)
              || `/api/docs?type=${encodeURIComponent(typeKey)}&year=${year}`;

    try {
      await uploadWithProgressToUrl(url, file, (p) => setWrapProgress(p));
      await renderDocsTable(); // refresh lists/badges/counts
    } catch (err) {
      alert(err.message || 'Upload failed');
    } finally {
      clearWrapProgress();
      if (btnEl) btnEl.classList.remove('is-loading');
      input.value = ''; // reset ephemeral input
    }
  };

  input.click();
}

// XHR helper: POST to a specific URL with real upload progress
function uploadWithProgressToUrl(url, file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true; // if you use cookie sessions
    xhr.setRequestHeader('Authorization', `Bearer ${Auth.getToken()}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr < 400) {
        resolve(JSON.parse(xhr.responseText || '{}'));
      } else if (xhr.status >= 200 && xhr.status < 300) { // safety (correct check)
        resolve(JSON.parse(xhr.responseText || '{}'));
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(fd);
  });
}

// ------------------------------ Utilities --------------------------------
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
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&gt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setMsg(t){ const el=document.getElementById('docs-msg'); if(el) el.textContent=t||''; }
function currentTaxYearStart(d){ const y=d.getFullYear(); const starts=new Date(y,3,6); return d>=starts?y:y-1; }
function countFiles(typeKey){ return ALL_FILES.filter(f => (f.type||'other')===typeKey).length; }
