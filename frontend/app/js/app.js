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
    updateMe: (payload) => request('/api/v2/me', { method: 'PATCH', body: JSON.stringify(payload) }),
    getBatches: () => request('/api/v2/vault/files'),
    presign: (payload) => request('/api/v2/vault/presign', { method: 'POST', body: JSON.stringify(payload) }),
    ingest: (payload) => request('/api/v2/vault/ingest', { method: 'POST', body: JSON.stringify(payload) }),
    analyticsSummary: () => request('/api/v2/analytics/summary'),
    analyticsTimeseries: () => request('/api/v2/analytics/timeseries'),
    analyticsCategories: (month) => request(`/api/v2/analytics/categories?month=${encodeURIComponent(month || '')}`),
    analyticsCommitments: () => request('/api/v2/analytics/commitments'),
    getAdvice: () => request('/api/v2/advice'),
    rebuildAdvice: () => request('/api/v2/advice/rebuild', { method: 'POST' }),
    taxSnapshot: (taxYear) => request(`/api/v2/tax/snapshot?taxYear=${encodeURIComponent(taxYear)}`),
    taxBundle: () => request('/api/v2/tax/bundle', { method: 'POST' }),
    requeue: (id) => request(`/api/v2/admin/dead-letters/${id}/requeue`, { method: 'POST' }),
  };

  function formatMoney(pence) {
    const amount = Number(pence || 0) / 100;
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
  }

  function formatDate(date) {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  async function bootstrap(activeNavId) {
    const navItems = document.querySelectorAll('nav a');
    navItems.forEach((item) => {
      if (item.dataset.nav === activeNavId) {
        item.classList.add('active');
      }
    });
    const me = await Api.getMe();
    if (!me) return null;
    const nameEl = document.querySelector('[data-user-name]');
    if (nameEl) {
      nameEl.textContent = `${me.profile.firstName} ${me.profile.lastName}`;
    }
    return me;
  }

  return { Api, formatMoney, formatDate, bootstrap };
})();

window.App = App;
