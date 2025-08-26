//home.js

// frontend/js/home.js
(function () {
    const API_BASE = '/api';
    const curFmt = (n, c = 'GBP') => (typeof n === 'number' ? n.toLocaleString('en-GB', { style: 'currency', currency: c }) : '—');
  
    const $ = (id) => document.getElementById(id);
    const greetName = $('greeting-name');
    const asOfEl = $('as-of');
  
    const fields = {
      netWorth: $('nw-value'),
      netWorthDelta: $('nw-delta'),
      assets: $('assets-value'),
      liabilities: $('liabilities-value'),
      debt: $('debt-value'),
      savings: $('savings-value'),
      expenses: $('expenses-value'),
      income: $('income-value'),
      bankStatus: $('bank-status'),
      docsList: $('docs-list'),
      spark: $('nw-spark'),
    };
  
    const getToken = () =>
      localStorage.getItem('token') ||
      localStorage.getItem('jwt') ||
      localStorage.getItem('authToken') ||
      sessionStorage.getItem('token');
  
    function toLogin() {
      location.href = './login.html?next=' + encodeURIComponent('./home.html');
    }
  
    function setDelta(el, pct) {
      if (pct === null || pct === undefined || isNaN(pct)) { el.textContent = '—'; el.className='delta'; return; }
      const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
      el.textContent = `${sign}${Math.abs(pct).toFixed(1)}%`;
      el.className = `delta ${pct > 0 ? 'up' : pct < 0 ? 'down' : ''}`;
    }
  
    function drawSparkline(svg, points) {
      // points: [{t: '2025-01', v: number}, ...]
      if (!points || points.length < 2) { svg.innerHTML = ''; return; }
      const w = svg.clientWidth || 300, h = svg.clientHeight || 40, pad = 4;
      const xs = points.map(p => p.v);
      const min = Math.min(...xs), max = Math.max(...xs);
      const norm = (v) => {
        if (max === min) return h/2;
        return h - pad - ((v - min) / (max - min)) * (h - pad*2);
      };
      const dx = (w - pad*2) / (points.length - 1);
      const path = points.map((p,i) => `${i===0?'M':'L'} ${pad + dx*i} ${norm(p.v)}`).join(' ');
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.innerHTML = `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2"/>`;
    }
  
    async function fetchJSON(path, token) {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.status === 401) toLogin();
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      return res.json();
    }
  
    async function init() {
      const token = getToken();
      if (!token) return toLogin();
  
      try {
        // 1) User (for greeting)
        const me = await fetchJSON('/user/me', token);
        greetName.textContent = me.firstName ? me.firstName : 'there';
  
        // 2) Dashboard summary
        let summary;
        try {
          const resp = await fetchJSON('/dashboard/summary', token);
          summary = resp;
        } catch (e) {
          // Fallback (if API not mounted yet)
          summary = {
            summary: {
              currency: 'GBP',
              netWorth: 0,
              deltaMoMPercent: null,
              assets: 0, liabilities: 0, debts: 0, savings: 0,
              expensesLastMonth: 0, incomesLastMonth: 0,
              asOf: new Date().toISOString(),
            },
            series: { netWorth: [] },
            missingIntegrations: { truelayer: true }
          };
        }
  
        const s = summary.summary;
        fields.netWorth.textContent = curFmt(s.netWorth, s.currency);
        setDelta(fields.netWorthDelta, s.deltaMoMPercent);
        fields.assets.textContent = curFmt(s.assets, s.currency);
        fields.liabilities.textContent = curFmt(s.liabilities, s.currency);
        fields.debt.textContent = curFmt(s.debts, s.currency);
        fields.savings.textContent = curFmt(s.savings, s.currency);
        fields.expenses.textContent = curFmt(s.expensesLastMonth, s.currency);
        fields.income.textContent = curFmt(s.incomesLastMonth, s.currency);
        asOfEl.textContent = `As of ${new Date(s.asOf).toLocaleString()}`;
        drawSparkline(fields.spark, (summary.series?.netWorth || []).map(x => ({ t: x.month, v: x.value })));
        fields.bankStatus.textContent = summary.missingIntegrations?.truelayer ? 'Not connected' : 'Connected';
  
        // 3) Docs requirements
        let docsResp;
        try {
          docsResp = await fetchJSON('/docs/requirements', token);
        } catch {
          docsResp = {
            required: [
              { key: 'proof_of_id', label: 'Proof of ID (Passport/Driving License)', status: 'missing' },
              { key: 'address_proof', label: 'Proof of Address (Utility Bill)', status: 'missing' },
              { key: 'bank_statements', label: 'Bank Statements (last 3 months)', status: 'missing' },
              { key: 'p60', label: 'P60 (latest)', status: 'missing' },
              { key: 'p45', label: 'P45 (if changed jobs)', status: 'missing' },
              { key: 'invoices', label: 'Invoices (if self-employed)', status: 'missing' },
              { key: 'receipts', label: 'Expense Receipts', status: 'missing' },
              { key: 'vat_returns', label: 'VAT Returns (if applicable)', status: 'missing' },
            ]
          };
        }
  
        fields.docsList.innerHTML = '';
        docsResp.required.forEach((doc) => {
          const li = document.createElement('li');
          li.className = 'list-group-item d-flex justify-content-between align-items-center';
          li.innerHTML = `
            <span>${doc.label}</span>
            <span class="badge rounded-pill ${doc.status === 'uploaded' ? 'text-bg-success' : 'text-bg-secondary'} doc-badge">
              ${doc.status === 'uploaded' ? 'Uploaded' : 'Missing'}
            </span>
          `;
          fields.docsList.appendChild(li);
        });
  
      } catch (err) {
        console.error(err);
        alert('Failed to load dashboard. Please try again.');
      }
    }
  
    init();
  })();
  