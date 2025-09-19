// /js/mobile-sidebar.js
// Makes the existing desktop sidebar work as an off-canvas drawer on mobile
(function () {
    const OFFCANVAS_ID = "appSidebar";
    const OFFCANVAS_BODY_ID = "appSidebarBody";
  
    function ready(fn) {
      if (document.readyState !== "loading") fn();
      else document.addEventListener("DOMContentLoaded", fn);
    }
  
    function whenAvailable(selector, cb, timeout = 10000) {
      const start = performance.now();
      (function poll() {
        const el = document.querySelector(selector);
        if (el) return cb(el);
        if (performance.now() - start > timeout) return;
        requestAnimationFrame(poll);
      })();
    }
  
    function ensureOffcanvas() {
      if (document.getElementById(OFFCANVAS_ID)) return;
  
      const oc = document.createElement("div");
      oc.className = "offcanvas offcanvas-start d-lg-none";
      oc.id = OFFCANVAS_ID;
      oc.tabIndex = -1;
      oc.setAttribute("aria-labelledby", "appSidebarLabel");
  
      oc.innerHTML = `
        <div class="offcanvas-header">
          <h5 class="offcanvas-title" id="appSidebarLabel">Menu</h5>
          <button type="button" class="btn-close text-reset" data-bs-dismiss="offcanvas" aria-label="Close"></button>
        </div>
        <div class="offcanvas-body p-0" id="${OFFCANVAS_BODY_ID}">
          <!-- cloned sidebar goes here -->
        </div>
      `;
  
      document.body.appendChild(oc);
  
      // Width control via CSS variable (fallback 280px)
      const style = document.createElement("style");
      style.textContent = `
        :root { --sidebar-w: 280px; }
        #${OFFCANVAS_ID} { width: var(--sidebar-w); }
        /* Hide desktop sidebar on small screens */
        @media (max-width: 991.98px) {
          #sidebar-container { display: none !important; }
        }
        /* Desktop remains exactly as you already have it */
      `;
      document.head.appendChild(style);
    }
  
    function cloneSidebarIntoOffcanvas() {
      const desktop = document.querySelector("#sidebar-container");
      const body = document.getElementById(OFFCANVAS_BODY_ID);
      if (!desktop || !body) return;
  
      // Mirror the current desktop sidebar markup into the mobile drawer
      body.innerHTML = desktop.innerHTML;
  
      // Close drawer when a nav link is clicked
      const links = body.querySelectorAll("a, [data-dismiss-offcanvas]");
      links.forEach((a) => {
        a.addEventListener("click", () => {
          const el = document.getElementById(OFFCANVAS_ID);
          if (!el) return;
          const oc = bootstrap.Offcanvas.getInstance(el) || new bootstrap.Offcanvas(el);
          oc.hide();
        });
      });
    }
  
    function keepInSync() {
      const desktop = document.querySelector("#sidebar-container");
      if (!desktop) return;
      const obs = new MutationObserver(() => cloneSidebarIntoOffcanvas());
      obs.observe(desktop, { childList: true, subtree: true });
    }
  
    function injectHamburger() {
      const target = document.querySelector("#topbar-container");
      if (!target) return;
  
      // Try to place inside the actual navbar container if present
      const host =
        target.querySelector(".navbar .container, .navbar .container-fluid") || target;
  
      // Avoid duplicates
      if (host.querySelector('[data-bs-target="#' + OFFCANVAS_ID + '"]')) return;
  
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-outline-secondary d-lg-none me-2";
      btn.setAttribute("data-bs-toggle", "offcanvas");
      btn.setAttribute("data-bs-target", "#" + OFFCANVAS_ID);
      btn.setAttribute("aria-controls", OFFCANVAS_ID);
      btn.innerHTML = '<i class="bi bi-list" aria-hidden="true"></i><span class="visually-hidden">Open menu</span>';
  
      host.prepend(btn);
    }
  
    ready(() => {
      // 1) Build the offcanvas shell
      ensureOffcanvas();
  
      // 2) Wait for your existing topbar/sidebar to be injected, then wire things up
      whenAvailable("#sidebar-container", () => {
        // Mark desktop sidebar as visible only on lg+
        document.querySelector("#sidebar-container")?.classList.add("d-none", "d-lg-block");
        cloneSidebarIntoOffcanvas();
        keepInSync();
      });
  
      whenAvailable("#topbar-container", () => {
        injectHamburger();
      });
    });
  })();
  