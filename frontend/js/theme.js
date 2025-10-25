(function () {
  const STORAGE_KEY = 'phloat-theme';
  const doc = document.documentElement;
  const win = window;

  function safeGet() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function safeSet(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {
      /* no-op */
    }
  }

  function safeRemove() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      /* no-op */
    }
  }

  function normalize(theme) {
    return theme === 'dark' ? 'dark' : 'light';
  }

  function shouldInjectStandaloneToggle() {
    if (document.querySelector('[data-theme-toggle]')) return false;
    if (document.getElementById('topbar-container')) return false;
    if (document.querySelector('.landing-nav')) return false;
    return true;
  }

  function createToggleElement({ compact = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = compact ? 'theme-toggle theme-toggle--compact' : 'theme-toggle';
    button.setAttribute('data-theme-toggle', '');
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = [
      '<span class="visually-hidden">Toggle colour theme</span>',
      '<span class="theme-toggle__track" aria-hidden="true">',
      '  <i class="bi bi-brightness-high-fill theme-toggle__icon theme-toggle__icon--sun" aria-hidden="true"></i>',
      '  <i class="bi bi-moon-stars-fill theme-toggle__icon theme-toggle__icon--moon" aria-hidden="true"></i>',
      '  <span class="theme-toggle__thumb" aria-hidden="true"></span>',
      '</span>',
      '<span class="theme-toggle__label">',
      '  <span class="theme-toggle__label-text" data-theme-toggle-label>Light</span>',
      '</span>'
    ].join('');
    return button;
  }

  function applyTheme(theme, { persist = true, emit = true } = {}) {
    const next = normalize(theme);
    if (!doc) return;
    doc.setAttribute('data-theme', next);
    doc.classList.toggle('theme-dark', next === 'dark');
    if (doc.style) {
      doc.style.colorScheme = next === 'dark' ? 'dark' : 'light';
    }
    if (persist) {
      safeSet(next);
    }
    syncToggleState(next);
    if (emit && typeof win.CustomEvent === 'function') {
      win.dispatchEvent(new CustomEvent('phloat-theme-change', { detail: { theme: next } }));
    }
  }

  function syncToggleState(theme) {
    const toggles = document.querySelectorAll('[data-theme-toggle]');
    toggles.forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const nextTheme = normalize(theme);
      btn.setAttribute('aria-pressed', nextTheme === 'dark' ? 'true' : 'false');
      btn.dataset.themeState = nextTheme;
      const label = btn.querySelector('[data-theme-toggle-label]');
      if (label) label.textContent = nextTheme === 'dark' ? 'Dark' : 'Light';
    });
  }

  function toggleTheme() {
    const current = (doc && doc.getAttribute('data-theme')) === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target instanceof Element ? event.target.closest('[data-theme-toggle]') : null;
    if (!trigger) return;
    event.preventDefault();
    toggleTheme();
  });

  const storedTheme = safeGet();
  if (storedTheme) {
    applyTheme(storedTheme, { persist: false, emit: false });
  } else {
    const existing = (doc && doc.getAttribute('data-theme')) || '';
    if (existing) {
      applyTheme(existing, { persist: false, emit: false });
    } else if (typeof win.matchMedia === 'function') {
      applyTheme(win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', { persist: false, emit: false });
    } else {
      applyTheme('light', { persist: false, emit: false });
    }
  }

  if (typeof win.matchMedia === 'function') {
    const mq = win.matchMedia('(prefers-color-scheme: dark)');
    const handler = (ev) => {
      if (safeGet()) return;
      applyTheme(ev.matches ? 'dark' : 'light', { persist: false });
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(handler);
    }
  }

  win.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    const next = event.newValue ? normalize(event.newValue) : null;
    if (!next) {
      safeRemove();
      applyTheme('light', { persist: false });
      return;
    }
    applyTheme(next, { persist: false });
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (shouldInjectStandaloneToggle() && document.body) {
      const host = document.createElement('div');
      host.className = 'standalone-theme-toggle';
      host.appendChild(createToggleElement({ compact: true }));
      document.body.appendChild(host);
    }
    syncToggleState((doc && doc.getAttribute('data-theme')) || 'light');
  });

  win.PhloatTheme = win.PhloatTheme || {};
  win.PhloatTheme.setTheme = (theme, options = {}) => applyTheme(theme, options);
  win.PhloatTheme.refresh = () => syncToggleState((doc && doc.getAttribute('data-theme')) || 'light');
  win.PhloatTheme.clearPreference = () => safeRemove();

  if (typeof win.CustomEvent === 'function') {
    try {
      win.dispatchEvent(new CustomEvent('phloat-theme-ready', {
        detail: { theme: (doc && doc.getAttribute('data-theme')) || 'light' }
      }));
    } catch { /* no-op */ }
  }
})();
