document.addEventListener('DOMContentLoaded', async () => {
  await App.bootstrap('tax');
  try {
    const bundle = await App.Api.taxBundle();
    const select = document.getElementById('tax-year-select');
    const tbody = document.querySelector('#tax-table tbody');
    tbody.innerHTML = '';
    select.innerHTML = '';
    if (!bundle.snapshots.length) {
      document.getElementById('tax-summary').innerHTML = '<p>No tax-year snapshots available yet.</p>';
      return;
    }
    bundle.snapshots.forEach((snapshot, index) => {
      const option = document.createElement('option');
      option.value = snapshot.periodValue;
      option.textContent = snapshot.periodValue;
      if (index === 0) option.selected = true;
      select.appendChild(option);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${snapshot.periodValue}</td>
        <td>${App.formatMoney(snapshot.metrics.totals.inflows)}</td>
        <td>${App.formatMoney(snapshot.metrics.totals.outflows)}</td>
        <td>${App.formatMoney(snapshot.metrics.totals.netCash)}</td>`;
      tbody.appendChild(tr);
    });

    async function updateSummary(taxYear) {
      if (!taxYear) return;
      const { snapshot } = await App.Api.taxSnapshot(taxYear);
      const card = document.getElementById('tax-summary');
      card.innerHTML = `
        <h3>${snapshot.periodValue}</h3>
        <p><strong>Total inflows:</strong> ${App.formatMoney(snapshot.metrics.totals.inflows)}</p>
        <p><strong>Total outflows:</strong> ${App.formatMoney(snapshot.metrics.totals.outflows)}</p>
        <p><strong>Net cash:</strong> ${App.formatMoney(snapshot.metrics.totals.netCash)}</p>
        <p class="subtitle">Backed by ${snapshot.sourceRefs.length} source references.</p>`;
    }

    select.addEventListener('change', (event) => {
      updateSummary(event.target.value);
    });

    if (select.value) {
      updateSummary(select.value);
    }
  } catch (error) {
    console.error(error);
  }
});
