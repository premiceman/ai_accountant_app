document.addEventListener('DOMContentLoaded', async () => {
  await App.bootstrap('advice');
  const container = document.getElementById('advice-list');
  const rebuildBtn = document.getElementById('rebuild-btn');

  async function load() {
    const data = await App.Api.getAdvice();
    container.innerHTML = '';
    if (!data.items.length) {
      container.innerHTML = '<div class="empty-state">No advice yet. Generate insights from your analytics data.</div>';
      return;
    }
    data.items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <h3>${item.topic}</h3>
        <p>${item.summary}</p>
        <p><strong>Severity:</strong> ${item.severity} · <strong>Confidence:</strong> ${(item.confidence * 100).toFixed(0)}%</p>
        <ul>${(item.actions || []).map((action) => `<li>${action}</li>`).join('')}</ul>
        <p class="subtitle">Provenance: ${(item.sourceRefs || []).map((ref) => `${ref.fileId}#${ref.anchor}`).join(', ')}</p>`;
      container.appendChild(card);
    });
  }

  rebuildBtn.addEventListener('click', async () => {
    rebuildBtn.disabled = true;
    rebuildBtn.textContent = 'Generating…';
    try {
      await App.Api.rebuildAdvice();
      await load();
    } catch (error) {
      console.error(error);
    } finally {
      rebuildBtn.disabled = false;
      rebuildBtn.textContent = 'Regenerate advice';
    }
  });

  load();
});
