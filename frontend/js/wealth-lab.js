// frontend/js/wealth-lab.js
(function () {
  const state = {
    me: null,
    plan: {
      assets: [],
      liabilities: [],
      goals: [],
      contributions: { monthly: 0 },
      summary: { assetAllocation: [], liabilitySchedule: [], projections: { horizonMonths: 0, monthly: [], yearly: [], assumptions: {} }, affordability: { advisories: [], goalScenarios: [] } },
      strategy: { steps: [], milestones: [] }
    }
  };

  const modals = {};
  const charts = { allocation: null };

  init().catch((err) => {
    console.error('Wealth lab failed to initialise', err);
    softError('Unable to load wealth plan. Please refresh.');
  });

  async function init() {
    Auth.setBannerTitle('Wealth strategy lab');
    const { me } = await Auth.requireAuth();
    state.me = me;
    await reloadPlan();
    cacheModals();
    bindEvents();
    renderAll();
  }

  async function reloadPlan() {
    const res = await Auth.fetch('/api/user/me', { cache: 'no-store' });
    if (!res.ok) return;
    const payload = await res.json();
    state.me = payload;
    state.plan = normalisePlan(payload.wealthPlan || {});
  }

  function cacheModals() {
    if (window.bootstrap?.Modal) {
      modals.asset = new bootstrap.Modal(document.getElementById('modal-asset'));
      modals.liability = new bootstrap.Modal(document.getElementById('modal-liability'));
      modals.goal = new bootstrap.Modal(document.getElementById('modal-goal'));
    }
  }

  function bindEvents() {
    byId('wealth-add-asset')?.addEventListener('click', () => {
      resetAssetForm();
      formAsset().dataset.mode = 'create';
      modals.asset?.show();
    });

    formAsset()?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const payload = readAssetForm();
      const mode = formAsset().dataset.mode || 'create';
      const index = Number(formAsset().dataset.index);
      let assets = [...state.plan.assets];
      if (mode === 'edit' && !Number.isNaN(index)) {
        assets[index] = { ...assets[index], ...payload };
      } else {
        assets.push({ ...payload, id: payload.id || cryptoRandom() });
      }
      await persist({ assets });
      modals.asset?.hide();
      toast('Asset saved');
    });

    document.querySelector('#wealth-assets-table tbody')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (btn.dataset.action === 'delete') {
        if (!confirm('Remove this asset?')) return;
        const next = state.plan.assets.filter((_, i) => i !== idx);
        await persist({ assets: next });
        toast('Asset removed');
      }
      if (btn.dataset.action === 'edit') {
        populateAssetForm(state.plan.assets[idx] || {}, idx);
        modals.asset?.show();
      }
    });

    byId('wealth-add-liability')?.addEventListener('click', () => {
      resetLiabilityForm();
      formLiability().dataset.mode = 'create';
      modals.liability?.show();
    });

    formLiability()?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const payload = readLiabilityForm();
      const mode = formLiability().dataset.mode || 'create';
      const index = Number(formLiability().dataset.index);
      let liabilities = [...state.plan.liabilities];
      if (mode === 'edit' && !Number.isNaN(index)) {
        liabilities[index] = { ...liabilities[index], ...payload };
      } else {
        liabilities.push({ ...payload, id: payload.id || cryptoRandom(), status: 'open' });
      }
      await persist({ liabilities });
      modals.liability?.hide();
      toast('Liability saved');
    });

    document.querySelector('#wealth-liabilities-table tbody')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (btn.dataset.action === 'delete') {
        if (!confirm('Remove this liability?')) return;
        const next = state.plan.liabilities.filter((_, i) => i !== idx);
        await persist({ liabilities: next });
        toast('Liability removed');
      }
      if (btn.dataset.action === 'edit') {
        populateLiabilityForm(state.plan.liabilities[idx] || {}, idx);
        modals.liability?.show();
      }
      if (btn.dataset.action === 'toggle') {
        const next = state.plan.liabilities.map((item, i) => i === idx ? { ...item, status: item.status === 'closed' ? 'open' : 'closed' } : item);
        await persist({ liabilities: next });
      }
    });

    byId('wealth-add-goal')?.addEventListener('click', () => {
      resetGoalForm();
      formGoal().dataset.mode = 'create';
      modals.goal?.show();
    });

    formGoal()?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const payload = readGoalForm();
      const mode = formGoal().dataset.mode || 'create';
      const index = Number(formGoal().dataset.index);
      let goals = [...state.plan.goals];
      if (mode === 'edit' && !Number.isNaN(index)) {
        goals[index] = { ...goals[index], ...payload };
      } else {
        goals.push({ ...payload, id: payload.id || cryptoRandom() });
      }
      await persist({ goals });
      modals.goal?.hide();
      toast('Goal saved');
    });

    byId('wealth-goals')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (btn.dataset.action === 'delete') {
        if (!confirm('Remove this goal?')) return;
        const next = state.plan.goals.filter((_, i) => i !== idx);
        await persist({ goals: next });
        toast('Goal removed');
      }
      if (btn.dataset.action === 'edit') {
        populateGoalForm(state.plan.goals[idx] || {}, idx);
        modals.goal?.show();
      }
    });

    byId('wealth-save-monthly')?.addEventListener('click', async () => {
      const monthly = Number(byId('wealth-monthly')?.value || 0);
      await persist({ contributions: { monthly } });
      toast('Contribution saved');
    });

    byId('wealth-refresh-strategy')?.addEventListener('click', async () => {
      await rebuildStrategy();
    });

    byId('wealth-export')?.addEventListener('click', () => {
      window.open('/api/user/wealth-plan/export', '_blank', 'noopener');
    });

    const plannerForm = byId('affordability-form');
    if (plannerForm) {
      plannerForm.addEventListener('input', handlePlannerChange);
      plannerForm.addEventListener('change', handlePlannerChange);
    }

    byId('planner-goal-scenarios')?.addEventListener('click', (ev) => {
      const link = ev.target.closest('button[data-scenario]');
      if (!link) return;
      const amount = Number(link.dataset.amount || 0);
      const months = Number(link.dataset.months || 0);
      if (amount) setValue('planner-goal-amount', amount);
      if (months) setValue('planner-goal-months', months);
      handlePlannerChange();
    });
  }

  function renderAll() {
    renderSummary();
    renderAssets();
    renderLiabilities();
    renderGoals();
    renderStrategy();
    renderAffordabilityPlanner();
    renderAllocationChart();
  }

  function renderSummary() {
    const summary = state.plan.summary || {};
    setText('wealth-networth', money(summary.netWorth));
    setText('wealth-networth-detail', `Assets £${Number(summary.assetsTotal || 0).toLocaleString()} minus liabilities £${Number(summary.liabilitiesTotal || 0).toLocaleString()}`);
    setText('wealth-strength-label', summary.strength != null ? `${Math.round(summary.strength)} / 100` : '—');
    setText('wealth-updated-label', summary.lastComputed ? new Date(summary.lastComputed).toLocaleString() : '—');
    setText('wealth-runway', summary.runwayMonths ? `${summary.runwayMonths} months` : '—');
    setValue('wealth-monthly', state.plan.contributions?.monthly || 0);
    const affordability = summary.affordability || {};
    setText('wealth-safe-rate', affordability.recommendedSavingsRate != null ? formatPercent(affordability.recommendedSavingsRate) : '—');
    setText('wealth-recommended', affordability.recommendedContribution != null ? `£${Number(affordability.recommendedContribution).toLocaleString()}` : '—');
    setText('wealth-free-cashflow', affordability.freeCashflow != null ? `${money(affordability.freeCashflow)}/mo` : '—');
  }

  function renderAssets() {
    const tbody = document.querySelector('#wealth-assets-table tbody');
    const empty = byId('wealth-assets-empty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const list = Array.isArray(state.plan.assets) ? state.plan.assets : [];
    if (!list.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    list.forEach((asset, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="fw-semibold">${escapeHtml(asset.name)}</div>
          <div class="small text-muted">${escapeHtml(asset.category || '')}</div>
        </td>
        <td class="text-end">£${Number(asset.value || 0).toLocaleString()}</td>
        <td class="text-end">${asset.yield != null ? `${Number(asset.yield).toFixed(1)}%` : '—'}</td>
        <td class="text-end">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary" data-action="edit" data-index="${idx}">Edit</button>
            <button class="btn btn-outline-danger" data-action="delete" data-index="${idx}">Delete</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  function renderLiabilities() {
    const tbody = document.querySelector('#wealth-liabilities-table tbody');
    const empty = byId('wealth-liabilities-empty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const list = Array.isArray(state.plan.liabilities) ? state.plan.liabilities : [];
    if (!list.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    list.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="fw-semibold">${escapeHtml(item.name)}</div>
          <div class="small text-muted">${escapeHtml(item.notes || '')}</div>
        </td>
        <td class="text-end">£${Number(item.balance || 0).toLocaleString()}</td>
        <td class="text-end">${item.rate != null ? `${Number(item.rate).toFixed(2)}%` : '—'}</td>
        <td class="text-end">${item.status === 'closed' ? '<span class="badge text-bg-success">Closed</span>' : '<span class="badge text-bg-warning text-dark">Open</span>'}</td>
        <td class="text-end">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary" data-action="edit" data-index="${idx}">Edit</button>
            <button class="btn btn-outline-success" data-action="toggle" data-index="${idx}">${item.status === 'closed' ? 'Reopen' : 'Mark cleared'}</button>
            <button class="btn btn-outline-danger" data-action="delete" data-index="${idx}">Delete</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  function renderGoals() {
    const wrap = byId('wealth-goals');
    const empty = byId('wealth-goals-empty');
    if (!wrap) return;
    wrap.innerHTML = '';
    const list = Array.isArray(state.plan.goals) ? state.plan.goals : [];
    if (!list.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    list.forEach((goal, idx) => {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-xl-4';
      const targetDate = goal.targetDate ? new Date(goal.targetDate) : null;
      const months = targetDate ? monthsUntil(targetDate) : null;
      col.innerHTML = `
        <div class="card h-100 shadow-sm">
          <div class="card-body d-flex flex-column">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div>
                <div class="fw-semibold">${escapeHtml(goal.name)}</div>
                <div class="small text-muted">£${Number(goal.targetAmount || 0).toLocaleString()} target</div>
              </div>
              <span class="badge text-bg-light">${targetDate ? targetDate.toLocaleDateString() : '—'}</span>
            </div>
            <p class="small text-muted flex-grow-1">${escapeHtml(goal.notes || 'No notes added yet.')}</p>
            <div class="small text-muted">${months != null ? `${months} months remaining` : ''}</div>
            <div class="btn-group btn-group-sm mt-3">
              <button class="btn btn-outline-secondary" data-action="edit" data-index="${idx}">Edit</button>
              <button class="btn btn-outline-danger" data-action="delete" data-index="${idx}">Delete</button>
            </div>
          </div>
        </div>`;
      wrap.appendChild(col);
    });
  }

  function renderStrategy() {
    const steps = state.plan.strategy?.steps || [];
    const milestones = state.plan.strategy?.milestones || [];
    const timeline = byId('wealth-timeline');
    const milestoneList = byId('wealth-milestones');
    if (timeline) {
      timeline.innerHTML = '';
      if (!steps.length) {
        const li = document.createElement('li');
        li.className = 'timeline-item';
        li.innerHTML = '<div class="timeline-point bg-secondary"></div><div class="timeline-content">Connect your bank and liabilities to generate a repayment sequence.</div>';
        timeline.appendChild(li);
      } else {
        steps.forEach((step) => {
          const li = document.createElement('li');
          li.className = 'timeline-item';
          li.innerHTML = `
            <div class="timeline-point ${step.type === 'debt' ? 'bg-danger' : 'bg-success'}"></div>
            <div class="timeline-content">
              <h6 class="mb-1">${escapeHtml(step.title || 'Step')}</h6>
              <div class="small text-muted mb-2">${escapeHtml(step.summary || '')}</div>
              <div class="small">${step.startMonth != null ? `Month ${step.startMonth}` : ''}${step.endMonth != null ? ` → Month ${step.endMonth}` : ''}</div>
            </div>`;
          timeline.appendChild(li);
        });
      }
    }
    if (milestoneList) {
      milestoneList.innerHTML = '';
      if (!milestones.length) {
        const li = document.createElement('li');
        li.className = 'list-group-item text-muted';
        li.textContent = 'Milestones will populate once goals and contributions are set.';
        milestoneList.appendChild(li);
      } else {
        milestones.forEach((m) => {
          const li = document.createElement('li');
          li.className = 'list-group-item';
          li.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="fw-semibold">${escapeHtml(m.title || 'Milestone')}</div>
                <div class="small text-muted">${escapeHtml(m.description || '')}</div>
              </div>
              <span class="badge text-bg-light">${m.date ? new Date(m.date).toLocaleDateString() : ''}</span>
            </div>`;
          milestoneList.appendChild(li);
        });
      }
    }
  }

  function renderAffordabilityPlanner() {
    const summary = state.plan.summary || {};
    const affordability = summary.affordability || {};
    const income = affordability.monthlyIncome != null ? `${money(affordability.monthlyIncome)}/mo` : '—';
    const spend = affordability.monthlySpend != null ? `${money(affordability.monthlySpend)}/mo` : '—';
    const debtService = affordability.debtService != null ? `${money(affordability.debtService)}/mo` : '—';
    const freeCash = affordability.freeCashflow != null ? `${money(affordability.freeCashflow)}/mo` : '—';
    const safeRate = affordability.recommendedSavingsRate != null ? formatPercent(affordability.recommendedSavingsRate) : '—';
    const safeMonthly = affordability.recommendedContribution != null
      ? `£${Number(affordability.recommendedContribution).toLocaleString()}/mo`
      : (affordability.safeMonthlySavings != null ? `£${Number(affordability.safeMonthlySavings).toLocaleString()}/mo` : '—');

    setText('planner-income', income);
    setText('planner-spend', spend);
    setText('planner-debt-service', debtService);
    setText('planner-free-cashflow', freeCash);
    setText('planner-safe-rate', safeRate);
    setText('planner-safe-monthly', safeMonthly);

    const scenarioList = byId('planner-goal-scenarios');
    if (scenarioList) {
      scenarioList.innerHTML = '';
      const scenarios = Array.isArray(affordability.goalScenarios) ? affordability.goalScenarios : [];
      if (!scenarios.length) {
        const li = document.createElement('li');
        li.className = 'text-muted';
        li.textContent = 'Log goals to benchmark savings timelines.';
        scenarioList.appendChild(li);
      } else {
        scenarios.forEach((scenario) => {
          const li = document.createElement('li');
          li.className = 'mb-2';
          const months = scenario.recommendedMonths;
          const timeline = months ? `${months} months` : 'No timeline available';
          const target = scenario.targetDate ? new Date(scenario.targetDate) : null;
          const targetLabel = target ? target.toLocaleDateString() : '';
          li.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="fw-semibold">${escapeHtml(scenario.name || 'Goal')}</div>
                <div class="small text-muted">£${Number(scenario.amount || 0).toLocaleString()} • ${timeline}${targetLabel ? ` • target ${targetLabel}` : ''}</div>
              </div>
              <button class="btn btn-link btn-sm text-decoration-none" data-scenario data-amount="${Math.round(Number(scenario.amount || 0))}" data-months="${months || ''}">Use</button>
            </div>`;
          scenarioList.appendChild(li);
        });
      }
    }

    const advisories = Array.isArray(affordability.advisories) ? affordability.advisories : [];
    const advisoryWrap = byId('planner-advisories');
    if (advisoryWrap) {
      advisoryWrap.innerHTML = '';
      if (!advisories.length) {
        const info = document.createElement('div');
        info.className = 'alert alert-light border mb-0';
        info.textContent = 'Connect spend analytics to surface affordability advisories.';
        advisoryWrap.appendChild(info);
      } else {
        advisories.forEach((adv) => {
          const alert = document.createElement('div');
          alert.className = 'alert alert-warning border-start border-3 border-warning-subtle';
          alert.textContent = adv;
          advisoryWrap.appendChild(alert);
        });
      }
    }

    // Ensure planner inputs have sensible defaults before recalculating
    if (!byId('planner-goal-months')?.value) setValue('planner-goal-months', 18);
    handlePlannerChange();
  }

  function renderAllocationChart() {
    const ctx = document.getElementById('wealth-allocation-chart');
    if (!ctx || !window.Chart) return;
    const assets = Number(state.plan.summary?.assetsTotal || 0);
    const liabilities = Number(state.plan.summary?.liabilitiesTotal || 0);
    const data = [Math.max(0, assets), Math.max(0, liabilities)];
    const labels = ['Assets', 'Liabilities'];
    if (!charts.allocation) {
      charts.allocation = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data, backgroundColor: ['#1db954', '#ff4d4d'] }]
        },
        options: { plugins: { legend: { display: false } } }
      });
    } else {
      charts.allocation.data.datasets[0].data = data;
      charts.allocation.update();
    }
  }

  function handlePlannerChange() {
    recalcPlanner();
  }

  function recalcPlanner() {
    const summaryBox = byId('planner-summary');
    if (!summaryBox) return;
    const amount = Number(byId('planner-goal-amount')?.value || 0);
    const months = Number(byId('planner-goal-months')?.value || 0);
    const startVal = byId('planner-goal-start')?.value;
    const startDate = startVal ? new Date(startVal) : null;
    const affordability = state.plan.summary?.affordability || {};
    const safeBase = affordability.safeMonthlySavings != null ? Number(affordability.safeMonthlySavings) : Number(affordability.recommendedContribution || 0);
    const freeCash = Number(affordability.freeCashflow || 0);
    const fallbackContribution = Number(state.plan.contributions?.monthly || 0);
    const safeMonthly = safeBase > 0 ? safeBase : Math.max(0, fallbackContribution + Math.max(0, freeCash));

    const details = [];
    let statusMessage = '';
    let statusClass = 'small mt-2 text-muted';

    if (amount > 0 && months > 0) {
      const requiredMonthly = amount / months;
      details.push(`This goal requires around £${Math.round(requiredMonthly).toLocaleString()} per month to meet a ${months}-month target.`);
      if (safeMonthly > 0) {
        const safeMonths = Math.ceil(amount / safeMonthly);
        details.push(`At your safe savings capacity (£${Math.round(safeMonthly).toLocaleString()} per month) you'd reach the target in about ${safeMonths} months.`);
        if (safeMonths > months) {
          const extra = safeMonths - months;
          const uplift = requiredMonthly - safeMonthly;
          statusMessage = `Expect to extend the timeline by roughly ${extra} month${extra === 1 ? '' : 's'}${uplift > 0 ? ` or increase monthly savings by about £${Math.max(0, Math.round(uplift)).toLocaleString()}.` : '.'}`;
          statusClass = 'small mt-2 text-danger';
        } else {
          statusMessage = 'This goal is achievable within your current savings capacity.';
        }
        if (startDate && Number.isFinite(safeMonths)) {
          const completion = addMonths(startDate, safeMonths);
          details.push(`Projected completion using safe savings: ${completion.toLocaleDateString()}.`);
        }
      } else {
        statusMessage = 'Set a monthly contribution to generate a forecast for this goal.';
      }
    } else if (amount > 0 && !months) {
      statusMessage = 'Specify a target timeline to evaluate affordability.';
    } else {
      statusMessage = 'Enter a target amount to generate recommendations.';
    }

    summaryBox.innerHTML = details.length
      ? details.map((line) => `<p class="mb-1">${escapeHtml(line)}</p>`).join('')
      : '<p class="mb-1 text-muted">Enter a target amount to generate recommendations.</p>';

    const outcome = byId('planner-outcome');
    if (outcome) {
      outcome.textContent = statusMessage;
      outcome.className = statusClass;
    }
  }

  async function persist(patch) {
    const res = await Auth.fetch('/api/user/wealth-plan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error(`Persist failed ${res.status}`);
    const payload = await res.json();
    state.plan = normalisePlan(payload.wealthPlan || {});
    renderAll();
  }

  async function rebuildStrategy() {
    const btn = byId('wealth-refresh-strategy');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Rebuilding';
    try {
      const res = await Auth.fetch('/api/user/wealth-plan/rebuild', { method: 'POST' });
      if (!res.ok) throw new Error(`Rebuild ${res.status}`);
      const payload = await res.json();
      state.plan = normalisePlan(payload.wealthPlan || {});
      renderAll();
      toast('Strategy rebuilt');
    } catch (err) {
      console.error('Strategy rebuild failed', err);
      softError('Unable to rebuild strategy right now. Try again later.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-cpu me-2"></i>Rebuild strategy';
    }
  }

  function normalisePlan(plan) {
    const defaults = {
      assets: [],
      liabilities: [],
      goals: [],
      contributions: { monthly: 0 },
      summary: {},
      strategy: { steps: [], milestones: [] }
    };
    const merged = { ...defaults, ...plan };
    merged.assets = Array.isArray(plan.assets) ? plan.assets.map(normaliseItem) : [];
    merged.liabilities = Array.isArray(plan.liabilities) ? plan.liabilities.map(normaliseItem) : [];
    merged.goals = Array.isArray(plan.goals) ? plan.goals.map(normaliseItem) : [];
    merged.summary = { ...(plan.summary || {}) };
    merged.summary.assetAllocation = Array.isArray(merged.summary.assetAllocation) ? merged.summary.assetAllocation : [];
    merged.summary.liabilitySchedule = Array.isArray(merged.summary.liabilitySchedule) ? merged.summary.liabilitySchedule : [];
    merged.summary.projections = merged.summary.projections || { horizonMonths: 0, monthly: [], yearly: [], assumptions: {} };
    merged.summary.affordability = merged.summary.affordability || {};
    merged.summary.affordability.goalScenarios = Array.isArray(merged.summary.affordability.goalScenarios) ? merged.summary.affordability.goalScenarios : [];
    merged.summary.affordability.advisories = Array.isArray(merged.summary.affordability.advisories) ? merged.summary.affordability.advisories : [];
    merged.strategy = { steps: Array.isArray(plan.strategy?.steps) ? plan.strategy.steps : [], milestones: Array.isArray(plan.strategy?.milestones) ? plan.strategy.milestones : [] };
    merged.contributions = { monthly: Number(plan.contributions?.monthly || 0) };
    return merged;
  }

  function normaliseItem(item = {}) {
    return { id: item.id || cryptoRandom(), ...item };
  }

  function readAssetForm() {
    return {
      id: formAsset().dataset.assetId || cryptoRandom(),
      name: byId('asset-name').value.trim(),
      value: Number(byId('asset-value').value || 0),
      yield: byId('asset-yield').value ? Number(byId('asset-yield').value) : null,
      category: byId('asset-category').value,
      notes: byId('asset-notes').value
    };
  }

  function readLiabilityForm() {
    return {
      id: formLiability().dataset.liabilityId || cryptoRandom(),
      name: byId('liability-name').value.trim(),
      balance: Number(byId('liability-balance').value || 0),
      rate: Number(byId('liability-rate').value || 0),
      minimumPayment: Number(byId('liability-minimum').value || 0),
      notes: byId('liability-notes').value,
      status: 'open'
    };
  }

  function readGoalForm() {
    return {
      id: formGoal().dataset.goalId || cryptoRandom(),
      name: byId('goal-name').value.trim(),
      targetAmount: Number(byId('goal-target').value || 0),
      targetDate: byId('goal-date').value,
      notes: byId('goal-notes').value
    };
  }

  function populateAssetForm(asset, index) {
    formAsset().dataset.mode = 'edit';
    formAsset().dataset.index = index;
    formAsset().dataset.assetId = asset.id;
    setValue('asset-name', asset.name || '');
    setValue('asset-value', asset.value || 0);
    setValue('asset-yield', asset.yield || '');
    setValue('asset-category', asset.category || 'other');
    setValue('asset-notes', asset.notes || '');
  }

  function populateLiabilityForm(item, index) {
    formLiability().dataset.mode = 'edit';
    formLiability().dataset.index = index;
    formLiability().dataset.liabilityId = item.id;
    setValue('liability-name', item.name || '');
    setValue('liability-balance', item.balance || 0);
    setValue('liability-rate', item.rate || 0);
    setValue('liability-minimum', item.minimumPayment || 0);
    setValue('liability-notes', item.notes || '');
  }

  function populateGoalForm(goal, index) {
    formGoal().dataset.mode = 'edit';
    formGoal().dataset.index = index;
    formGoal().dataset.goalId = goal.id;
    setValue('goal-name', goal.name || '');
    setValue('goal-target', goal.targetAmount || 0);
    setValue('goal-date', goal.targetDate ? goal.targetDate.slice(0, 10) : '');
    setValue('goal-notes', goal.notes || '');
  }

  function resetAssetForm() {
    formAsset().reset();
    delete formAsset().dataset.mode;
    delete formAsset().dataset.index;
    delete formAsset().dataset.assetId;
  }

  function resetLiabilityForm() {
    formLiability().reset();
    delete formLiability().dataset.mode;
    delete formLiability().dataset.index;
    delete formLiability().dataset.liabilityId;
  }

  function resetGoalForm() {
    formGoal().reset();
    delete formGoal().dataset.mode;
    delete formGoal().dataset.index;
    delete formGoal().dataset.goalId;
  }

  function monthsUntil(date) {
    const now = new Date();
    const months = (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
    return Math.max(0, Math.round(months));
  }

  function addMonths(date, months) {
    const copy = new Date(date.getTime());
    copy.setMonth(copy.getMonth() + months);
    return copy;
  }

  function formAsset() { return document.getElementById('form-asset'); }
  function formLiability() { return document.getElementById('form-liability'); }
  function formGoal() { return document.getElementById('form-goal'); }

  function setValue(id, value) { const el = byId(id); if (el) el.value = value ?? ''; }
  function setText(id, value) { const el = byId(id); if (el) el.textContent = value ?? '—'; }
  function byId(id) { return document.getElementById(id); }

  function escapeHtml(str) { return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function money(value) { const num = Number(value || 0); const prefix = num < 0 ? '-£' : '£'; return `${prefix}${Math.abs(num).toLocaleString()}`; }
  function formatPercent(value, decimals = 1) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    return `${(Number(value) * 100).toFixed(decimals)}%`;
  }

  function softError(message) {
    const main = document.querySelector('main');
    if (!main) return alert(message);
    const alertEl = document.createElement('div');
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = message;
    main.prepend(alertEl);
    setTimeout(() => alertEl.remove(), 6000);
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'alert alert-success position-fixed top-0 end-0 m-3 shadow';
    el.style.zIndex = 2050;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function cryptoRandom() {
    return 'id-' + Math.random().toString(36).slice(2, 10);
  }
})();
