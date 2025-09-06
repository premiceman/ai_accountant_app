// frontend/js/nav.js
(async function injectNav() {
  try {
    const top = await fetch('/components/topbar.html', { cache: 'no-store' });
    if (top.ok) document.getElementById('topbar-container')?.insertAdjacentHTML('beforeend', await top.text());
    const side = await fetch('/components/sidebar.html', { cache: 'no-store' });
    if (side.ok) document.getElementById('sidebar-container')?.insertAdjacentHTML('beforeend', await side.text());
  } catch (e) { console.warn('nav inject failed', e); }
})();

// Global sign-out handler (works for dynamically inserted navs)
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('#nav-signout');
  if (!btn) return;
  ev.preventDefault();
  try {
    if (window.Auth && typeof Auth.signOut === 'function') {
      Auth.signOut();
    } else {
      // Hard fallback: clear tokens + go to login
      ['token','jwt','authToken','me'].forEach(k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} });
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `./login.html?next=${next}`;
    }
  } catch {
    location.href = './login.html';
  }
});


  