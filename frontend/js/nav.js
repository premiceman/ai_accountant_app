// frontend/js/nav.js
let topbarResizeObserver;
let topbarReady = false;
let sidebarReady = false;

(async function injectNav() {
  const body = document.body;
  const topbarHost = document.getElementById('topbar-container');
  const sidebarHost = document.getElementById('sidebar-container');
  if (body && topbarHost) body.classList.add('has-topbar');
  if (body && sidebarHost) body.classList.add('has-sidebar');
  try {
    const top = await fetch('/components/topbar.html', { cache: 'no-store' });
    if (top.ok) {
      document.getElementById('topbar-container')?.insertAdjacentHTML('beforeend', await top.text());
      try {
        const brandLabel = document.querySelector('#topbar-container .topbar-logo span:last-child')?.textContent?.trim() || null;
        console.info?.('[instrumentation] nav:topbar:injected', { brandLabel, timestamp: new Date().toISOString() });
      } catch { /* no-op */ }
      const topbarEl = document.querySelector('#topbar-container .topbar-glass');
      if (topbarEl) {
        topbarReady = true;
        initialiseTopbarLayout(topbarEl);
      }
      hydrateTopbarMeta();
    }
    const side = await fetch('/components/sidebar.html', { cache: 'no-store' });
    if (side.ok) {
      const host = document.getElementById('sidebar-container');
      const html = await side.text();
      host?.insertAdjacentHTML('beforeend', html);
      if (host) {
        sidebarReady = true;
      }
      try {
        const navItemCount = document.querySelectorAll('#sidebar-container .app-nav-item').length;
        console.info?.('[instrumentation] nav:sidebar:injected', { navItemCount, timestamp: new Date().toISOString() });
      } catch { /* no-op */ }
      await applySidebarFeatureFlags(host);
    }
  } catch (e) { console.warn('nav inject failed', e); }
  finally {
    if (!topbarReady) body?.classList.remove('has-topbar');
    if (!sidebarReady) body?.classList.remove('has-sidebar');
  }
})();

function initialiseTopbarLayout(topbarEl) {
  if (!topbarEl) return;
  syncTopbarHeight(topbarEl);
  if (typeof ResizeObserver === 'function') {
    topbarResizeObserver?.disconnect?.();
    topbarResizeObserver = new ResizeObserver(() => syncTopbarHeight(topbarEl));
    topbarResizeObserver.observe(topbarEl);
  } else {
    window.addEventListener('resize', () => syncTopbarHeight(topbarEl), { passive: true });
  }
}

function syncTopbarHeight(topbarEl) {
  if (!topbarEl) return;
  const measure = () => {
    const rect = topbarEl.getBoundingClientRect();
    if (!rect || !rect.height) return;
    const height = Math.round(rect.height);
    if (height > 0) {
      document.documentElement.style.setProperty('--topbar-h', `${height}px`);
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(measure);
  } else {
    measure();
  }
}

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
      const planLabel = `${tier || 'Free'} plan`;
      const verifiedLabel = me.emailVerified ? 'Verified' : 'Verify email';
      const verifiedClass = me.emailVerified ? 'text-bg-success' : 'text-bg-warning text-dark';
      const nameParts = [me.firstName, me.lastName].filter(Boolean);
      const primaryName = nameParts.join(' ').trim() || me.companyName || (me.email || '').split('@')[0] || 'Your workspace';
      const initials = getInitials(primaryName || me.email || '');
      meta.innerHTML = `
        <div class="topbar-user-chip" role="presentation">
          <div class="topbar-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="topbar-user-details">
            <span class="topbar-user-name">${escapeHtml(primaryName)}</span>
            <span class="topbar-user-plan">${escapeHtml(planLabel)}<span class="badge rounded-pill topbar-user-badge ${verifiedClass}">${escapeHtml(verifiedLabel)}</span></span>
          </div>
        </div>
      `;
    }
  } catch (err) {
    console.warn('hydrateTopbarMeta failed', err);
  }
}

function getInitials(value) {
  const letters = (value || '').match(/\p{L}/gu) || [];
  if (!letters.length) return 'U';
  const initials = letters.slice(0, 2).join('');
  return initials.toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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


  