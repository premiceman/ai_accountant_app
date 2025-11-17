(function () {
  const state = {
    insights: null,
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
      renderCashflow(data.series || {});
      renderNetWorth(data.series || {});
      renderCategories(data.categories?.top || [], data.categories?.totalSpend || 0);
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
