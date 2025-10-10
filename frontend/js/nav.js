// frontend/js/nav.js
(async function injectNav() {
  try {
    const top = await fetch('/components/topbar.html', { cache: 'no-store' });
    if (top.ok) {
      document.getElementById('topbar-container')?.insertAdjacentHTML('beforeend', await top.text());
      try {
        const brandLabel = document.querySelector('#topbar-container .topbar-logo span:last-child')?.textContent?.trim() || null;
        console.info?.('[instrumentation] nav:topbar:injected', { brandLabel, timestamp: new Date().toISOString() });
      } catch { /* no-op */ }
      wireCountryToggle();
      hydrateTopbarMeta();
    }
    const side = await fetch('/components/sidebar.html', { cache: 'no-store' });
    if (side.ok) {
      const host = document.getElementById('sidebar-container');
      const html = await side.text();
      host?.insertAdjacentHTML('beforeend', html);
      try {
        const navItemCount = document.querySelectorAll('#sidebar-container .app-nav-item').length;
        console.info?.('[instrumentation] nav:sidebar:injected', { navItemCount, timestamp: new Date().toISOString() });
      } catch { /* no-op */ }
      await applySidebarFeatureFlags(host);
    }
  } catch (e) { console.warn('nav inject failed', e); }
})();

async function applySidebarFeatureFlags(host) {
  if (!host || !window.Auth || typeof Auth.fetch !== 'function') return;
  try {
    const res = await Auth.fetch('/api/flags', { cache: 'no-store' });
    if (!res.ok) return;
    const flags = await res.json();
    if (flags.JSON_TEST_ENABLED) {
      host.querySelectorAll('[data-nav-feature="json-test"]').forEach((link) => {
        link.classList.remove('d-none');
      });
    }
  } catch (err) {
    console.warn('Failed to apply sidebar feature flags', err);
  }
}

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
    console.info?.('[instrumentation] nav:signout:click', { from: location.pathname, timestamp: new Date().toISOString() });
  } catch { /* no-op */ }
  try {
    if (window.Auth && typeof Auth.signOut === 'function') {
      Auth.signOut({ reason: 'sidebar-nav' });
    } else {
      // Hard fallback: clear tokens + go to login
      ['token','jwt','authToken','me'].forEach(k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} });
      location.href = '/index.html';
    }
  } catch {
    location.href = '/index.html';
  }
});


  