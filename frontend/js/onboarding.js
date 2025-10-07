// frontend/js/onboarding.js
(function () {
  const state = {
    user: null,
    stepIndex: 0,
    submitting: false,
    usernameStatus: { checking: false, available: null, message: '' },
    recommendation: null,
    form: {
      username: '',
      dob: '',
      interests: [],
      motivations: [],
      valueSignals: {},
      tierSignals: {},
      plan: { selection: 'trial', interval: 'monthly' },
      billing: { holder: '', cardNumber: '', expMonth: '', expYear: '', cvc: '' },
      acceptEula: false,
      acceptPrivacy: false
    }
  };

  const interestOptions = [
    { id: 'cashflow-clarity', label: 'Cashflow clarity', caption: 'See real-time burn, free cashflow and spending drivers.' },
    { id: 'document-superpowers', label: 'Document automation', caption: 'Collect, OCR and classify statements automatically.' },
    { id: 'compliance-confidence', label: 'Compliance confidence', caption: 'Never miss a filing deadline or HMRC submission.' },
    { id: 'tax-filing-readiness', label: 'Tax filing readiness', caption: 'Stay prepped for Self Assessment with year-round nudges.' },
    { id: 'tax-optimisation', label: 'Advanced tax optimisation', caption: 'Model allowances, reliefs and smart salary/ dividend mixes.' },
    { id: 'equity-planning', label: 'Equity & CGT planning', caption: 'Simulate option exercises, QSBS/EMI journeys and disposals.' },
    { id: 'wealth-lab', label: 'Scenario lab', caption: 'Stress test goal timelines, savings rates and multi-portfolio plays.' },
    { id: 'net-worth-growth', label: 'Net worth growth', caption: 'Track assets, liabilities and contribution plans in one view.' },
    { id: 'ai-copilot', label: 'AI copilot', caption: 'Receive natural-language advice, alerts and personalised summaries.' }
  ];

  const valueQuestions = [
    { id: 'roi_savings', text: 'Our members save over £1,000 per month when they have clarity on cashflow and spending — does that resonate?', caption: 'We plug directly into bank feeds and receipts to surface leakage instantly.' },
    { id: 'roi_tax_relief', text: 'We surface allowances and reliefs across payroll, ISAs and pensions automatically — would that meaningfully help?', caption: 'Tax optimisation is built-in, not a year-end chore.' },
    { id: 'roi_timeback', text: 'Automating document requests and reconciliation saves members 6+ hours a month — would reclaiming that time be valuable?', caption: 'No more chasing statements or spreadsheets.' },
    { id: 'roi_networth', text: 'Clients typically grow net worth 18% faster by running live wealth scenarios — is that a goal for you?', caption: 'Scenario Lab runs Monte Carlo and “what if” analysis in seconds.' },
    { id: 'roi_confidence', text: 'Having a single source of truth across taxes, goals and obligations reduces anxiety — do you feel that would help?', caption: 'We pair reminders with real-time status so nothing slips.' }
  ];

  const tierQuestions = [
    { id: 'tier_bank_sync', text: 'Do you want automated bank feeds and categorisation rather than manual imports?', caption: 'Starter includes secure Open Banking sync and daily refreshes.' },
    { id: 'tier_tax_ai', text: 'Would AI-generated tax forecasts and proactive relief prompts be useful for your circumstances?', caption: 'Premium layers in advanced HMRC-ready narratives.' },
    { id: 'tier_equity', text: 'Do you manage equity events (options, RSUs, secondary disposals) that need CGT modelling?', caption: 'Premium handles full equity lifecycle analytics.' },
    { id: 'tier_cashflow', text: 'Is guided budgeting with spend controls and anomaly alerts important right now?', caption: 'Starter specialises in keeping day-to-day finances sharp.' },
    { id: 'tier_collaboration', text: 'Do you collaborate with advisers or family who need shared workspaces?', caption: 'Premium offers shared views, exports and governance.' }
  ];

  const planOptions = [
    {
      id: 'trial',
      title: '30-day Premium trial',
      priceMonthly: '£0 for 30 days',
      priceYearly: '£0 today',
      badge: 'Recommended',
      summary: 'Enjoy every premium capability for 30 days. After the trial you glide onto Starter with zero interruption.',
      features: [
        'Premium analytics, Scenario Lab & AI insights',
        'Document vault with automation & reminders',
        'Auto-migrate to Starter after 30 days'
      ]
    },
    {
      id: 'starter',
      title: 'Starter',
      priceMonthly: '£3.99 / mo',
      priceYearly: '£43 / yr',
      badge: 'For foundations',
      summary: 'Stay in control of spending, compliance and core automations with everyday intelligence.',
      features: [
        'Open banking sync + cashflow insights',
        'Document vault & compliance checklist',
        'Goal tracking and accountability nudges'
      ]
    },
    {
      id: 'premium',
      title: 'Premium',
      priceMonthly: '£6.99 / mo',
      priceYearly: '£71 / yr',
      badge: 'Full suite',
      summary: 'Unlock advanced tax intelligence, Scenario Lab and collaboration features built for complex finances.',
      features: [
        'AI-led tax planning & HMRC-ready outputs',
        'Equity & CGT modelling with Scenario Lab',
        'Shared workspaces and concierge support'
      ]
    }
  ];

  const steps = [
    { id: 'intro', eyebrow: 'Welcome', title: 'Let’s shape Phloat around you', render: renderIntro, validate: () => true },
    { id: 'username', eyebrow: 'Identity', title: 'Choose a unique username', render: renderUsername, validate: validateUsername },
    { id: 'dob', eyebrow: 'Identity', title: 'When were you born?', render: renderDob, validate: validateDob },
    { id: 'interests', eyebrow: 'Goals', title: 'What should Phloat focus on first?', render: renderInterests, validate: validateInterests },
    { id: 'value', eyebrow: 'Value', title: 'Does this impact resonate with you?', render: renderValueSignals, validate: validateValueSignals },
    { id: 'tier', eyebrow: 'Fit', title: 'Help us calibrate the right tier', render: renderTierSignals, validate: validateTierSignals },
    { id: 'recommendation', eyebrow: 'Recommendation', title: 'Here’s what we recommend', render: renderRecommendation, validate: () => true },
    { id: 'plan', eyebrow: 'Plan & billing', title: 'Pick your launch plan', render: renderPlan, validate: validatePlan },
    { id: 'legal', eyebrow: 'Agreements', title: 'Review & accept', render: renderLegal, validate: validateLegal }
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  let usernameTimer = null;

  function setProgress() {
    const total = steps.length;
    const current = state.stepIndex + 1;
    $('#progress-label').textContent = `Step ${current} of ${total}`;
    const pct = Math.round((current - 1) / (total - 1) * 100);
    $('#progress-bar').style.width = `${pct}%`;
  }

  function normaliseDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  function buildAnswerMap(questions, responses) {
    return questions.map((q) => ({
      id: q.id,
      question: q.text,
      response: responses[q.id] || 'not_sure'
    }));
  }

  function computeRecommendationPreview() {
    const yesFactor = (value) => value === 'yes' ? 1 : value === 'not_sure' ? 0.5 : 0;
    const interests = state.form.interests;
    let starter = 0;
    let premium = 0;
    interests.forEach((id) => {
      if (['cashflow-clarity','document-superpowers','compliance-confidence','tax-filing-readiness'].includes(id)) starter += 1.5;
      if (['tax-optimisation','equity-planning','net-worth-growth','wealth-lab','ai-copilot'].includes(id)) premium += 2;
    });
    valueQuestions.forEach((q) => {
      const weight = yesFactor(state.form.valueSignals[q.id]);
      if (!weight) return;
      const weights = {
        roi_savings: { starter: 2, premium: 1 },
        roi_tax_relief: { starter: 1, premium: 2 },
        roi_timeback: { starter: 2, premium: 1 },
        roi_networth: { starter: 1, premium: 2 },
        roi_confidence: { starter: 1, premium: 1 }
      }[q.id] || { starter: 1, premium: 1 };
      starter += (weights.starter || 0) * weight;
      premium += (weights.premium || 0) * weight;
    });
    tierQuestions.forEach((q) => {
      const weight = yesFactor(state.form.tierSignals[q.id]);
      if (!weight) return;
      const weights = {
        tier_bank_sync: { starter: 2 },
        tier_tax_ai: { premium: 3 },
        tier_equity: { premium: 3 },
        tier_cashflow: { starter: 2 },
        tier_collaboration: { premium: 2 }
      }[q.id] || {};
      starter += (weights.starter || 0) * weight;
      premium += (weights.premium || 0) * weight;
    });
    const tier = premium - starter >= 2 ? 'premium' : 'starter';
    const summary = tier === 'premium'
      ? 'Premium unlocks AI-led tax intelligence, equity planning and Scenario Lab automation that match what you told us.'
      : 'Starter is ideal right now: automation, compliance nudges and spend analytics build strong financial habits immediately.';
    const reasons = [];
    valueQuestions.forEach((q) => {
      if (state.form.valueSignals[q.id] === 'yes') reasons.push(q.text);
    });
    tierQuestions.forEach((q) => {
      if (state.form.tierSignals[q.id] === 'yes') reasons.push(q.text);
    });
    state.recommendation = {
      tier,
      summary,
      scores: {
        starter: Number(starter.toFixed(2)),
        premium: Number(premium.toFixed(2))
      },
      reasons: reasons.slice(0, 4)
    };
  }

  function updateTierRecap() {
    const card = $('#tier-recap-card');
    const copy = $('#tier-recap-copy');
    if (!state.recommendation) {
      card.classList.remove('active');
      copy.textContent = 'Answer a few questions and we’ll tailor the perfect plan.';
      return;
    }
    card.classList.add('active');
    const tierLabel = state.recommendation.tier === 'premium' ? 'Premium' : 'Starter';
    copy.innerHTML = `<strong>${tierLabel}</strong> feels like the right match. ${state.recommendation.summary}`;
  }

  function renderInsights() {
    const wrap = $('#insight-cards');
    if (!wrap) return;
    wrap.innerHTML = '';
    const selectedInterests = state.form.interests.slice(0, 3).map((id) => {
      const opt = interestOptions.find((item) => item.id === id);
      return opt ? opt.label : id;
    });
    const stepsComplete = state.stepIndex;
    const insightNodes = [];
    insightNodes.push({
      title: 'Workspace status',
      body: stepsComplete === 0
        ? 'We’ll capture a handful of essentials so Phloat can personalise dashboards and automations for you.'
        : `Great progress — ${stepsComplete} of ${steps.length} stages done.`
    });
    if (selectedInterests.length) {
      insightNodes.push({
        title: 'Your focus areas',
        body: selectedInterests.join(', ')
      });
    } else {
      insightNodes.push({
        title: 'Set your focus',
        body: 'Pick the outcomes that matter — cashflow, tax or wealth — so we spotlight the right intel.'
      });
    }
    if (state.form.plan.selection === 'premium') {
      insightNodes.push({
        title: 'Plan preview',
        body: 'Premium unlocks Scenario Lab, AI tax narratives and advanced collaboration from day one.'
      });
    } else if (state.form.plan.selection === 'starter') {
      insightNodes.push({
        title: 'Plan preview',
        body: 'Starter gives you automated banking sync, compliance nudges and smart budgeting guidance.'
      });
    } else {
      insightNodes.push({
        title: 'Trial activated',
        body: 'Your 30-day premium trial keeps everything unlocked, then you glide into Starter automatically.'
      });
    }
    insightNodes.forEach((node) => {
      const card = document.createElement('div');
      card.className = 'insight-card';
      card.innerHTML = `
        <div class="insight-title">${node.title}</div>
        <div class="insight-body">${node.body}</div>
      `;
      wrap.appendChild(card);
    });
  }

  function renderIntro(container) {
    container.innerHTML = `
      <div class="summary-card">
        <h3>What to expect</h3>
        <ul>
          <li>Confirm a username and a few personal details so we can secure your workspace.</li>
          <li>Tell us the outcomes you care about and how you want to measure value.</li>
          <li>We’ll recommend the right tier, start your plan and capture billing securely.</li>
        </ul>
        <p class="mb-0" style="color:#4a5775;">It takes about three minutes. We’ll save as you go — no surprises.</p>
      </div>
    `;
    $('#btn-back').style.visibility = 'hidden';
  }

  function renderUsername(container) {
    $('#btn-back').style.visibility = 'visible';
    container.innerHTML = `
      <form class="stack">
        <div>
          <label class="step-eyebrow" for="username-input">Username</label>
          <input id="username-input" type="text" autocomplete="off" placeholder="yourname" value="${state.form.username}" maxlength="24" />
          <div id="username-hint" class="small" style="margin-top:0.4rem;color:#4f5d7a;">Lowercase letters, numbers or underscores.</div>
        </div>
      </form>
    `;
    const input = $('#username-input');
    input.focus();
    input.addEventListener('input', () => {
      state.form.username = input.value.trim().toLowerCase();
      $('#username-hint').textContent = 'Checking availability…';
      $('#username-hint').style.color = '#4f5d7a';
      state.usernameStatus = { checking: true, available: null, message: '' };
      if (usernameTimer) clearTimeout(usernameTimer);
      usernameTimer = setTimeout(checkUsernameAvailability, 450);
    });
    input.addEventListener('blur', () => {
      if (usernameTimer) clearTimeout(usernameTimer);
      checkUsernameAvailability();
    });
  }

  async function checkUsernameAvailability() {
    if (!state.form.username || state.form.username.length < 3) {
      $('#username-hint').textContent = 'Use at least three characters.';
      $('#username-hint').style.color = '#c2384d';
      state.usernameStatus = { checking: false, available: false, message: 'Username too short.' };
      return;
    }
    state.usernameStatus.checking = true;
    try {
      const res = await Auth.fetch(`/api/user/username-available?value=${encodeURIComponent(state.form.username)}`, { cache: 'no-store' });
      const payload = await res.json();
      if (payload.available) {
        state.usernameStatus = { checking: false, available: true, message: 'Looking great — this username is yours.' };
        $('#username-hint').textContent = state.usernameStatus.message;
        $('#username-hint').style.color = '#1f7a4d';
      } else {
        const suggestion = payload.suggestion ? ` Try \"${payload.suggestion}\"?` : '';
        state.usernameStatus = { checking: false, available: false, message: 'Already taken.' };
        $('#username-hint').textContent = `That username is taken.${suggestion}`;
        $('#username-hint').style.color = '#c2384d';
      }
    } catch (err) {
      console.error('Username availability failed', err);
      state.usernameStatus = { checking: false, available: null, message: '' };
      $('#username-hint').textContent = 'We will validate at submission time.';
      $('#username-hint').style.color = '#4f5d7a';
    }
  }

  function renderDob(container) {
    container.innerHTML = `
      <form>
        <div>
          <label class="step-eyebrow" for="dob-input">Date of birth</label>
          <input id="dob-input" type="date" max="${new Date().toISOString().slice(0,10)}" value="${state.form.dob}" />
          <div class="small" style="margin-top:0.35rem;color:#4f5d7a;">We’ll tailor advice to your life stage and keep your account secure.</div>
        </div>
      </form>
    `;
    const input = $('#dob-input');
    input.focus();
    input.addEventListener('change', () => {
      state.form.dob = input.value;
    });
  }

  function renderInterests(container) {
    container.innerHTML = `
      <div class="stack">
        <div>
          <p style="color:#4a5775;">Pick up to five areas — we’ll tune dashboards, automations and prompts around them.</p>
          <div class="pill-set" id="interest-pills"></div>
        </div>
        <div>
          <p class="step-eyebrow" style="margin-bottom:0.6rem;">What outcomes do you want to see?</p>
          <div class="pill-set" id="motivation-pills"></div>
        </div>
      </div>
    `;
    const interestWrap = $('#interest-pills');
    interestOptions.forEach((opt) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `pill ${state.form.interests.includes(opt.id) ? 'active' : ''}`;
      pill.textContent = opt.label;
      pill.title = opt.caption;
      pill.addEventListener('click', () => {
        toggleSelection(state.form.interests, opt.id, 5);
        pill.classList.toggle('active', state.form.interests.includes(opt.id));
        renderInsights();
      });
      interestWrap.appendChild(pill);
    });

    const motivationOptions = [
      'Reduce tax anxiety',
      'Grow savings faster',
      'Stay HMRC-ready all year',
      'Understand true spending',
      'Optimise investments',
      'Plan equity events'
    ];
    const motivationWrap = $('#motivation-pills');
    motivationOptions.forEach((label) => {
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `pill ${state.form.motivations.includes(label) ? 'active' : ''}`;
      pill.textContent = label;
      pill.addEventListener('click', () => {
        toggleSelection(state.form.motivations, label, 4);
        pill.classList.toggle('active', state.form.motivations.includes(label));
      });
      motivationWrap.appendChild(pill);
    });
  }

  function toggleSelection(list, value, limit) {
    const idx = list.indexOf(value);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      if (limit && list.length >= limit) list.shift();
      list.push(value);
    }
  }

  function renderValueSignals(container) {
    container.innerHTML = `
      <div class="stack" style="gap:1rem;">
        ${valueQuestions.map((q) => `
          <div class="question-card" data-id="${q.id}">
            <div>
              <div class="question-text">${q.text}</div>
              <div class="small" style="color:#5a688d;">${q.caption}</div>
            </div>
            <div class="question-actions">
              ${['yes','not_sure','no'].map((option) => `
                <button type="button" data-response="${option}">${option === 'yes' ? 'Yes' : option === 'not_sure' ? 'Not sure' : 'No'}</button>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    $$('.question-card').forEach((card) => {
      const id = card.dataset.id;
      const buttons = card.querySelectorAll('button');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          state.form.valueSignals[id] = btn.dataset.response;
          buttons.forEach((other) => other.classList.toggle('active', other === btn));
          computeRecommendationPreview();
          updateTierRecap();
        });
        btn.classList.toggle('active', state.form.valueSignals[id] === btn.dataset.response);
      });
    });
  }

  function renderTierSignals(container) {
    container.innerHTML = `
      <div class="stack" style="gap:1rem;">
        ${tierQuestions.map((q) => `
          <div class="question-card" data-id="${q.id}">
            <div>
              <div class="question-text">${q.text}</div>
              <div class="small" style="color:#5a688d;">${q.caption}</div>
            </div>
            <div class="question-actions">
              ${['yes','not_sure','no'].map((option) => `
                <button type="button" data-response="${option}">${option === 'yes' ? 'Yes' : option === 'not_sure' ? 'Not sure' : 'No'}</button>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    $$('.question-card').forEach((card) => {
      const id = card.dataset.id;
      const buttons = card.querySelectorAll('button');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          state.form.tierSignals[id] = btn.dataset.response;
          buttons.forEach((other) => other.classList.toggle('active', other === btn));
          computeRecommendationPreview();
          updateTierRecap();
        });
        btn.classList.toggle('active', state.form.tierSignals[id] === btn.dataset.response);
      });
    });
  }

  function renderRecommendation(container) {
    computeRecommendationPreview();
    updateTierRecap();
    renderInsights();
    const tier = state.recommendation?.tier === 'premium' ? 'Premium' : 'Starter';
    const reasons = state.recommendation?.reasons?.length ? state.recommendation.reasons : ['Tailored automations for your focus areas.', 'Clear, measurable impact on savings and compliance.'];
    container.innerHTML = `
      <div class="summary-card">
        <h3>${tier} feels like home</h3>
        <p style="color:#42527a;">${state.recommendation?.summary || ''}</p>
        <ul>
          ${reasons.map((reason) => `<li>${reason}</li>`).join('')}
        </ul>
        <div class="small" style="color:#586691;">You can always upgrade later — we’ll remind you when Premium unlocks extra leverage.</div>
      </div>
    `;
  }

  function renderPlan(container) {
    renderInsights();
    updateTierRecap();
    container.innerHTML = `
      <div class="stack">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.8rem;">
          <div class="plan-toggle" id="plan-interval">
            <button type="button" data-interval="monthly" class="${state.form.plan.interval === 'monthly' ? 'active' : ''}">Monthly</button>
            <button type="button" data-interval="yearly" class="${state.form.plan.interval === 'yearly' ? 'active' : ''}">Yearly</button>
          </div>
          <div class="small" style="color:#4f5d7a;">Switch to yearly and save up to 15%.</div>
        </div>
        <div class="plan-grid" id="plan-grid"></div>
        <div>
          <div class="step-eyebrow" style="margin-bottom:0.6rem;">Billing details</div>
          <div class="billing-form">
            <div>
              <label for="card-holder">Cardholder name</label>
              <input id="card-holder" type="text" placeholder="Alex Example" value="${state.form.billing.holder}" />
            </div>
            <div>
              <label for="card-number">Card number</label>
              <input id="card-number" inputmode="numeric" autocomplete="off" placeholder="4242 4242 4242 4242" value="${formatCardNumber(state.form.billing.cardNumber)}" />
            </div>
            <div>
              <label for="card-exp">Expiry (MM/YY)</label>
              <input id="card-exp" inputmode="numeric" autocomplete="off" placeholder="04/28" value="${formatExpiry(state.form.billing.expMonth, state.form.billing.expYear)}" />
            </div>
            <div>
              <label for="card-cvc">Security code</label>
              <input id="card-cvc" inputmode="numeric" autocomplete="off" placeholder="123" value="${state.form.billing.cvc}" />
            </div>
          </div>
        </div>
      </div>
    `;
    const grid = $('#plan-grid');
    planOptions.forEach((plan) => {
      const card = document.createElement('div');
      card.className = `plan-card ${state.form.plan.selection === plan.id ? 'active' : ''}`;
      const price = state.form.plan.interval === 'yearly' ? plan.priceYearly : plan.priceMonthly;
      card.innerHTML = `
        <div class="step-eyebrow" style="margin-bottom:0.2rem;">${plan.badge}</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.6rem;">
          <div>
            <div class="plan-price">${price}</div>
            <div style="font-weight:600;font-size:1.05rem;">${plan.title}</div>
          </div>
        </div>
        <div style="color:#506089;font-size:0.9rem;">${plan.summary}</div>
        <ul>${plan.features.map((feat) => `<li>${feat}</li>`).join('')}</ul>
      `;
      card.addEventListener('click', () => {
        state.form.plan.selection = plan.id;
        $$('.plan-card', grid).forEach((el) => el.classList.remove('active'));
        card.classList.add('active');
        renderInsights();
      });
      grid.appendChild(card);
    });
    const intervalToggle = $('#plan-interval');
    intervalToggle.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const interval = btn.dataset.interval;
        state.form.plan.interval = interval;
        intervalToggle.querySelectorAll('button').forEach((other) => other.classList.toggle('active', other === btn));
        renderPlan(container);
      });
    });
    $('#card-holder').addEventListener('input', (event) => {
      state.form.billing.holder = event.target.value;
    });
    $('#card-number').addEventListener('input', (event) => {
      const raw = event.target.value.replace(/[^0-9]/g, '').slice(0, 19);
      state.form.billing.cardNumber = raw;
      event.target.value = raw.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
    });
    $('#card-exp').addEventListener('input', (event) => {
      let raw = event.target.value.replace(/[^0-9]/g, '').slice(0, 4);
      if (raw.length >= 3) {
        raw = `${raw.slice(0,2)}/${raw.slice(2)}`;
      }
      event.target.value = raw;
      const [mm, yy] = raw.split('/');
      state.form.billing.expMonth = mm || '';
      state.form.billing.expYear = yy || '';
    });
    $('#card-cvc').addEventListener('input', (event) => {
      const raw = event.target.value.replace(/[^0-9]/g, '').slice(0, 4);
      state.form.billing.cvc = raw;
      event.target.value = raw;
    });
  }

  function formatExpiry(month, year) {
    if (!month && !year) return '';
    const mm = String(month || '').padStart(2, '0').slice(0, 2);
    const yy = String(year || '').slice(-2);
    if (!mm || !yy) return '';
    return `${mm}/${yy}`;
  }

  function formatCardNumber(value) {
    if (!value) return '';
    return value.replace(/[^0-9]/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  }

  function renderLegal(container) {
    container.innerHTML = `
      <div class="stack">
        <div class="legal-box">
          <label>
            <input type="checkbox" id="chk-eula" ${state.form.acceptEula ? 'checked' : ''}>
            <span>I have read and agree to the <a href="/legal.html" target="_blank" rel="noopener">End User Licence Agreement</a>.</span>
          </label>
          <label>
            <input type="checkbox" id="chk-privacy" ${state.form.acceptPrivacy ? 'checked' : ''}>
            <span>I consent to the <a href="/legal.html#privacy" target="_blank" rel="noopener">Privacy & data handling policy</a>.</span>
          </label>
        </div>
        <div class="summary-card">
          <h3>Ready to launch</h3>
          <p style="color:#4a5775;">We’ll activate your workspace, create your billing profile and take you straight into the app.</p>
          <p style="color:#4a5775;">Expect an onboarding summary email with links to update preferences any time.</p>
        </div>
      </div>
    `;
    $('#chk-eula').addEventListener('change', (event) => {
      state.form.acceptEula = event.target.checked;
    });
    $('#chk-privacy').addEventListener('change', (event) => {
      state.form.acceptPrivacy = event.target.checked;
    });
  }

  function validateUsername() {
    if (!state.form.username || state.form.username.length < 3) {
      showAlert('Pick a username with at least 3 characters.');
      return false;
    }
    if (state.usernameStatus.available === false) {
      showAlert('That username is already taken. Try another.');
      return false;
    }
    hideAlert();
    return true;
  }

  function validateDob() {
    if (!state.form.dob) {
      showAlert('Enter your date of birth so we can configure secure access.');
      return false;
    }
    const age = (() => {
      const date = new Date(state.form.dob);
      if (Number.isNaN(date.getTime())) return null;
      const now = new Date();
      let ageYears = now.getFullYear() - date.getFullYear();
      const m = now.getMonth() - date.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < date.getDate())) ageYears -= 1;
      return ageYears;
    })();
    if (age != null && age < 16) {
      showAlert('You need to be at least 16 years old to use Phloat.');
      return false;
    }
    hideAlert();
    return true;
  }

  function validateInterests() {
    if (!state.form.interests.length) {
      showAlert('Select at least one focus area to continue.');
      return false;
    }
    hideAlert();
    return true;
  }

  function validateValueSignals() {
    const answered = valueQuestions.every((q) => state.form.valueSignals[q.id]);
    if (!answered) {
      showAlert('Answer each question so we can calibrate value.');
      return false;
    }
    hideAlert();
    return true;
  }

  function validateTierSignals() {
    const answered = tierQuestions.every((q) => state.form.tierSignals[q.id]);
    if (!answered) {
      showAlert('Let us know how these capabilities land before we recommend a tier.');
      return false;
    }
    hideAlert();
    return true;
  }

  function validatePlan() {
    const billing = state.form.billing;
    if (!billing.holder || billing.holder.length < 3) {
      showAlert('Enter the cardholder name.');
      return false;
    }
    if (!billing.cardNumber || billing.cardNumber.length < 12) {
      showAlert('Enter a valid card number (demo cards are fine).');
      return false;
    }
    if (!billing.expMonth || !billing.expYear) {
      showAlert('Add the card expiry in MM/YY format.');
      return false;
    }
    hideAlert();
    return true;
  }

  function validateLegal() {
    if (!state.form.acceptEula || !state.form.acceptPrivacy) {
      showAlert('Accept the EULA and privacy policy to continue.');
      return false;
    }
    hideAlert();
    return true;
  }

  function showAlert(message) {
    const alert = $('#step-alert');
    alert.textContent = message;
    alert.classList.add('active');
  }

  function hideAlert() {
    const alert = $('#step-alert');
    alert.textContent = '';
    alert.classList.remove('active');
  }

  function renderStep() {
    const step = steps[state.stepIndex];
    $('#step-title').textContent = step.title;
    $('#step-eyebrow').textContent = step.eyebrow;
    const container = $('#step-content');
    container.innerHTML = '';
    step.render(container);
    setProgress();
    updateButtons();
    renderInsights();
  }

  function updateButtons() {
    const back = $('#btn-back');
    const next = $('#btn-next');
    back.disabled = state.stepIndex === 0 || state.submitting;
    next.disabled = state.submitting;
    if (state.stepIndex === 0) {
      back.style.visibility = 'hidden';
    } else {
      back.style.visibility = 'visible';
    }
    if (state.stepIndex === steps.length - 1) {
      next.textContent = state.submitting ? 'Launching…' : 'Launch workspace';
    } else if (state.stepIndex === steps.length - 2) {
      next.textContent = state.submitting ? 'Continuing…' : 'Continue to review';
    } else {
      next.textContent = state.submitting ? 'Continue…' : 'Continue';
    }
  }

  async function handleNext() {
    if (state.submitting) return;
    const currentStep = steps[state.stepIndex];
    if (!currentStep.validate()) return;
    if (state.stepIndex === steps.length - 1) {
      await submitOnboarding();
      return;
    }
    state.stepIndex = Math.min(state.stepIndex + 1, steps.length - 1);
    hideAlert();
    renderStep();
  }

  function handleBack() {
    if (state.submitting) return;
    if (state.stepIndex === 0) return;
    state.stepIndex = Math.max(state.stepIndex - 1, 0);
    hideAlert();
    renderStep();
  }

  async function submitOnboarding() {
    state.submitting = true;
    updateButtons();
    showAlert('Setting up your workspace…');
    try {
      const payload = {
        username: state.form.username,
        dateOfBirth: state.form.dob,
        interests: state.form.interests,
        motivations: state.form.motivations,
        valueSignals: buildAnswerMap(valueQuestions, state.form.valueSignals),
        tierSignals: buildAnswerMap(tierQuestions, state.form.tierSignals),
        plan: state.form.plan,
        billing: state.form.billing,
        acceptEula: state.form.acceptEula,
        acceptPrivacy: state.form.acceptPrivacy
      };
      const res = await Auth.fetch('/api/user/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unable to complete onboarding.' }));
        throw new Error(err.error || 'Unable to complete onboarding.');
      }
      const data = await res.json();
      hideAlert();
      $('#step-content').innerHTML = `
        <div class="summary-card">
          <h3>All set!</h3>
          <p style="color:#4a5775;">We’ve activated your workspace and tailored the experience to your goals.</p>
          <p style="color:#4a5775;">Redirecting you to your dashboard…</p>
        </div>
      `;
      $('#btn-back').disabled = true;
      $('#btn-next').disabled = true;
      if (data?.user) {
        window.__ME__ = data.user;
        try { localStorage.setItem('me', JSON.stringify(data.user)); } catch {}
      }
      setTimeout(() => {
        window.location.replace('/home.html');
      }, 1600);
    } catch (err) {
      console.error('Onboarding submission failed', err);
      showAlert(err.message || 'Unable to complete onboarding right now.');
    } finally {
      state.submitting = false;
      updateButtons();
    }
  }

  async function init() {
    try {
      const { me } = await Auth.requireAuth();
      state.user = me;
      state.form.username = (me.username || '').toLowerCase();
      state.form.dob = normaliseDate(me.dateOfBirth);
      if (Array.isArray(me.profileInterests) && me.profileInterests.length) {
        state.form.interests = me.profileInterests.slice(0, 5);
      }
      if (Array.isArray(me.onboardingSurvey?.motivations)) {
        state.form.motivations = me.onboardingSurvey.motivations.slice(0, 4);
      }
      if (me.onboardingSurvey?.planChoice?.selection) {
        state.form.plan.selection = me.onboardingSurvey.planChoice.selection;
      }
      if (!state.form.billing.holder) {
        const fullName = [me.firstName, me.lastName].filter(Boolean).join(' ').trim();
        state.form.billing.holder = fullName;
      }
    } catch (err) {
      console.error('Authentication required', err);
      return;
    }
    setProgress();
    updateTierRecap();
    renderInsights();
    renderStep();
  }

  document.addEventListener('click', (event) => {
    if (event.target.id === 'btn-next') {
      handleNext();
    } else if (event.target.id === 'btn-back') {
      handleBack();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
