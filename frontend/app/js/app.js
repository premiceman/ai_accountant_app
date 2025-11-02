const App = (() => {
  async function request(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (res.status === 401) {
      window.location.href = '/';
      return null;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.message || 'Request failed');
    }
    return res.json();
  }

  const Api = {
    getMe: () => request('/api/v2/me'),
  };

  async function signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (error) {
      console.warn('Sign out request failed', error);
    }
    window.location.href = '/';
  }

  function bindSignOut() {
    const buttons = document.querySelectorAll('[data-action="signout"]');
    buttons.forEach((button) => {
      if (button.dataset.bound === 'true') return;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        signOut();
      });
      button.dataset.bound = 'true';
    });
  }

  function highlightNav(activeNavId) {
    const navItems = document.querySelectorAll('nav a');
    navItems.forEach((item) => {
      if (item.dataset.nav === activeNavId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  async function bootstrap(activeNavId) {
    highlightNav(activeNavId);
    bindSignOut();

    try {
      const me = await Api.getMe();
      if (!me) return null;
      const nameEl = document.querySelector('[data-user-name]');
      if (nameEl) {
        const first = me.profile?.firstName || '';
        const last = me.profile?.lastName || '';
        const name = [first, last].filter(Boolean).join(' ').trim();
        nameEl.textContent = name || 'Welcome back';
      }
      return me;
    } catch (error) {
      console.error('Failed to load user profile', error);
      const message = document.getElementById('dashboard-message');
      if (message) {
        message.textContent = 'We could not load your account details. Please refresh the page to try again.';
      }
      return null;
    }
  }

  return { Api, bootstrap, signOut };
})();

window.App = App;
