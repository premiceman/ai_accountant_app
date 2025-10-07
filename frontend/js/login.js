// frontend/js/login.js
(function(){
  const form = document.getElementById('login-form');
  const idInput = document.getElementById('identifier');
  const pwInput = document.getElementById('password');
  const remember = document.getElementById('remember');
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  const googleBtn = document.getElementById('googleBtn');
  const microsoftBtn = document.getElementById('microsoftBtn');
  const appleBtn = document.getElementById('appleBtn');
  const passkeyBtn = document.getElementById('passkeyBtn');
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || './home.html';
  const initialError = params.get('error');

  const setLoading = (v)=>{ if(!btn) return; btn.disabled=v; btn.dataset.originalText = btn.dataset.originalText||btn.textContent; btn.textContent = v?'Signing in…':btn.dataset.originalText; };
  const showError = (m)=>{ if(!err){ alert(m); return; } err.textContent=m; err.classList.remove('d-none'); };
  const clearError = ()=>{ if(err){ err.textContent=''; err.classList.add('d-none'); } };

  if (initialError) {
    showError(initialError);
  }

  async function startProvider(provider, button, options = {}) {
    if (!button) return;
    clearError();
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span>Redirecting…</span>';
    try {
      const url = new URL('/api/auth/workos/authorize', location.origin);
      if (provider) url.searchParams.set('provider', provider);
      url.searchParams.set('next', next);
      const rememberValue = typeof options.rememberOverride === 'boolean'
        ? options.rememberOverride
        : !!remember?.checked;
      if (rememberValue) url.searchParams.set('remember', 'true');
      if (options.intent) url.searchParams.set('intent', options.intent);
      const emailValue = typeof options.email === 'string' ? options.email.trim() : '';
      if (emailValue) url.searchParams.set('email', emailValue);
      if (options.connectionId) url.searchParams.set('connection', options.connectionId);
      const res = await fetch(url.toString(), { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authorizationUrl) {
        const msg = data?.error || 'Unable to start single sign-on. Please try again.';
        showError(msg);
        return;
      }
      location.href = data.authorizationUrl;
    } catch (err) {
      console.error('Provider start failed:', err);
      showError('Network error. Please try again.');
    } finally {
      button.disabled = false;
      if (original !== undefined) button.innerHTML = original;
    }
  }

  googleBtn?.addEventListener('click', () => startProvider('google', googleBtn));
  microsoftBtn?.addEventListener('click', () => startProvider('microsoft', microsoftBtn));
  appleBtn?.addEventListener('click', () => startProvider('apple', appleBtn));
  passkeyBtn?.addEventListener('click', () => {
    const emailValue = (idInput?.value || '').trim();
    startProvider(null, passkeyBtn, {
      intent: 'login',
      rememberOverride: remember?.checked === true,
      email: emailValue,
    });
  });

  form?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const identifier = (idInput?.value||'').trim();
    const password = pwInput?.value || '';
    if(!identifier || !password) return showError('Please enter your email and password.');
    if(!/^\S+@\S+\.\S+$/.test(identifier)) return showError('Please enter a valid email address.');
    const body = { identifier, password };
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
