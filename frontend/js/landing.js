// /frontend/js/landing.js
(() => {
    const io = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }),
      { threshold: 0.12 }
    );
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  
    const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReduced) {
      const root = document.querySelector('.hero .parallax');
      if (root) {
        const layers = [...root.querySelectorAll('.layer')].map(el => ({
          el, depth: parseFloat(el.dataset.depth || '0')
        }));
        const onMove = (x, y) => {
          const cx = (x / innerWidth) - 0.5;
          const cy = (y / innerHeight) - 0.5;
          layers.forEach(({ el, depth }) => {
            el.style.transform = `translate3d(${cx*depth*40}px, ${cy*depth*40}px, 0)`;
          });
        };
        addEventListener('mousemove', e => onMove(e.clientX, e.clientY), { passive: true });
        addEventListener('touchmove', e => { const t = e.touches[0]; if (t) onMove(t.clientX, t.clientY); }, { passive: true });
      }
    }
  })();
  