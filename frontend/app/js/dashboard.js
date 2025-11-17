(function () {
  const state = {
    insights: null,
    charts: {},
  };

  function formatCurrency(value, currency = 'GBP', { invert = false } = {}) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '—';
    }
    const amount = invert ? -Number(value) : Number(value);
    const formatter = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'GBP',
      maximumFractionDigits: 2,
    });
    return formatter.format(amount);
  }

  function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    return `${Math.round(Number(value) * 100)}%`;
  }

  function formatMonthLabel(month) {
    if (!month) return '—';
    const date = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return month;
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(date);
  }

  function setLoading(isLoading) {
    const loading = document.getElementById('dashboard-loading');
    const summary = document.getElementById('dashboard-summary');
    if (!loading || !summary) return;
    loading.hidden = !isLoading;
    summary.ariaBusy = isLoading ? 'true' : 'false';
  }

  function setMonthsBadge(summary) {
    const badge = document.getElementById('dashboard-months');
    if (!badge) return;
    if (!summary || !summary.months || !summary.months.count) {
      badge.textContent = 'No data yet';
      return;
    }
    const { start, end, count } = summary.months;
    const rangeLabel = start === end ? formatMonthLabel(start) : `${formatMonthLabel(start)} – ${formatMonthLabel(end)}`;
    const plural = count === 1 ? 'month' : 'months';
    badge.textContent = `${count} ${plural}: ${rangeLabel}`;
  }

  function renderSummary(summary) {
    const container = document.getElementById('dashboard-summary');
    const empty = document.getElementById('dashboard-empty');
    if (!container || !empty) return;
    container.innerHTML = '';

    if (!summary || !summary.totals) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    setMonthsBadge(summary);

    const tiles = [
      { label: 'Total income', value: summary.totals.income },
      { label: 'Total spend', value: summary.totals.spend, invert: true },
      { label: 'Net cashflow', value: summary.totals.cashflow },
      { label: 'Latest net worth', value: summary.netWorth?.latest },
    ];

    const change =
      summary.netWorth?.latest !== null && summary.netWorth?.previous !== null
        ? summary.netWorth.latest - summary.netWorth.previous
        : null;
    if (change !== null) {
      tiles.push({ label: 'Net worth change', value: change });
    }

    tiles
      .filter((tile) => tile.value !== null && tile.value !== undefined)
      .forEach(({ label, value, invert }) => {
        const tile = document.createElement('div');
        tile.className = 'summary-tile';
        const metricLabel = document.createElement('span');
        metricLabel.className = 'metric-label';
        metricLabel.textContent = label;
        const metricValue = document.createElement('p');
        metricValue.className = 'metric-value';
        metricValue.textContent = formatCurrency(value, 'GBP', { invert });
        tile.append(metricLabel, metricValue);
        container.appendChild(tile);
      });

    if (!container.children.length) {
      empty.hidden = false;
    }
  }

  function destroyChart(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      state.charts[key] = null;
    }
  }

  function buildSeriesMonths(series = {}) {
    const months = new Set();
    ['income', 'spend', 'cashflow', 'netWorth'].forEach((key) => {
      (series[key] || []).forEach((item) => months.add(item.month));
    });
    return Array.from(months).sort();
  }

  function renderCashflowChart(series = {}) {
    const ctx = document.getElementById('cashflow-chart');
    const empty = document.getElementById('cashflow-chart-empty');
    destroyChart('cashflow');

    const months = buildSeriesMonths(series);
    if (!ctx || !months.length || typeof Chart === 'undefined') {
      if (empty) empty.hidden = false;
      return;
    }

    const labels = months.map((month) => formatMonthLabel(month));
    const incomeSeries = months.map((month) => series.income?.find((item) => item.month === month)?.amount || 0);
    const spendSeries = months.map((month) => series.spend?.find((item) => item.month === month)?.amount || 0);
    const cashflowSeries = months.map((month) => series.cashflow?.find((item) => item.month === month)?.amount || 0);

    if (empty) empty.hidden = true;
    state.charts.cashflow = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Income',
            data: incomeSeries,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            tension: 0.35,
            fill: false,
            pointRadius: 3,
          },
          {
            label: 'Outgoings',
            data: spendSeries.map((value) => (value ? -Math.abs(value) : 0)),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            tension: 0.35,
            fill: false,
            pointRadius: 3,
          },
          {
            label: 'Net cashflow',
            data: cashflowSeries,
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            borderDash: [6, 6],
            tension: 0.25,
            fill: false,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: '#e2e8f0' },
            grid: { color: 'rgba(148, 163, 184, 0.15)' },
          },
          y: {
            ticks: {
              callback: (value) => formatCurrency(value),
              color: '#e2e8f0',
            },
            grid: { color: 'rgba(148, 163, 184, 0.15)' },
          },
        },
        plugins: {
          legend: { labels: { color: '#e2e8f0' } },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
            },
          },
        },
      },
    });
  }

  function renderNetWorthChart(series = {}) {
    const ctx = document.getElementById('networth-chart');
    const empty = document.getElementById('networth-chart-empty');
    destroyChart('networth');

    const entries = series.netWorth || [];
    if (!ctx || !entries.length || typeof Chart === 'undefined') {
      if (empty) empty.hidden = false;
      return;
    }

    const labels = entries.map((item) => formatMonthLabel(item.month));
    const values = entries.map((item) => item.amount || 0);
    if (empty) empty.hidden = true;

    state.charts.networth = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Net worth',
            data: values,
            borderColor: '#a855f7',
            backgroundColor: 'rgba(168, 85, 247, 0.12)',
            tension: 0.35,
            fill: true,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `Net worth: ${formatCurrency(context.parsed.y)}`,
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (value) => formatCurrency(value),
              color: '#e2e8f0',
            },
            grid: { color: 'rgba(148, 163, 184, 0.12)' },
          },
          x: { ticks: { color: '#e2e8f0' }, grid: { display: false } },
        },
      },
    });
  }

  function renderCategoryChart(categories = []) {
    const ctx = document.getElementById('category-chart');
    const empty = document.getElementById('category-chart-empty');
    destroyChart('categories');

    const labels = categories.map((cat) => cat.category || 'Other');
    const values = categories.map((cat) => Math.abs(cat.amount || 0));

    if (!ctx || !values.length || typeof Chart === 'undefined') {
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    state.charts.categories = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: ['#22c55e', '#ef4444', '#38bdf8', '#f59e0b', '#a855f7', '#10b981', '#f97316', '#94a3b8'],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#e2e8f0' } },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: ${formatCurrency(context.parsed)}`,
            },
          },
        },
      },
    });
  }

  function renderPayrollHistogram(payroll = {}) {
    const ctx = document.getElementById('payroll-chart');
    const empty = document.getElementById('payroll-chart-empty');
    destroyChart('payroll');

    const bins = payroll.histogram?.net?.bins || [];
    if (!ctx || !bins.length || typeof Chart === 'undefined') {
      if (empty) empty.hidden = false;
      return;
    }

    const labels = bins.map((bin) => `${formatCurrency(bin.min)} – ${formatCurrency(bin.max)}`);
    const values = bins.map((bin) => bin.count || 0);

    if (empty) empty.hidden = true;
    state.charts.payroll = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Net pay frequency',
            data: values,
            backgroundColor: 'rgba(56, 189, 248, 0.35)',
            borderColor: '#38bdf8',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: '#e2e8f0' },
            grid: { color: 'rgba(148, 163, 184, 0.12)' },
          },
          y: {
            ticks: { color: '#e2e8f0', precision: 0 },
            beginAtZero: true,
            grid: { color: 'rgba(148, 163, 184, 0.12)' },
          },
        },
      },
    });
  }

  function renderNetWorthHero(summary) {
    const hero = document.getElementById('networth-hero');
    const change = document.getElementById('networth-change');
    if (!hero) return;

    const latest = summary?.netWorth?.latest;
    const previous = summary?.netWorth?.previous;
    hero.textContent = latest !== null && latest !== undefined ? formatCurrency(latest) : '—';

    if (change) {
      if (latest !== null && previous !== null && latest !== undefined && previous !== undefined) {
        const delta = latest - previous;
        const direction = delta > 0 ? '▲' : delta < 0 ? '▼' : '→';
        change.textContent = `${direction} ${formatCurrency(delta)} vs previous month`;
        change.hidden = false;
      } else {
        change.hidden = true;
      }
    }
  }

  function renderRunRate(summary) {
    const incomeEl = document.getElementById('runrate-income');
    const spendEl = document.getElementById('runrate-spend');
    const savingsEl = document.getElementById('runrate-savings');
    if (!incomeEl || !spendEl || !savingsEl || !summary?.months?.count) return;

    const months = summary.months.count || 0;
    const avgIncome = months ? (summary.totals.income || 0) / months : null;
    const avgSpend = months ? (summary.totals.spend || 0) / months : null;
    const savingsRate = summary.totals.income ? summary.totals.cashflow / summary.totals.income : null;

    incomeEl.textContent = avgIncome !== null ? formatCurrency(avgIncome) : '—';
    spendEl.textContent = avgSpend !== null ? formatCurrency(avgSpend, 'GBP', { invert: true }) : '—';
    savingsEl.textContent = savingsRate !== null ? formatPercent(savingsRate) : '—';
  }

  function renderCashflow(series = {}) {
    const table = document.querySelector('#cashflow-table tbody');
    const empty = document.getElementById('cashflow-empty');
    if (!table || !empty) return;

    table.innerHTML = '';
    const rows = (series.cashflow || series.net || series.income || []).map((item) => item.month);
    const uniqueMonths = Array.from(new Set(rows)).sort();
    if (!uniqueMonths.length) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    uniqueMonths.forEach((month) => {
      const income = series.income?.find((item) => item.month === month)?.amount;
      const spend = series.spend?.find((item) => item.month === month)?.amount;
      const cashflow = series.cashflow?.find((item) => item.month === month)?.amount;

      const row = document.createElement('tr');
      const monthCell = document.createElement('td');
      monthCell.textContent = formatMonthLabel(month);
      const incomeCell = document.createElement('td');
      incomeCell.textContent = formatCurrency(income);
      const spendCell = document.createElement('td');
      spendCell.textContent = formatCurrency(spend, 'GBP', { invert: true });
      const netCell = document.createElement('td');
      netCell.textContent = formatCurrency(cashflow);
      row.append(monthCell, incomeCell, spendCell, netCell);
      table.appendChild(row);
    });
  }

  function renderNetWorth(series = {}) {
    const table = document.querySelector('#networth-table tbody');
    const empty = document.getElementById('networth-empty');
    if (!table || !empty) return;
    table.innerHTML = '';

    const entries = (series.netWorth || series).filter?.(() => true) || series.netWorth || [];
    if (!entries.length) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    entries.forEach((item) => {
      const row = document.createElement('tr');
      const monthCell = document.createElement('td');
      monthCell.textContent = formatMonthLabel(item.month);
      const valueCell = document.createElement('td');
      valueCell.textContent = formatCurrency(item.amount);
      row.append(monthCell, valueCell);
      table.appendChild(row);
    });
  }

  function renderCategories(categories = [], totalSpend = 0) {
    const table = document.querySelector('#category-table tbody');
    const empty = document.getElementById('category-empty');
    if (!table || !empty) return;
    table.innerHTML = '';

    if (!categories.length) {
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    categories.forEach((category) => {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = category.category || 'Other';
      const amountCell = document.createElement('td');
      amountCell.textContent = formatCurrency(category.amount || 0, 'GBP', { invert: true });
      const shareCell = document.createElement('td');
      const share = category.share ?? (totalSpend ? category.amount / totalSpend : null);
      shareCell.textContent = share ? formatPercent(share) : '—';
      row.append(nameCell, amountCell, shareCell);
      table.appendChild(row);
    });
  }

  function renderInsights(aiInsights) {
    const container = document.getElementById('insights-body');
    if (!container) return;
    container.innerHTML = '';

    if (!aiInsights || (!aiInsights.summary && !aiInsights.highlights?.length && !aiInsights.risks?.length)) {
      const p = document.createElement('p');
      p.className = 'empty-indicator';
      p.textContent = 'Insights will appear here once analytics are available.';
      container.appendChild(p);
      return;
    }

    if (aiInsights.summary) {
      const summary = document.createElement('p');
      summary.textContent = aiInsights.summary;
      container.appendChild(summary);
    }

    const listSections = [
      { label: 'Highlights', items: aiInsights.highlights },
      { label: 'Watchouts', items: aiInsights.risks },
    ];

    listSections.forEach(({ label, items }) => {
      if (!items || !items.length) return;
      const heading = document.createElement('h4');
      heading.textContent = label;
      heading.className = 'insight-heading';
      container.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'insight-list';
      items.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
      container.appendChild(list);
    });

    if (aiInsights.model) {
      const meta = document.createElement('p');
      meta.className = 'subtitle';
      meta.textContent = `Generated with ${aiInsights.model}`;
      container.appendChild(meta);
    }
  }

  async function loadInsights() {
    setLoading(true);
    try {
      const data = await App.Api.getDashboardInsights();
      state.insights = data;
      renderSummary(data.summary);
      renderNetWorthHero(data.summary);
      renderRunRate(data.summary);
      renderCashflow(data.series || {});
      renderCashflowChart(data.series || {});
      renderNetWorth(data.series || {});
      renderNetWorthChart(data.series || {});
      renderCategories(data.categories?.top || [], data.categories?.totalSpend || 0);
      renderCategoryChart(data.categories?.top || []);
      renderPayrollHistogram(data.payroll || {});
      renderInsights(data.aiInsights);
    } catch (error) {
      console.error('Failed to load dashboard insights', error);
      const empty = document.getElementById('dashboard-empty');
      if (empty) {
        empty.hidden = false;
        empty.textContent = 'We could not load analytics right now. Please try again.';
      }
    } finally {
      setLoading(false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    App.bootstrap('dashboard')
      .then((me) => {
        if (!me) return;
        return loadInsights();
      })
      .catch((error) => {
        console.error('Dashboard initialisation failed', error);
        const empty = document.getElementById('dashboard-empty');
        if (empty) {
          empty.hidden = false;
          empty.textContent = 'We could not load your dashboard. Please refresh to try again.';
        }
      });
  });
})();
