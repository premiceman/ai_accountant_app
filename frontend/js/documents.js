// frontend/js/documents.js
// Legacy entrypoint retained for backward compatibility. Redirect users to the combined vault view.
(async function redirectToVault() {
  try {
    if (window.Auth && typeof Auth.requireAuth === 'function') {
      await Auth.requireAuth();
    }
  } catch (err) {
    console.warn('[documents.js] auth check failed', err);
  }
  window.location.replace('/document-vault.html');
})();
