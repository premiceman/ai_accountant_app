// frontend/js/nav.js
// Loads the topbar + sidebar, highlights active route, and handles mobile toggle.
(async function initNav() {
    // Ensure containers exist
    let topbar = document.getElementById('topbar-container');
    if (!topbar) {
      topbar = document.createElement('div');
      topbar.id = 'topbar-container';
      document.body.prepend(topbar);
    }
    let sidebar = document.getElementById('sidebar-container');
    if (!sidebar) {
      sidebar = document.createElement('div');
      sidebar.id = 'sidebar-container';
      document.body.appendChild(sidebar);
    }
  
    // Fetch and inject chrome
    async function inject(id, url) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) document.getElementById(id).innerHTML = await r.text();
      } catch (e) {
        console.warn('Failed to load', url, e);
      }
    }
    await inject('topbar-container', './components/topbar.html');
    await inject('sidebar-container', './components/sidebar.html');
  
    // Active link highlighting
    const path = (location.pathname || '').split('/').pop().toLowerCase();
    document.querySelectorAll('.app-sidebar .app-nav-item').forEach(a => {
      const route = (a.getAttribute('data-route') || '').toLowerCase();
      if (route && path === route) a.classList.add('active');
    });
  
    // Mobile toggle (adds/removes .sidebar-open on <body>)
    const toggle = document.getElementById('sidebarToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-open');
      });
    }
  
    // Clicking outside sidebar on mobile closes it
    document.addEventListener('click', (ev) => {
      if (!document.body.classList.contains('sidebar-open')) return;
      const sb = document.querySelector('.app-sidebar');
      if (!sb) return;
      if (!sb.contains(ev.target) && !ev.target.closest('#sidebarToggle')) {
        document.body.classList.remove('sidebar-open');
      }
    });
  
  })();
  