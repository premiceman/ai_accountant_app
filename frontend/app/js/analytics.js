document.addEventListener('DOMContentLoaded', async () => {
  await App.bootstrap('analytics');
  try {
    const [summary, timeseries, commitments] = await Promise.all([
      App.Api.analyticsSummary(),
      App.Api.analyticsTimeseries(),
      App.Api.analyticsCommitments(),
    ]);
    if (summary.latest) {
      const period = summary.latest.periodValue;
      document.getElementById('analytics-month').textContent = period;
      document.getElementById('analytics-net').textContent = App.formatMoney(summary.latest.metrics.totals.netCash);
      document.getElementById('analytics-salary').textContent = App.formatMoney(summary.latest.metrics.salary.net);
      const categories = await App.Api.analyticsCategories(period);
      const list = document.getElementById('category-list');
      list.innerHTML = '';
      Object.entries(categories.categories || {}).slice(0, 5).forEach(([name, amount]) => {
        const li = document.createElement('li');
        li.textContent = `${name}: ${App.formatMoney(amount)}`;
        list.appendChild(li);
      });
    }
    const tbody = document.querySelector('#analytics-trend tbody');
    tbody.innerHTML = '';
    timeseries.series.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.periodValue}</td>
        <td>${App.formatMoney(item.metrics.totals.inflows)}</td>
        <td>${App.formatMoney(item.metrics.totals.outflows)}</td>
        <td>${App.formatMoney(item.metrics.totals.netCash)}</td>`;
      tbody.appendChild(tr);
    });
    const commitmentsList = document.getElementById('commitments-list');
    commitmentsList.innerHTML = '';
    Object.entries(commitments.commitments || {}).slice(0, 6).forEach(([name, amount]) => {
      const li = document.createElement('li');
      li.textContent = `${name}: ${App.formatMoney(amount)}`;
      commitmentsList.appendChild(li);
    });
  } catch (error) {
    console.error(error);
  }
});
