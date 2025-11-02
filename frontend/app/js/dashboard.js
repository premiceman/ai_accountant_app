document.addEventListener('DOMContentLoaded', async () => {
  const me = await App.bootstrap('dashboard');
  if (!me) return;
  try {
    const [summary, timeseries, batches] = await Promise.all([
      App.Api.analyticsSummary(),
      App.Api.analyticsTimeseries(),
      App.Api.getBatches(),
    ]);
    const latest = summary.latest?.metrics;
    if (latest) {
      document.getElementById('net-cash').textContent = App.formatMoney(latest.totals.netCash);
      document.getElementById('salary-net').textContent = App.formatMoney(latest.salary.net);
    }
    const docCount = batches.batches.reduce((acc, batch) => acc + batch.files.filter((f) => f.status === 'processed').length, 0);
    document.getElementById('doc-count').textContent = docCount;

    const tbody = document.querySelector('#timeseries-table tbody');
    tbody.innerHTML = '';
    (timeseries.series || []).slice(-6).forEach((entry) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${entry.periodValue}</td>
        <td>${App.formatMoney(entry.metrics.totals.inflows)}</td>
        <td>${App.formatMoney(entry.metrics.totals.outflows)}</td>
        <td>${App.formatMoney(entry.metrics.totals.netCash)}</td>`;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error(error);
  }
});
