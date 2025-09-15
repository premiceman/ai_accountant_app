// /js/landing.js
(() => {
    if (window.__LANDING_JS_INSTALLED__) return;
    window.__LANDING_JS_INSTALLED__ = true;
  
    // =============== Preferences & helpers ===============
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const lerp = (a, b, t) => a + (b - a) * t;
  
    // =============== Sticky nav polish ===============
    const nav = document.querySelector('.landing-nav');
    const onScrollNav = () => {
      if (!nav) return;
      nav.classList.toggle('scrolled', window.scrollY > 6);
    };
    onScrollNav();
    window.addEventListener('scroll', onScrollNav, { passive: true });
  
    // =============== Smooth anchor scroll ===============
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const tgt = document.querySelector(id);
      if (!tgt) return;
      e.preventDefault();
      if (prefersReduced) {
        tgt.scrollIntoView();
      } else {
        tgt.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  
    // =============== Scroll reveal (IntersectionObserver) ===============
    const revealEls = Array.from(document.querySelectorAll('.reveal'));
    if (revealEls.length) {
      const io = new IntersectionObserver((entries) => {
        // Small stagger per section to make cards cascade in
        const visibleNow = entries
          .filter((en) => en.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
  
        visibleNow.forEach((en, i) => {
          const el = en.target;
          if (el.__revealed) return;
          el.__revealed = true;
  
          // Respect reduced motion: reveal instantly
          if (prefersReduced) {
            el.classList.add('in');
            io.unobserve(el);
            return;
          }
  
          const delay = i * 80; // 80ms stagger feels snappy
          setTimeout(() => {
            el.classList.add('in');
            io.unobserve(el);
          }, delay);
        });
      }, { root: null, rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
  
      revealEls.forEach((el) => io.observe(el));
    }
  
    // =============== Parallax hero (mouse + scroll, rAF) ===============
    const hero = document.querySelector('.hero');
    const layers = hero ? Array.from(hero.querySelectorAll('.parallax .layer')) : [];
    let rafId = null;
    let pointerX = 0, pointerY = 0;        // normalised pointer (-1..1)
    let scrollFactor = 0;                  // 0..1 how far we’ve scrolled past hero
    let currentTX = 0, currentTY = 0;      // smoothed pointer
    const target = { x: 0, y: 0 };
  
    function updatePointer(e) {
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      // use viewport center to normalise
      const cx = window.innerWidth / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (window.innerWidth / 2);
      const dy = (e.clientY - cy) / (Math.max(rect.height, 1) / 2);
      pointerX = clamp(dx, -1, 1);
      pointerY = clamp(dy, -1, 1);
    }
  
    function updateScroll() {
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      // when hero fully on-screen: 0, as we scroll away: up to ~1
      const out = clamp((-rect.top) / Math.max(rect.height, 1), 0, 1.25);
      scrollFactor = out;
    }
  
    function renderParallax() {
      rafId = null;
  
      // ease pointer target
      target.x = lerp(target.x, pointerX, 0.08);
      target.y = lerp(target.y, pointerY, 0.08);
  
      // translate a little less on Y if user scrolled away
      const pointerScale = 1 - clamp(scrollFactor, 0, 1);
      currentTX = target.x * pointerScale;
      currentTY = target.y * pointerScale;
  
      // apply to layers
      // depth is read from data-depth (e.g., 0.08, 0.22)
      // final movement combines a small pointer-based offset and a subtle vertical parallax on scroll
      layers.forEach((layer) => {
        const depth = parseFloat(layer.dataset.depth || '0') || 0;
        // scale movement — keep subtle
        const moveX = currentTX * depth * 28; // px
        const moveY = (currentTY * depth * 18) + (scrollFactor * depth * -40); // px
        layer.style.transform = `translate3d(${moveX.toFixed(2)}px, ${moveY.toFixed(2)}px, 0)`;
      });
    }
  
    const queueRender = () => {
      if (rafId || prefersReduced || layers.length === 0) return;
      rafId = requestAnimationFrame(renderParallax);
    };
  
    if (!prefersReduced && hero && layers.length) {
      // pointer: mouse & touch
      window.addEventListener('mousemove', (e) => { updatePointer(e); queueRender(); }, { passive: true });
      window.addEventListener('touchmove', (e) => {
        if (!e.touches || !e.touches[0]) return;
        const t = e.touches[0];
        updatePointer({ clientX: t.clientX, clientY: t.clientY });
        queueRender();
      }, { passive: true });
  
      // scroll
      window.addEventListener('scroll', () => { updateScroll(); queueRender(); }, { passive: true });
      window.addEventListener('resize', () => { updateScroll(); queueRender(); }, { passive: true });
  
      // initial state
      updateScroll();
      queueRender();
    } else if (layers.length) {
      // Reduced motion: keep layers positioned neutrally
      layers.forEach((layer) => { layer.style.transform = 'translate3d(0,0,0)'; });
    }
  
    // =============== Active section highlighting in top nav ===============
    const sectionIds = ['#features', '#modules', '#advisor', '#security', '#who', '#faq'];
    const sections = sectionIds
      .map((id) => document.querySelector(id))
      .filter(Boolean);
    const navLinks = new Map();
    sectionIds.forEach((id) => {
      const link = document.querySelector(`.landing-nav a[href="${id}"]`);
      if (link) navLinks.set(id, link);
    });
  
    if (sections.length && navLinks.size) {
      let activeId = null;
      const secIO = new IntersectionObserver((entries) => {
        // choose the most visible section near the top
        const visible = entries
          .filter((en) => en.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
        if (!visible.length) return;
  
        const best = visible[0].target.id ? `#${visible[0].target.id}` : null;
        if (best && best !== activeId) {
          activeId = best;
          // clear / set active styles
          for (const [, link] of navLinks) link.classList.remove('active');
          const L = navLinks.get(best);
          if (L) L.classList.add('active');
        }
      }, { root: null, rootMargin: '-20% 0px -70% 0px', threshold: 0.01 });
  
      sections.forEach((sec) => secIO.observe(sec));
    }
  
    // =============== Fallback: reveal anything already in view on load ===============
    window.addEventListener('load', () => {
      document.querySelectorAll('.reveal').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.9) el.classList.add('in');
      });
    });
  })();
  