// frontend/js/ui-hygiene.js
// Clean up any orphan Bootstrap modal/offcanvas backdrops and stuck body state.
(function modalHygiene() {
    function cleanup() {
      document.querySelectorAll('.modal-backdrop, .offcanvas-backdrop').forEach(el => el.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('paddingRight');
      document.body.style.removeProperty('overflow');
    }
    document.addEventListener('hidden.bs.modal', cleanup);
    document.addEventListener('hidden.bs.offcanvas', cleanup);
    window.addEventListener('pageshow', cleanup);
  })();

