(function(){
    const API = '/api';
    const $ = (id) => document.getElementById(id);
    const fmt = (n) => typeof n === 'number' ? n.toLocaleString('en-GB', { style:'currency', currency:'GBP' }) : '—';
    const token = () => localStorage.getItem('token') || localStorage.getItem('jwt') || localStorage.getItem('authToken') || sessionStorage.getItem('token');
    const toLogin = () => location.href = './login.html?next=' + encodeURIComponent('./income.html');
  
    const region = $('region'), taxCode = $('taxCode'), salary = $('salary'), pensionPct = $('pensionPct'), slPlan = $('slPlan');
    const saveBtn = $('saveProfile'), whatIfBtn = $('whatIf'), alertEl = $('pf-alert');
    const wiNet = $('wi-net'), wiTax = $('wi-tax'), wiNi = $('wi-ni'), wiSl = $('wi-sl'), wiEmtr = $('wi-emtr');
  
    function drawEMTR(svg, points) {
      if (!points || points.length < 2) { svg.innerHTML = ''; return; }
      const w = svg.clientWidth || 400, h = svg.clientHeight || 60, pad = 4;
      const ys = points.map(p => p.emtr);
      const min = 0, max = 1;
      const dx = (w - pad*2) / (points.length - 1);
      const ny = (v) => h - pad - ((v - min) / (max - min)) * (h - pad*2);
      const path = points.map((p,i) => `${i===0?'M':'L'} ${pad + dx*i} ${ny(p.emtr)}`).join(' ');
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.innerHTML = `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2"/>`;
    }
  
    async function authedFetch(url, options = {}) {
      const t = token(); if (!t) return toLogin();
      const res = await fetch(url, { ...options, headers: { ...(options.headers||{}), Authorization: `Bearer ${t}` } });
      if (res.status === 401) return toLogin();
      return res;
    }
  
    async function loadProfile() {
      const res = await authedFetch(`${API}/income/profile`);
      if (!res.ok) { alertEl.textContent = 'Failed to load profile'; return; }
      const p = await res.json();
      region.value = p.region || 'EnglandWales';
      taxCode.value = p.taxCode || '';
      salary.value = p.salary || 0;
      pensionPct.value = p.pensionPct || 0;
      slPlan.value = p.studentLoanPlan || '';
    }
  
    async function saveProfile() {
      alertEl.textContent = 'Saving...';
      const body = JSON.stringify({
        region: region.value,
        taxCode: taxCode.value,
        salary: Number(salary.value || 0),
        pensionPct: Number(pensionPct.value || 0),
        studentLoanPlan: slPlan.value || null
      });
      const res = await authedFetch(`${API}/income/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      alertEl.textContent = res.ok ? 'Saved.' : 'Save failed.';
    }
  
    async function runWhatIf() {
      const body = JSON.stringify({
        salary: Number(salary.value || 0),
        pensionPct: Number(pensionPct.value || 0),
        studentLoanPlan: slPlan.value || null
      });
      const res = await authedFetch(`${API}/income/what-if`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) { alert('What-if failed'); return; }
      const data = await res.json();
      wiNet.textContent = fmt(data.result.net);
      wiTax.textContent = fmt(data.result.tax);
      wiNi.textContent = fmt(data.result.ni);
      wiSl.textContent = fmt(data.result.sl);
      drawEMTR(wiEmtr, data.result.emtrPoints);
    }
  
    saveBtn.addEventListener('click', saveProfile);
    whatIfBtn.addEventListener('click', runWhatIf);
  
    loadProfile();
  })();
  