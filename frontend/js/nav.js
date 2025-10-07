// frontend/js/nav.js
(async function injectNav() {
  try {
    const top = await fetch('/components/topbar.html', { cache: 'no-store' });
    if (top.ok) {
      document.getElementById('topbar-container')?.insertAdjacentHTML('beforeend', await top.text());
      wireCountryToggle();
      hydrateTopbarMeta();
    }
    const side = await fetch('/components/sidebar.html', { cache: 'no-store' });
    if (side.ok) document.getElementById('sidebar-container')?.insertAdjacentHTML('beforeend', await side.text());
  } catch (e) { console.warn('nav inject failed', e); }
})();

async function hydrateTopbarMeta() {
  try {
    if (!window.Auth || typeof Auth.getCurrentUser !== 'function') return;
    const me = await Auth.getCurrentUser();
    if (!me) return;
    const meta = document.getElementById('topbar-user-meta');
    if (meta) {
      const tier = (me.licenseTier || '').replace(/\b\w/g, (c) => c.toUpperCase());
      const verified = me.emailVerified ? '<span class="badge text-bg-success ms-2">Verified</span>' : '<span class="badge text-bg-warning text-dark ms-2">Verify email</span>';
      meta.innerHTML = `${tier || 'Free'} plan${verified}`;
    }
    const activeCountryBtn = document.querySelector(`#country-toggle [data-country="${me.country || 'uk'}"]`);
    setCountryActive(activeCountryBtn);
  } catch (err) {
    console.warn('hydrateTopbarMeta failed', err);
  }
}

function wireCountryToggle() {
  const group = document.getElementById('country-toggle');
  if (!group) return;

  group.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-country]');
    if (!btn || btn.classList.contains('disabled')) return;
    setCountryActive(btn);
    try {
      if (window.Auth && typeof Auth.fetch === 'function') {
        await Auth.fetch('/api/user/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            country: btn.dataset.country,
            firstName: Auth.me?.firstName || '',
            lastName: Auth.me?.lastName || '',
            email: Auth.me?.email || ''
          })
        });
        if (Auth.me) {
          Auth.me.country = btn.dataset.country;
        }
      }
    } catch (err) {
      console.warn('Failed to persist country preference', err);
    }
  });
}

function setCountryActive(btn) {
  if (!btn) return;
  const group = btn.closest('#country-toggle');
  if (!group) return;
  group.querySelectorAll('button[data-country]').forEach((el) => {
    el.classList.remove('active');
    el.classList.toggle('btn-outline-primary', false);
    el.classList.toggle('btn-outline-secondary', el.dataset.country === 'us');
  });
  btn.classList.add('active');
  btn.classList.toggle('btn-outline-primary', true);
}

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
      const nextPath = location.pathname + location.search;
      const url = (window.Auth && typeof Auth.buildWorkOSUrl === 'function')
        ? Auth.buildWorkOSUrl({ intent: 'login', next: nextPath })
        : `/api/auth/workos/login?next=${encodeURIComponent(nextPath)}`;
      location.href = url;
    }
  } catch {
    const url = (window.Auth && typeof Auth.buildWorkOSUrl === 'function')
      ? Auth.buildWorkOSUrl({ intent: 'login' })
      : '/api/auth/workos/login';
    location.href = url;
  }
});


  