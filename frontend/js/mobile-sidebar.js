(function () {
  const MENU_ID = 'appBentoMenu';
  const TOGGLE_ID = 'appBentoToggle';
  const CLOSE_ID = 'appBentoClose';
  const OPEN_CLASS = 'app-bento-open';

  const ready = (fn) => (
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', fn)
      : fn()
  );

  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const TILE_COPY = {
    'home.html': 'Command centre for insights and AI commentary.',
    'documents.html': 'Organise statements, receipts, and exports.',
    'compensation.html': 'Model remuneration paths and equity upside.',
    'wealth-lab.html': 'Experiment with investments and long-term goals.',
    'billing.html': 'Manage your subscription, invoices, and payments.',
    'scenario-lab.html': 'Test tax and cashflow outcomes before you commit.',
    'document-vault.html': 'Secure repository for statements and evidence.',
    'gifts.html': 'Track gifting, IHT allowances, and beneficiaries.',
    'profile.html': 'Edit contact details, preferences, and security.'
  };

  function waitFor(predicate, { timeout = 15000, interval = 120 } = {}) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      (function tick() {
        if (predicate()) return resolve(true);
        if (performance.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(tick, interval);
      })();
    });
  }

  function findSidebarRoot(host) {
    if (!host) return null;
    return (
      q('[data-role="sidebar"]', host) ||
      q('nav', host) ||
      q('aside', host) ||
      q('.sidebar', host) ||
      host.firstElementChild ||
      null
    );
  }

  function ensureMenu() {
    let menu = document.getElementById(MENU_ID);
    if (menu) return menu;

    menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = 'app-bento-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-modal', 'true');
    menu.setAttribute('aria-labelledby', 'appBentoTitle');

    menu.innerHTML = `
      <div class="app-bento__header">
        <div>
          <p class="app-bento__eyebrow">Navigate</p>
          <h2 class="app-bento__title mb-0" id="appBentoTitle">Your workspace</h2>
          <p class="app-bento__subtitle mb-0">Jump straight to dashboards, tools, and profile actions.</p>
        </div>
        <button class="app-bento__close" type="button" id="${CLOSE_ID}" aria-label="Close menu">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="app-bento__groups" id="appBentoGroups"></div>
    `;

    document.body.appendChild(menu);
    return menu;
  }

  function ensureToggle() {
    const topbarHost = q('#topbar-container');
    if (!topbarHost) return null;

    const navbar = q('.navbar', topbarHost) || topbarHost;
    const host = q('.navbar .container, .navbar .container-fluid', topbarHost) || navbar;
    if (!host) return null;

    let toggle = host.querySelector(`#${TOGGLE_ID}`);
    if (toggle) return toggle;

    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = TOGGLE_ID;
    toggle.className = 'app-bento-toggle d-lg-none';
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', MENU_ID);
    toggle.innerHTML = `
      <span class="visually-hidden">Open navigation menu</span>
      <span class="app-bento-toggle__dots" aria-hidden="true">
        <span></span><span></span><span></span>
        <span></span><span></span><span></span>
        <span></span><span></span><span></span>
      </span>
    `;

    const brand = host.querySelector('.navbar-brand');
    if (brand?.previousElementSibling) {
      brand.parentElement.insertBefore(toggle, brand);
    } else if (brand) {
      brand.insertAdjacentElement('beforebegin', toggle);
    } else {
      host.prepend(toggle);
    }

    return toggle;
  }

  function collectSections(sidebarHost) {
    const sidebar = findSidebarRoot(sidebarHost);
    const sections = [];
    if (!sidebar) return { sections, signout: null };

    let current = null;
    Array.from(sidebar.children).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.classList.contains('app-nav-title')) {
        const title = (node.textContent || '').trim();
        current = { title: title || 'Navigate', items: [] };
        sections.push(current);
        return;
      }
      if (node.classList.contains('app-nav-sep')) {
        current = null;
        return;
      }
      if (node.matches('a.app-nav-item')) {
        if (!current) {
          current = { title: 'Navigate', items: [] };
          sections.push(current);
        }
        current.items.push(node);
      }
    });

    const signout = sidebarHost.querySelector('#nav-signout');
    return { sections, signout };
  }

  function buildTileFromLink(link, accent = false) {
    const tile = document.createElement('a');
    tile.className = 'app-bento__tile';
    if (accent) tile.classList.add('app-bento__tile--accent');
    tile.href = link.getAttribute('href') || '#';
    tile.setAttribute('data-close-menu', '');

    const iconEl = link.querySelector('i');
    const labelEl = link.querySelector('.label');
    const text = (labelEl?.textContent || link.textContent || '').trim();
    const href = link.getAttribute('href') || '';
    const key = href.split('/').pop() || '';
    const desc = TILE_COPY[key] || link.getAttribute('title') || text;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'app-bento__tile-icon';
    iconWrap.innerHTML = iconEl ? iconEl.outerHTML : '<i class="bi bi-circle"></i>';

    const titleEl = document.createElement('span');
    titleEl.className = 'app-bento__tile-title';
    titleEl.textContent = text || 'Untitled';

    tile.append(iconWrap, titleEl);

    if (desc && desc !== text) {
      const copyEl = document.createElement('span');
      copyEl.className = 'app-bento__tile-copy';
      copyEl.textContent = desc;
      tile.append(copyEl);
    }

    return tile;
  }

  function renderMenuContent(sidebarHost) {
    const menu = ensureMenu();
    const groups = menu.querySelector('#appBentoGroups');
    if (!groups) return;

    const { sections, signout } = collectSections(sidebarHost);
    groups.innerHTML = '';

    let tileCount = 0;
    sections.forEach((section) => {
      const items = section.items || [];
      if (!items.length) return;

      const sectionEl = document.createElement('section');
      sectionEl.className = 'app-bento__group';
      sectionEl.innerHTML = `<p class="app-bento__group-title">${section.title}</p>`;

      const tiles = document.createElement('div');
      tiles.className = 'app-bento__tiles';

      items.forEach((link) => {
        const isAccent = tileCount === 0;
        const tile = buildTileFromLink(link, isAccent);
        if (link.classList.contains('active')) {
          tile.setAttribute('aria-current', 'page');
        }
        tiles.appendChild(tile);
        tileCount += 1;
      });

      sectionEl.appendChild(tiles);
      groups.appendChild(sectionEl);
    });

    if (signout) {
      const sectionEl = document.createElement('section');
      sectionEl.className = 'app-bento__group';
      const tiles = document.createElement('div');
      tiles.className = 'app-bento__tiles';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-bento__tile app-bento__tile--danger';
      btn.setAttribute('data-close-menu', '');
      btn.setAttribute('data-action', 'signout');
      btn.innerHTML = `
        <span class="app-bento__tile-icon"><i class="bi bi-box-arrow-right"></i></span>
        <span class="app-bento__tile-title">Sign out</span>
        <span class="app-bento__tile-copy">Securely log out of your workspace.</span>
      `;

      tiles.appendChild(btn);
      sectionEl.appendChild(tiles);
      groups.appendChild(sectionEl);
    }
  }

  ready(async () => {
    const sidebarHost = document.getElementById('sidebar-container');
    if (!sidebarHost) return;

    try {
      await waitFor(() => !!q('#topbar-container .navbar'));
    } catch { /* no-op */ }

    try {
      await waitFor(() => {
        const root = findSidebarRoot(sidebarHost);
        return !!root && (root.children.length > 0 || (root.textContent || '').trim().length > 10);
      }, { timeout: 20000, interval: 150 });
    } catch { /* continue */ }

    renderMenuContent(sidebarHost);

    const menu = ensureMenu();
    let toggle = ensureToggle();
    const closeBtn = document.getElementById(CLOSE_ID);
    const html = document.documentElement;
    const body = document.body;

    const getFocusable = () => qa('[data-close-menu], a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])', menu)
      .filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));

    let lastActive = null;
    let restoreTimer;
    let scrollOffset = 0;

    const closeMenu = () => {
      if (!menu.classList.contains('is-open')) return;
      menu.classList.remove('is-open');
      body.classList.remove(OPEN_CLASS);
      html.classList.remove(OPEN_CLASS);
      toggle?.setAttribute('aria-expanded', 'false');

      body.style.removeProperty('position');
      body.style.removeProperty('width');
      body.style.removeProperty('top');
      body.style.removeProperty('left');
      body.style.removeProperty('right');
      window.scrollTo(0, scrollOffset);
      scrollOffset = 0;

      const finish = () => { menu.hidden = true; };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish();
      } else {
        menu.addEventListener('transitionend', finish, { once: true });
      }

      if (lastActive) {
        window.clearTimeout(restoreTimer);
        restoreTimer = window.setTimeout(() => {
          try { lastActive.focus({ preventScroll: true }); } catch { /* no-op */ }
        }, 40);
      }
    };

    const openMenu = () => {
      if (!toggle) return;
      lastActive = document.activeElement;
      menu.hidden = false;
      menu.scrollTop = 0;
      requestAnimationFrame(() => menu.classList.add('is-open'));
      body.classList.add(OPEN_CLASS);
      html.classList.add(OPEN_CLASS);
      scrollOffset = window.scrollY || document.documentElement.scrollTop || 0;
      body.style.position = 'fixed';
      body.style.width = '100%';
      body.style.top = `-${scrollOffset}px`;
      body.style.left = '0';
      body.style.right = '0';
      toggle.setAttribute('aria-expanded', 'true');
      const [first] = getFocusable();
      if (first) {
        try { first.focus({ preventScroll: true }); } catch { /* no-op */ }
      }
    };

    const handleToggleClick = () => {
      if (menu.classList.contains('is-open')) closeMenu();
      else openMenu();
    };

    const bindToggle = (btn) => {
      if (!btn || btn.dataset.bentoBound === 'true') return;
      btn.addEventListener('click', handleToggleClick);
      btn.dataset.bentoBound = 'true';
    };

    bindToggle(toggle);

    if (!toggle) {
      const topbarHost = document.getElementById('topbar-container');
      if (topbarHost) {
        const mo = new MutationObserver(() => {
          const created = ensureToggle();
          if (created) {
            toggle = created;
            bindToggle(toggle);
            mo.disconnect();
          }
        });
        mo.observe(topbarHost, { childList: true, subtree: true });
      }
    }

    closeBtn?.addEventListener('click', closeMenu);

    menu.addEventListener('click', (event) => {
      const actionable = event.target.closest('[data-close-menu]');
      if (!actionable) return;

      if (actionable.dataset.action === 'signout') {
        const signoutBtn = sidebarHost.querySelector('#nav-signout');
        if (signoutBtn) {
          signoutBtn.click();
        }
      }

      closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (!menu.classList.contains('is-open')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }

      if (event.key === 'Tab') {
        const focusable = getFocusable();
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    window.addEventListener('resize', () => {
      if (window.matchMedia('(min-width: 992px)').matches) {
        closeMenu();
      }
    });

    const sidebarObserver = new MutationObserver(() => renderMenuContent(sidebarHost));
    sidebarObserver.observe(sidebarHost, { childList: true, subtree: true, attributes: true });
  });
})();
