(function () {
  const milestonesHost = document.querySelector('[data-milestones]');
  const timelineList = document.querySelector('[data-timeline]');
  const progressEl = document.querySelector('[data-progress]');
  const body = document.body;

  if (!milestonesHost || !timelineList || !progressEl || !body) return;

  const timelineData = [
    {
      id: 'feb-2025-idea',
      month: 'February 2025',
      meta: 'Concept foundry',
      title: 'Idea ignition and charter',
      summary: 'Product, engineering, and founding accountants shaped the original Phloat hypothesis: an AI-native finance cockpit that feels bespoke for every client engagement.',
      highlights: [
        'Strategic workshops translating firm pains into an AI-first charter with measurable KPIs.',
        'Experience principles and tone-of-voice frames for every touchpoint, from onboarding to insights.',
        'North-star service blueprint published to align data, AI, and practitioner workflows.'
      ],
      phase: 'ground'
    },
    {
      id: 'mar-2025-architecture',
      month: 'March 2025',
      meta: 'Architecture studio',
      title: 'Systems and data architecture',
      summary: 'Domain-driven modelling and interface canvases defined how ledgers, vaults, tax logic, and AI inference layers align without breaking compliance.',
      highlights: [
        'Canonical data contracts for payroll, tax, expenses, and wealth modules.',
        'Interface choreography for “operational vs. advisory” navigation modes.',
        'Zero-trust perimeter baseline with staged environments and audit overlays.'
      ],
      phase: 'ground'
    },
    {
      id: 'apr-2025-architecture-review',
      month: 'April 2025',
      meta: 'Design councils',
      title: 'Architecture review and sign-off',
      summary: 'Architecture guild, compliance, and customer councils pressure-tested every service line and governance layer before the first sprint even began.',
      highlights: [
        'Runbook for resilience, chaos drills, and observability golden signals.',
        'Threat modelling with red-team partners focused on AI prompt-injection vectors.',
        'Regulatory checkpoint with UK and EU compliance partners for audit defensibility.'
      ],
      phase: 'clouds'
    },
    {
      id: 'may-2025-firm-council',
      month: 'May 2025',
      meta: 'Accounting councils',
      title: 'Practitioner interviews and co-design',
      summary: 'We partnered with mid-size accounting firms across the UK to sequence real document packs, workflows, and tax filings, mapping the human moments where AI must feel like a trusted colleague.',
      highlights: [
        'Advisory roundtables across payroll, tax, and wealth practices to prioritise releases.',
        'Voice-of-customer repository, tagging 480+ practitioner insights into feature heuristics.',
        'Engagement UX playbooks capturing how firms orchestrate reviews with clients.'
      ],
      phase: 'clouds'
    },
    {
      id: 'jun-2025-ai-build',
      month: 'June 2025',
      meta: 'AI foundry',
      title: 'AI architecture build-out',
      summary: 'From embeddings pipelines to retrieval orchestration, our AI platform matured into a controllable, observable layer that respects financial-grade guardrails.',
      highlights: [
        'Multi-vector semantic retrieval tuned for UK finance vocabulary and HMRC nuance.',
        'Evaluator harnesses scoring hallucination risk, with human-in-the-loop rehearsal days.',
        'Realtime feature store connecting live financial deltas with advisor prompts.'
      ],
      phase: 'clouds'
    },
    {
      id: 'jul-2025-security',
      month: 'July 2025',
      meta: 'Security hardening',
      title: 'Security, privacy, and resilience gauntlet',
      summary: 'Before launch we ran resilience months: layered encryption, tamper-evident logging, and red-team incidents to certify finance-grade trust.',
      highlights: [
        'Field-level encryption, hardware-backed key rotation, and per-tenant isolation.',
        'Continuous compliance scanning mapped to SOC2, ISO 27001, and FCA expectations.',
        'Synthetic attack simulations validated incident response orchestration and SLAs.'
      ],
      phase: 'stratosphere'
    },
    {
      id: 'aug-2025-scenario-lab',
      month: 'August 2025',
      meta: 'Prototype lifts',
      title: 'Scenario Lab early access',
      summary: 'Scenario Lab previewed Monte Carlo, goal testing, and risk sweeps, letting advisors rehearse future states alongside clients with cinematic clarity.',
      highlights: [
        'Dynamic narratives translating probability surfaces into advisor-ready talking points.',
        'Scenario templating with instant exports for board packs and executive updates.',
        'AI narrator “Aurora” summarising best-fit actions per persona and lifecycle stage.'
      ],
      phase: 'stratosphere'
    },
    {
      id: 'sep-2025-release',
      month: 'September 2025',
      meta: 'Launch window',
      title: 'Solution release to production',
      summary: 'Phloat took flight. Operational hubs, AI copilots, and compliance tooling converged into a single glass cockpit for modern accounting teams.',
      highlights: [
        'Progressive rollout across our charter firms with 99.96% availability.',
        'Launch playbooks with live command centre, telemetry walls, and customer rituals.',
        'Advisor enablement kits blending live demos, quickstart journeys, and certification.'
      ],
      phase: 'stratosphere',
      release: true
    },
    {
      id: 'oct-2025-heuristic',
      month: 'October 2025',
      meta: 'AI validation',
      title: 'Heuristic validation engine',
      summary: 'Our heuristics layer cross-checks AI reasoning with statutory rules, firm policies, and prior filings—flagging anomalies before they reach clients.',
      highlights: [
        'Composite heuristics mixing symbolic checks with behavioural analytics.',
        'Confidence telemetry for every insight, complete with suggested remediation.',
        'Explainable traces so auditors and advisors can replay AI decisions instantly.'
      ],
      phase: 'stratosphere'
    },
    {
      id: 'nov-2025-vault',
      month: 'November 2025',
      meta: 'Smart document vault',
      title: 'Autonomous classification & curation',
      summary: 'Every document streaming into Phloat is enriched, labelled, and routed with AI-driven certainty—turning raw uploads into a queryable knowledge vault.',
      highlights: [
        'Few-shot classifiers tuned for payslips, P11Ds, SA302s, and corporate packs.',
        'Adaptive confidence thresholds triggering human review when edge cases appear.',
        'Knowledge graph overlay linking documents to entities, tasks, and engagements.'
      ],
      phase: 'stratosphere'
    },
    {
      id: 'dec-2025-hmrc',
      month: 'December 2025',
      meta: 'HMRC & tax intelligence',
      title: 'Live HMRC policy alignment',
      summary: 'AI copilots digest HMRC bulletins, tax tribunal outcomes, and thresholds nightly—surfacing advice that is current, explainable, and client-ready.',
      highlights: [
        'Auto-diffing policy updates against client portfolios with suggested actions.',
        'Embedded HMRC API sync for submission, payment status, and reconciliation cues.',
        'Narrative heatmaps showing exposure, relief opportunities, and filing readiness.'
      ],
      phase: 'stratosphere'
    },
    {
      id: 'jan-2026-scenario-autopilot',
      month: 'January 2026',
      meta: 'Scenario lab',
      title: 'Scenario Lab autopilot',
      summary: 'Scenario Lab graduated into autopilot mode: heuristics monitor market shifts, generating proactive “what-if” stories before clients even ask.',
      highlights: [
        'Always-on guardrails watching equity events, interest-rate moves, and compensation swings.',
        'Personalised narratives blending natural language, charts, and compliance context.',
        'Workflow hooks piping insights into tasking tools, CRM systems, and audit queues.'
      ],
      phase: 'space'
    },
    {
      id: 'feb-2026-open-banking',
      month: 'February 2026',
      meta: 'Connectivity',
      title: 'Open Banking integration',
      summary: 'Regulated PSD2 connectivity streams live cashflow, reconciliation context, and anomaly detection into the copilot.',
      highlights: [
        'Direct bank feeds with consent vaulting, robust SCA flows, and instant revocation.',
        'Cashflow heuristics correlating spend, payroll, and tax exposures in near-real time.',
        'Bank-grade monitoring layered with anomaly explanations for practitioners and clients.'
      ],
      phase: 'space'
    },
    {
      id: 'mar-2026-enterprise',
      month: 'March 2026',
      meta: 'Enterprise suite',
      title: 'Enterprise controls and multi-entity orchestration',
      summary: 'We equipped CFO organisations with granular controls, role-aware experiences, and integration fabrics to run complex groups on autopilot.',
      highlights: [
        'Delegated administration, workspace segmentation, and policy-as-code guardrails.',
        'Workflow APIs bridging ERPs, HRIS, and practice management systems.',
        'Executive war rooms showing live burn, runway, and compliance posture for every entity.'
      ],
      phase: 'space'
    },
    {
      id: 'beyond-2026-roadmap',
      month: 'Beyond 2026',
      meta: 'Roadmap orbit',
      title: 'Roadmap • Orbiting initiatives',
      summary: 'Our flightpath pushes further into autonomous finance—Open Banking intelligence and the enterprise constellation remain in active burn as we head into orbit.',
      highlights: [
        'Unified telemetry between heuristics, Scenario Lab, and operational workflows.',
        'Open Banking AI co-pilot turning live cashflow into adaptive tax and treasury moves.',
        'Enterprise constellation enabling cross-region compliance, risk dashboards, and AI guardrails.'
      ],
      phase: 'space',
      orbit: [
        {
          title: 'Open Banking Integration',
          copy: 'Next-gen consent journeys, enriched transactions, and AML signals orbiting every workspace.'
        },
        {
          title: 'Enterprise Solution',
          copy: 'Multi-entity observability, delegated AI policies, and executive-grade reporting in one orbit.'
        }
      ]
    }
  ];

  const fragmentTimeline = document.createDocumentFragment();
  const fragmentSections = document.createDocumentFragment();

  timelineData.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'timeline-item';
    li.dataset.target = item.id;
    li.dataset.order = String(index);
    li.innerHTML = `
      <div class="timeline-item-title">${item.title}</div>
      <div class="timeline-item-meta">${item.month}</div>
    `;
    li.addEventListener('click', () => {
      const section = document.getElementById(item.id);
      if (!section) return;
      section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    fragmentTimeline.appendChild(li);

    const section = document.createElement('section');
    section.className = `milestone-section milestone-phase-${item.phase}`;
    section.id = item.id;
    section.dataset.order = String(index);
    section.dataset.phase = item.phase;
    section.setAttribute('data-milestone', '');

    const highlightsHtml = (item.highlights || []).map((point) => `
      <li>
        <i class="bi bi-stars" aria-hidden="true"></i>
        <span>${point}</span>
      </li>
    `).join('');

    section.innerHTML = `
      <div class="milestone-meta">
        <span class="milestone-month">${item.month}</span>
        <span class="milestone-tag">${item.meta}</span>
      </div>
      <h2 class="milestone-title">${item.title}</h2>
      <p class="milestone-summary">${item.summary}</p>
      <ul class="milestone-points">${highlightsHtml}</ul>
    `;

    if (item.release) {
      const release = document.createElement('div');
      release.className = 'release-burst';
      release.dataset.release = '';
      release.innerHTML = `
        <div class="release-rocket" aria-hidden="true"></div>
      `;
      section.appendChild(release);
      const label = document.createElement('div');
      label.className = 'release-label';
      label.textContent = 'Release achieved';
      section.appendChild(label);
    }

    if (item.orbit && item.orbit.length) {
      const orbit = document.createElement('div');
      orbit.className = 'roadmap-orbit';
      const core = document.createElement('div');
      core.className = 'roadmap-core';
      core.textContent = 'Roadmap';
      orbit.appendChild(core);
      item.orbit.forEach((node) => {
        const satellite = document.createElement('div');
        satellite.className = 'roadmap-satellite';
        satellite.innerHTML = `
          <strong>${node.title}</strong>
          <span>${node.copy}</span>
        `;
        orbit.appendChild(satellite);
      });
      section.appendChild(orbit);
    }

    fragmentSections.appendChild(section);
  });

  timelineList.appendChild(fragmentTimeline);
  milestonesHost.appendChild(fragmentSections);

  const sections = Array.from(milestonesHost.querySelectorAll('[data-milestone]'));
  const items = Array.from(timelineList.querySelectorAll('.timeline-item'));
  const releaseBurst = milestonesHost.querySelector('[data-release]');
  const releaseIndex = timelineData.findIndex((item) => item.release);

  let activeOrder = 0;
  let rafId = null;
  const visibleOrders = new Set();

  function setActive(order) {
    if (Number.isNaN(order) || order === activeOrder) return;
    activeOrder = order;

    items.forEach((item) => {
      const itemOrder = Number(item.dataset.order);
      item.classList.toggle('is-active', itemOrder === order);
      item.classList.toggle('is-past', itemOrder < order);
    });

    sections.forEach((section) => {
      const sectionOrder = Number(section.dataset.order);
      section.classList.toggle('is-active', sectionOrder === order);
    });

    const phase = timelineData[order]?.phase || 'ground';
    body.dataset.phase = phase;

    if (progressEl) {
      const progress = timelineData.length > 1 ? (order / (timelineData.length - 1)) * 100 : 100;
      progressEl.style.height = `${progress}%`;
    }

    if (releaseBurst && releaseIndex >= 0) {
      if (timelineData[order]?.release) {
        releaseBurst.classList.add('is-launched');
      } else if (!visibleOrders.has(releaseIndex)) {
        releaseBurst.classList.remove('is-launched');
      }
    }
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const order = Number(entry.target.dataset.order);
      if (entry.isIntersecting) {
        visibleOrders.add(order);
      } else {
        visibleOrders.delete(order);
      }
    });

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (!visibleOrders.size) return;
      const highest = Math.max(...visibleOrders);
      setActive(highest);
    });
  }, {
    threshold: 0.35,
    rootMargin: '-35% 0px -35% 0px'
  });

  sections.forEach((section) => observer.observe(section));
  setActive(0);

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!prefersReducedMotion.matches) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.body.scrollHeight });
    });
  }
})();
