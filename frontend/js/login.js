// frontend/js/login.js
(function(){
  const form = document.getElementById('login-form');
  const idInput = document.getElementById('identifier');
  const pwInput = document.getElementById('password');
  const remember = document.getElementById('remember');
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  const next = new URLSearchParams(location.search).get('next') || './home.html';
  const setLoading = (v)=>{ if(!btn) return; btn.disabled=v; btn.dataset.originalText = btn.dataset.originalText||btn.textContent; btn.textContent = v?'Signing in…':btn.dataset.originalText; };
  const showError = (m)=>{ if(!err){ alert(m); return; } err.textContent=m; err.classList.remove('d-none'); };
  const clearError = ()=>{ if(err){ err.textContent=''; err.classList.add('d-none'); } };
  form?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const identifier = (idInput?.value||'').trim();
    const password = pwInput?.value || '';
    if(!identifier || !password) return showError('Please enter your email/username and password.');
    const body = identifier.includes('@') ? { email:identifier, password } : { username:identifier, password };
    setLoading(true); clearError();
    try {
      const res = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (res.status === 400) { let msg='Invalid credentials. Please check your details.'; try{ const j=await res.json(); if(j?.error) msg=j.error; }catch{} return showError(msg); }
      if (res.status === 401) return showError('Unauthorized. Please sign in again.');
      if (res.status === 429) return showError('Too many attempts. Try again later.');
      if (res.status >= 500) return showError('Server error. Please try again shortly.');
      if (!res.ok) return showError(`Login failed (status ${res.status}).`);
      const data = await res.json();
      const token = data.token; if(!token) return showError('No token returned from server.');
      const store = (remember && remember.checked) ? localStorage : sessionStorage;
      store.setItem('token', token);
      if (data.user) try { store.setItem('me', JSON.stringify(data.user)); } catch {}
      location.href = next;
    } catch (e) {
      console.error(e); showError('Network error. Is the server running?');
    } finally { setLoading(false); }
  });
})();
