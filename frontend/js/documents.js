// frontend/js/documents.js
(async function init() {
    try {
      const { me } = await Auth.requireAuth();
      Auth.setBannerTitle('Documents');
      await renderDocsTable();  // always renders rows, even if API unavailable
    } catch (e) {
      console.error(e);
      setMsg('Failed to load documents.');
    }
  })();
  
  // ---- Static catalogue of docs (required + helpful) ----
  const DOCS = [
    {
      key: 'proof_of_id',
      label: 'Proof of ID',
      cadence: { months: 60 },
      why: 'Verify identity for KYC/AML and secure account changes.',
      where: 'Passport or Driving Licence (DVLA).',
      required: true
    },
    {
      key: 'address_proof',
      label: 'Proof of Address',
      cadence: { months: 6 },
      why: 'Confirm residency for tax rules and correspondence.',
      where: 'Utility bill, bank statement, council tax bill (≤3 months old).',
      required: true
    },
    {
      key: 'bank_statements',
      label: 'Bank Statements (last 3 months)',
      cadence: { months: 1 },
      why: 'Reconcile income/expenses; evidence for SA computations and allowances.',
      where: 'Download PDF statements from your online banking.',
      required: true
    },
    {
      key: 'p60',
      label: 'P60 (latest)',
      cadence: { yearlyBy: '06-01' },
      why: 'Year-end summary of pay and tax for Self Assessment and verification.',
      where: 'Employer/Payroll portal; issued after 5 April each year.',
      required: true
    },
    {
      key: 'p45',
      label: 'P45 (if changed jobs)',
      cadence: { adhoc: true },
      why: 'Shows tax paid to date when you leave an employer.',
      where: 'Issued by your previous employer.',
      required: false
    },
    {
      key: 'invoices',
      label: 'Invoices (self-employed)',
      cadence: { months: 1 },
      why: 'Evidence of income for SA; helps calculate allowable expenses and profit.',
      where: 'Your bookkeeping tool or invoice PDFs.',
      required: false
    },
    {
      key: 'receipts',
      label: 'Expense Receipts',
      cadence: { months: 1 },
      why: 'Evidence of allowable expenses; supports tax relief claims.',
      where: 'Photos/PDFs of receipts; accounting app exports.',
      required: false
    },
    {
      key: 'vat_returns',
      label: 'VAT Returns',
      cadence: { months: 3 },
      why: 'Evidence of VAT submissions and payments (if VAT registered).',
      where: 'HMRC VAT portal or your VAT software export.',
      required: false
    }
  ];
  
  // ---- Render logic ----
  async function renderDocsTable() {
    setMsg('Loading…');
  
    // 1) Build base rows from static DOCS (so table is never empty)
    const tbody = document.getElementById('docs-table-body');
    tbody.innerHTML = '';
    const rowByKey = new Map();
  
    for (const d of DOCS) {
      const tr = document.createElement('tr');
      tr.dataset.key = d.key;
      tr.innerHTML = rowTemplate({
        label: d.label,
        required: d.required,
        statusHtml: badge('missing'),
        last: '—',
        due: dueLabel(d.cadence, null),
        why: d.why,
        where: d.where,
        actionsHtml: actionsTemplate({ key: d.key, canDelete: false })
      });
      tbody.appendChild(tr);
      rowByKey.set(d.key, tr);
    }
  
    // 2) Try to load uploaded files and expected map from API (best-effort)
    let files = [];
    try {
      const r = await Auth.fetch('/api/docs');
      if (r.ok) {
        const j = await r.json();
        files = Array.isArray(j.files) ? j.files : [];
      }
    } catch {}
  
    // Latest upload per type
    const latestByType = {};
    for (const f of files) {
      const t = f.type || 'other';
      if (!latestByType[t] || new Date(f.uploadDate) > new Date(latestByType[t].uploadDate)) {
        latestByType[t] = f;
      }
    }
  
    // 3) Overlay server data into rows
    for (const d of DOCS) {
      const tr = rowByKey.get(d.key);
      if (!tr) continue;
  
      const latest = latestByType[d.key] || null;
      const lastUploaded = latest?.uploadDate ? new Date(latest.uploadDate) : null;
      const overdue = isOverdue(d.cadence, lastUploaded);
  
      tr.innerHTML = rowTemplate({
        label: d.label,
        required: d.required,
        statusHtml: latest ? badge(overdue ? 'overdue' : 'ok') : badge('missing'),
        last: lastUploaded ? fmtDateTime(lastUploaded) : '—',
        due: dueLabel(d.cadence, lastUploaded),
        why: d.why,
        where: d.where,
        actionsHtml: actionsTemplate({ key: d.key, canDelete: !!latest, latestId: latest?.id })
      });
  
      // Wire actions after replacing innerHTML
      wireRowActions(tr, d.key, latest?.id || null);
    }
  
    setMsg('');
  }
  
  // ---- Templates & helpers ----
  function rowTemplate({ label, required, statusHtml, last, due, why, where, actionsHtml }) {
    return `
      <td class="fw-semibold">
        ${label}
        ${required ? '<span class="badge text-bg-danger ms-2">Required</span>' : '<span class="badge text-bg-secondary ms-2">Helpful</span>'}
      </td>
      <td>${statusHtml}</td>
      <td>${last}</td>
      <td>${due}</td>
      <td class="small text-muted">${escapeHtml(why)}</td>
      <td class="small text-muted">${escapeHtml(where)}</td>
      <td class="text-end">${actionsHtml}</td>
    `;
  }
  
  function actionsTemplate({ key, canDelete, latestId }) {
    const delDisabled = canDelete ? '' : 'disabled';
    const delData = canDelete ? `data-id="${latestId}"` : '';
    return `
      <div class="btn-group">
        <button class="btn btn-sm btn-primary" data-action="upload" data-type="${key}">Upload</button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-type="${key}" ${delData} ${delDisabled}>Delete</button>
      </div>
    `;
  }
  
  function badge(kind) {
    if (kind === 'ok') return '<span class="badge text-bg-success">Up to date</span>';
    if (kind === 'overdue') return '<span class="badge text-bg-warning">Overdue</span>';
    return '<span class="badge text-bg-secondary">Missing</span>';
  }
  
  function fmtDateTime(d) {
    try { return d.toLocaleString(); } catch { return '—'; }
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
    if (!last) return true; // default annual
    const next = new Date(last); next.setMonth(next.getMonth() + 12);
    return now > next;
  }
  
  function dueLabel(cadence, last) {
    if (cadence?.adhoc) return 'As needed';
    const now = new Date();
    if (cadence?.yearlyBy) {
      const [mm, dd] = cadence.yearlyBy.split('-').map(Number);
      const due = new Date(now.getFullYear(), mm - 1, dd);
      const overdue = now > due && (!last || last < due);
      return overdue ? `Overdue (was due ${due.toLocaleDateString()})` : `Due by ${due.toLocaleDateString()}`;
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
  
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  
  function setMsg(t) {
    const el = document.getElementById('docs-msg');
    if (el) el.textContent = t || '';
  }
  
  // Wire upload/delete for a row
  function wireRowActions(tr, typeKey, latestId) {
    const uploadBtn = tr.querySelector('[data-action="upload"]');
    const deleteBtn = tr.querySelector('[data-action="delete"]');
  
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => triggerUpload(typeKey));
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!latestId) return;
        if (!confirm('Delete the latest uploaded file for this document?')) return;
        try {
          const res = await Auth.fetch(`/api/docs/${latestId}`, { method: 'DELETE' });
          if (!res.ok) {
            const t = await res.text().catch(()=> '');
            alert('Delete failed: ' + t);
          } else {
            await renderDocsTable();
          }
        } catch (e) {
          alert('Delete failed.');
        }
      });
    }
  }
  
  // Upload flow (FormData → /api/docs?type=...&year=...)
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
        /*if (!r.ok) {
          const t = await r.text().catch(()=> '');
          alert('Upload failed: ' + t);
          return;
        }*/
        if (!r.ok) {
            let msg = 'Upload failed.';
            try {
                const j = await r.json();
                if (j?.error) msg = j.error;
            } catch {
                const t = await r.text().catch(()=> '');
                if (t) msg = t;
            }
            alert(msg);
            return;
        }
        await renderDocsTable();
      } catch (e) {
        alert('Upload failed (network).');
      }
    };
    input.click();
  }
  
  function currentTaxYearStart(d) {
    // UK tax year starts 6 April; return starting year (e.g., 2025 for 2025/26)
    const y = d.getFullYear();
    const starts = new Date(y, 3, 6);
    return d >= starts ? y : y - 1;
  }
  