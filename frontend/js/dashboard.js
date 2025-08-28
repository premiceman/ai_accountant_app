// frontend/js/dashboard.js
(async function () {
    try {
      const { me } = await Auth.requireAuth();
      Auth.setBannerTitle('Dashboard');
      const g = document.getElementById('greeting-name');
      if (g && me?.firstName) g.textContent = me.firstName;
  
      // Fetch summary
      const res = await API.fetch('/api/summary/current-year', { headers: { Authorization: `Bearer ${Auth.getToken()}` } });
      if (!res.ok) throw new Error(`Summary failed (${res.status})`);
      const data = await res.json();
  
      document.getElementById('dash-year').textContent = `Tax year ${data.year}`;
  
      // Render Waterfall
      renderWaterfall('chart-waterfall', data.waterfall || [], data.currency);
  
      // Render EMTR
      renderEMTR('chart-emtr', data.emtr || []);
  
      // Render Gauges
      renderGauges('gauges', data.gauges || {});
  
      // Render Events
      renderEvents('events-list', 'events-empty', data.events || []);
    } catch (e) {
      console.error(e);
      // Soft failure UI
      const wf = document.getElementById('chart-waterfall');
      if (wf) wf.insertAdjacentHTML('beforebegin', `<div class="text-danger small">Could not load dashboard: ${e.message}</div>`);
    }
  })();
  
  // ---- Charts (Chart.js minimal helpers) ----
  
  function renderWaterfall(canvasId, steps, currency = 'GBP') {
    const el = document.getElementById(canvasId);
    if (!el || !Array.isArray(steps) || steps.length === 0) return;
  
    // Compute running totals for a pseudo-waterfall look
    const labels = steps.map(s => s.label);
    const values = steps.map(s => s.amount || 0);
  
    new Chart(el, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '£',
          data: values,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `£${(ctx.parsed.y || 0).toLocaleString()}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => '£' + Number(v).toLocaleString() }
          }
        }
      }
    });
  }
  
  function renderEMTR(canvasId, points) {
    const el = document.getElementById(canvasId);
    if (!el || !Array.isArray(points) || points.length === 0) return;
  
    const xs = points.map(p => p.income || 0);
    const ys = points.map(p => (p.rate || 0) * 100);
  
    new Chart(el, {
      type: 'line',
      data: {
        labels: xs,
        datasets: [{ data: ys, borderWidth: 2, fill: false, tension: 0.2 }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(1)}% EMTR` }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Income (£)' },
            ticks: { callback: (v, i) => '£' + Number(xs[i]).toLocaleString() }
          },
          y: {
            title: { display: true, text: 'Rate (%)' },
            min: 0, max: 100
          }
        }
      }
    });
  }
  
  // ---- Gauges & Events ----
  
  function renderGauges(containerId, gauges) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    const entries = [
      ['Personal allowance', gauges.personalAllowance],
      ['Dividend allowance', gauges.dividendAllowance],
      ['CGT allowance',      gauges.cgtAllowance],
      ['Pension annual',     gauges.pensionAnnual],
      ['ISA',                gauges.isa]
    ];
  
    for (const [label, g] of entries) {
      const used = Math.max(0, Number(g?.used || 0));
      const total = Math.max(1, Number(g?.total || 1));
      const pct = Math.min(100, Math.round((used / total) * 100));
      const pretty = (n) => '£' + Number(n).toLocaleString();
  
      const tile = document.createElement('div');
      tile.className = 'col-12 col-md-6';
      tile.innerHTML = `
        <div class="border rounded p-3 h-100">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <div class="fw-semibold">${label}</div>
            <div class="text-muted small">${pretty(used)} / ${pretty(total)}</div>
          </div>
          <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar" style="width:${pct}%"></div>
          </div>
        </div>`;
      c.appendChild(tile);
    }
  }
  
  function renderEvents(listId, emptyId, events) {
    const ul = document.getElementById(listId);
    const empty = document.getElementById(emptyId);
    if (!ul) return;
  
    ul.innerHTML = '';
    if (!Array.isArray(events) || events.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
  
    for (const ev of events) {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      const dateStr = ev.date ? new Date(ev.date).toLocaleDateString() : '—';
      li.innerHTML = `
        <div>
          <div class="fw-semibold">${ev.title || 'Event'}</div>
          <div class="text-muted small">${dateStr}${ev.kind ? ` · ${ev.kind}` : ''}</div>
        </div>
        ${ev.ctaHref ? `<a class="btn btn-sm btn-outline-primary" href="${ev.ctaHref}">${ev.ctaText || 'Open'}</a>` : ''}
      `;
      ul.appendChild(li);
    }
  }
  