// frontend/js/vault-rename-inline.js
// Enables "double-click filename to rename" on the vault files list without UI changes.
(function(){
    const root = document; // event delegation on whole doc
    function closestAttr(el, attr) {
      while (el && el !== document) {
        if (el.hasAttribute && el.hasAttribute(attr)) return el;
        el = el.parentNode;
      }
      return null;
    }
    // You likely render file rows with a data-file-id and a filename span.
    // This works if either the filename element has data-file-id or any ancestor does.
    root.addEventListener('dblclick', async (e) => {
      const nameEl = closestAttr(e.target, 'data-file-name');
      if (!nameEl) return;
      const idEl = closestAttr(nameEl, 'data-file-id') || closestAttr(nameEl.parentNode, 'data-file-id') || closestAttr(e.target, 'data-file-id');
      if (!idEl) return;
  
      const fileId = idEl.getAttribute('data-file-id');
      const oldName = nameEl.getAttribute('data-file-name');
  
      const proposed = prompt('Rename file (will be saved as PDF):', oldName);
      if (!proposed) return;
  
      try {
        const res = await Auth.fetch(`/api/vault/files/${fileId}`, {
          method: 'PATCH',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ name: proposed })
        });
        if (!res.ok) {
          const j = await res.json().catch(()=>({}));
          throw new Error(j.error || 'Rename failed');
        }
        const j = await res.json();
        // Update in-place
        nameEl.textContent = j.name;
        nameEl.setAttribute('data-file-name', j.name);
        // If your row stores the id on a parent, update it
        (idEl).setAttribute('data-file-id', j.id);
        // If you have cached hrefs, update them
        const row = idEl;
        const viewLink = row.querySelector('[data-view-link]');
        const dlLink = row.querySelector('[data-download-link]');
        if (viewLink) viewLink.setAttribute('href', j.viewUrl);
        if (dlLink) dlLink.setAttribute('href', j.downloadUrl);
      } catch (err) {
        alert(err.message || 'Rename failed');
      }
    }, false);
  })();
  