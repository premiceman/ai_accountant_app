(function(){
    const API = '/api';
    const $ = (id) => document.getElementById(id);
    const token = () => localStorage.getItem('token') || localStorage.getItem('jwt') || localStorage.getItem('authToken') || sessionStorage.getItem('token');
    const toLogin = () => location.href = './login.html?next=' + encodeURIComponent('./documents.html');
  
    const form = $('upload-form'), file = $('file'), dtype = $('dtype'), year = $('year'), umsg = $('u-msg');
    const expected = $('expected'), filesBody = $('filesBody');
  
    async function authedFetch(url, options = {}) {
      const t = token(); if (!t) return toLogin();
      const res = await fetch(url, { ...options, headers: { ...(options.headers||{}), Authorization: `Bearer ${t}` } });
      if (res.status === 401) return toLogin();
      return res;
    }
  
    async function loadExpected() {
      const res = await authedFetch(`${API}/docs/expected`);
      if (!res.ok) return;
      const data = await res.json();
      expected.innerHTML = '';
      data.required.forEach(r => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        li.innerHTML = `<span>${r.label}</span><span class="badge rounded-pill ${r.status === 'uploaded' ? 'text-bg-success' : 'text-bg-secondary'}">${r.status}</span>`;
        expected.appendChild(li);
      });
    }
  
    async function loadFiles() {
      const res = await authedFetch(`${API}/docs`);
      if (!res.ok) return;
      const data = await res.json();
      filesBody.innerHTML = '';
      data.files.forEach(f => {
        const tr = document.createElement('tr');
        const sz = f.length != null ? (Math.round(f.length/1024) + ' KB') : '—';
        tr.innerHTML = `<td>${f.filename}</td><td>${f.type||'other'}</td><td>${f.year||''}</td><td>${new Date(f.uploadDate).toLocaleString()}</td><td>${sz}</td>`;
        filesBody.appendChild(tr);
      });
    }
  
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!file.files[0]) { umsg.textContent = 'Choose a file first'; return; }
      const fd = new FormData();
      fd.append('file', file.files[0]);
      const y = year.value ? Number(year.value) : '';
      const qs = new URLSearchParams({ type: dtype.value, ...(y ? { year: String(y) } : {}) });
      umsg.textContent = 'Uploading...';
      const res = await authedFetch(`${API}/docs?` + qs.toString(), { method: 'POST', body: fd });
      umsg.textContent = res.ok ? 'Uploaded.' : 'Upload failed.';
      file.value = ''; year.value = '';
      await loadExpected();
      await loadFiles();
    });
  
    (async function boot(){
      await loadExpected();
      await loadFiles();
    })();
  })();
  