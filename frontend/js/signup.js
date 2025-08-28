// frontend/js/signup.js
(function(){
  const form = document.getElementById('signup-form');
  const btn  = document.getElementById('signup-btn');
  const err  = document.getElementById('signup-error');
  const val  = id => (document.getElementById(id)?.value || '').trim();
  const next = './home.html';
  const setLoading = v => { if(!btn) return; btn.disabled=v; btn.dataset.originalText = btn.dataset.originalText||btn.textContent; btn.textContent = v?'Creating…':btn.dataset.originalText; };
  const showError = m => { if(!err) { alert(m); return; } err.textContent=m; err.classList.remove('d-none'); };
  const clearError = () => { if (err) { err.textContent=''; err.classList.add('d-none'); } };
  form?.addEventListener('submit', async (e)=>{
    e.preventDefault(); clearError();
    const payload = { firstName: val('firstName'), lastName: val('lastName'), username: val('username')||undefined, email: val('email'), password: val('password') };
    if (!payload.firstName || !payload.lastName || !payload.email || !payload.password) return showError('Please fill all required fields.');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (res.status === 409) { let msg='Email/username already in use.'; try { const j=await res.json(); if (j?.error) msg=j.error; } catch {} return showError(msg); }
      if (res.status >= 400 && res.status < 500) { let msg='Invalid details. Please review.'; try { const j=await res.json(); if (j?.error) msg=j.error; } catch {} return showError(msg); }
      if (res.status >= 500) return showError('Server error. Please try again shortly.');
      const data = await res.json(); const token = data.token; if(!token) return showError('No token returned from server.');
      localStorage.setItem('token', token); if (data.user) try { localStorage.setItem('me', JSON.stringify(data.user)); } catch {}
      location.href = next;
    } catch (e) { console.error(e); showError('Network error. Is the server running?'); } finally { setLoading(false); }
  });
})();
