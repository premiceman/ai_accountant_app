// /js/mobile-sidebar.js
// Mobile off-canvas that mirrors the desktop sidebar once it's actually populated.
// Also injects a correctly placed, properly sized navbar toggler button.

(function () {
    const OFFCANVAS_ID = "appSidebar";
    const OFFCANVAS_BODY_ID = "appSidebarBody";
  
    // ---------- tiny utils ----------
    const ready = (fn) =>
      (document.readyState === "loading"
        ? document.addEventListener("DOMContentLoaded", fn)
        : fn());
  
    function q(sel, root = document) { return root.querySelector(sel); }
    function qa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  
    // Poll + observe until predicate is true
    function waitFor(predicate, { timeout = 15000, interval = 120 } = {}) {
      return new Promise((resolve, reject) => {
        const start = performance.now();
        (function tick() {
          if (predicate()) return resolve(true);
          if (performance.now() - start > timeout) return reject(new Error("timeout"));
          setTimeout(tick, interval);
        })();
      });
    }
  
    // ---------- offcanvas shell ----------
    function ensureOffcanvas() {
      if (document.getElementById(OFFCANVAS_ID)) return;
  
      const el = document.createElement("div");
      el.className = "offcanvas offcanvas-start d-lg-none";
      el.id = OFFCANVAS_ID;
      el.tabIndex = -1;
      el.setAttribute("aria-labelledby", "appSidebarLabel");
      el.setAttribute("data-bs-scroll", "true");
  
      el.innerHTML = `
        <div class="offcanvas-header">
          <h5 class="offcanvas-title m-0" id="appSidebarLabel">Menu</h5>
          <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
        </div>
        <div class="offcanvas-body p-0" id="${OFFCANVAS_BODY_ID}"></div>
      `;
  
      document.body.appendChild(el);
  
      // Minimal CSS to size the drawer + button + hide desktop sidebar on mobile
      const style = document.createElement("style");
      style.textContent = `
        :root { --sidebar-w: 280px; }
        #${OFFCANVAS_ID} { width: var(--sidebar-w); }
        @media (max-width: 991.98px) {
          #sidebar-container { display: none !important; }
        }
        /* Big, tappable hamburger */
        .mobile-menu-btn {
          width: 44px; height: 44px;
          display: inline-flex; align-items: center; justify-content: center;
          border: 1px solid var(--bs-border-color, rgba(0,0,0,.15));
          border-radius: .5rem; background: transparent;
        }
        .mobile-menu-btn svg { width: 24px; height: 24px; }
        .navbar .mobile-menu-btn { margin-right: .5rem; }
      `;
      document.head.appendChild(style);
  
      // Delegate: close drawer when any link inside is clicked
      el.addEventListener("click", (evt) => {
        const a = evt.target.closest("a,[data-dismiss-offcanvas]");
        if (!a) return;
  
        const bs = window.bootstrap;
        const OffcanvasCtor = bs && bs.Offcanvas ? bs.Offcanvas : null;
        if (!OffcanvasCtor) return;
  
        const inst = OffcanvasCtor.getInstance(el) || new OffcanvasCtor(el);
        inst.hide();
      });
    }
  
    // Prefer a nested nav/aside if present (avoids copying unrelated wrappers)
    function findSidebarRoot(host) {
      return (
        q('[data-role="sidebar"]', host) ||
        q("nav", host) ||
        q("aside", host) ||
        q(".sidebar", host) ||
        host
      );
    }
  
    // Keep mobile drawer in sync with desktop sidebar
    function syncSidebar() {
      const desktopHost = q("#sidebar-container");
      const mobileBody = document.getElementById(OFFCANVAS_BODY_ID);
      if (!desktopHost || !mobileBody) return;
  
      const src = findSidebarRoot(desktopHost);
  
      // Only copy once there's meaningful content
      const meaningful =
        src && (src.children.length > 0 || (src.textContent || "").trim().length > 10);
      if (!meaningful) return;
  
      mobileBody.innerHTML = src.innerHTML;
  
      // Optional hook: if your sidebar needs JS re-binding on the cloned DOM
      if (typeof window.rehydrateSidebar === "function") {
        try { window.rehydrateSidebar(mobileBody); } catch (e) { /* no-op */ }
      }
    }
  
    function observeSidebarChanges() {
      const desktopHost = q("#sidebar-container");
      if (!desktopHost) return;
  
      // Re-sync on any subtree change (sidebar is often injected/replaced dynamically)
      const mo = new MutationObserver(() => syncSidebar());
      mo.observe(desktopHost, { childList: true, subtree: true, attributes: true });
    }
  
    // ---------- navbar hamburger ----------
    function injectHamburger() {
      const topbar = q("#topbar-container");
      if (!topbar) return;
  
      // Find the best insertion point: inside .navbar > .container|.container-fluid
      const navbar = q(".navbar", topbar) || topbar;
      const host =
        q(".navbar .container, .navbar .container-fluid", topbar) ||
        navbar;
  
      // Avoid duplicates
      if (host.querySelector(`[data-bs-target="#${OFFCANVAS_ID}"]`)) return;
  
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mobile-menu-btn d-lg-none";
      btn.setAttribute("data-bs-toggle", "offcanvas");
      btn.setAttribute("data-bs-target", `#${OFFCANVAS_ID}`);
      btn.setAttribute("aria-controls", OFFCANVAS_ID);
      btn.setAttribute("aria-label", "Open menu");
      // Inline SVG burger (no dependency on Bootstrap Icons)
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" stroke-width="2" stroke-linecap="round"/>
        </svg>
      `;
  
      // Place after brand if present, else at the very start
      const brand = q(".navbar-brand", host);
      if (brand?.nextSibling) brand.after(btn);
      else if (brand) brand.insertAdjacentElement("afterend", btn);
      else host.prepend(btn);
    }
  
    // ---------- bootstrap guard ----------
    function ensureBootstrapReady() {
      // If bootstrap isn't loaded yet, we still set up DOM; Offcanvas instance is created on first open.
      if (!("bootstrap" in window)) {
        console.warn("[mobile-sidebar] Bootstrap not found yet. Ensure bootstrap.bundle.js is loaded before this file.");
      }
    }
  
    // ---------- init ----------
    ready(async () => {
      ensureOffcanvas();
      ensureBootstrapReady();
  
      // Wait until your app has actually injected the sidebar markup
      try {
        await waitFor(() => {
          const host = q("#sidebar-container");
          if (!host) return false;
          const src = findSidebarRoot(host);
          return !!src && (src.children.length > 0 || (src.textContent || "").trim().length > 10);
        }, { timeout: 20000, interval: 150 });
      } catch (e) {
        // Still proceed; syncSidebar() + MutationObserver will handle late loads.
      }
  
      // First sync + keep in sync
      syncSidebar();
      observeSidebarChanges();
  
      // Only then inject the button (so placement uses the final navbar DOM)
      injectHamburger();
    });
  })();
  