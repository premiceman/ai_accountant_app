// frontend/js/vault.js
(function () {
  const API_BASE = '/api/vault';
  const POLL_INTERVAL_UPLOAD = 3000;
  const POLL_INTERVAL_TILES = 10000;
  const POLL_INTERVAL_LISTS = 15000;
  const PROCESS_POLL_INTERVAL = 3000;
  const STATUS_LABELS = {
    idle: 'Ready',
    queued: 'Queued',
    processing: 'Processing…',
    completed: 'Completed',
    failed: 'Failed',
    rejected: 'Rejected',
    needs_trim: 'Manual trim required',
    awaiting_manual_json: 'Manual JSON required',
  };
  const STATUS_ICONS = {
    idle: 'bi-pause-circle',
    queued: 'bi-clock-history',
    completed: 'bi-check-circle',
    failed: 'bi-x-octagon',
    rejected: 'bi-x-octagon',
    needs_trim: 'bi-exclamation-triangle',
    awaiting_manual_json: 'bi-pencil-square',
  };
  const LEGACY_STATUS_MAP = {
    red: 'queued',
    amber: 'processing',
    yellow: 'processing',
    orange: 'processing',
    green: 'completed',
    complete: 'completed',
    completed: 'completed',
    success: 'completed',
    error: 'failed',
    failed: 'failed',
    waiting: 'queued',
    pending: 'queued',
    ready: 'idle',
  };
  const TRIM_AUTOTRIM_MESSAGE = 'Document trimmed automatically. Review before processing.';
  const STORAGE_KEY = 'vault.uploadSessions.v1';

  const BRAND_THEMES = [
    { className: 'vault-card--brand-monzo', tokens: ['monzo'] },
    { className: 'vault-card--brand-halifax', tokens: ['halifax'] },
    { className: 'vault-card--brand-lloyds', tokens: ['lloyds', 'lloyd'] },
    { className: 'vault-card--brand-hsbc', tokens: ['hsbc'] },
    { className: 'vault-card--brand-natwest', tokens: ['natwest', 'nat west', 'royal bank of scotland'] },
    { className: 'vault-card--brand-santander', tokens: ['santander'] },
    { className: 'vault-card--brand-barclays', tokens: ['barclays', 'barclaycard'] },
    { className: 'vault-card--brand-starling', tokens: ['starling'] },
    { className: 'vault-card--brand-revolut', tokens: ['revolut'] },
    { className: 'vault-card--brand-nationwide', tokens: ['nationwide'] },
    { className: 'vault-card--brand-firstdirect', tokens: ['first direct'] },
    { className: 'vault-card--brand-tsb', tokens: ['tsb'] },
    { className: 'vault-card--brand-vanguard', tokens: ['vanguard'] },
    { className: 'vault-card--brand-fidelity', tokens: ['fidelity'] },
    { className: 'vault-card--brand-hl', tokens: ['hargreaves', 'lansdown'] },
    { className: 'vault-card--brand-aviva', tokens: ['aviva'] },
    { className: 'vault-card--brand-scottishwidows', tokens: ['scottish widows'] },
    { className: 'vault-card--brand-hmrc', tokens: ['hmrc', 'hm revenue', "her majesty's revenue"] },
    { className: 'vault-card--brand-amazon', tokens: ['amazon'] },
    { className: 'vault-card--brand-google', tokens: ['google', 'alphabet'] },
    { className: 'vault-card--brand-microsoft', tokens: ['microsoft'] },
    { className: 'vault-card--brand-apple', tokens: ['apple'] },
    { className: 'vault-card--brand-meta', tokens: ['meta', 'facebook'] },
    { className: 'vault-card--brand-tesco', tokens: ['tesco'] },
    { className: 'vault-card--brand-sainsbury', tokens: ["sainsbury", "sainsbury's"] },
    { className: 'vault-card--brand-shell', tokens: ['shell'] },
    { className: 'vault-card--brand-bp', tokens: ['^bp$', 'bp plc', 'british petroleum'] },
  ];

  function normaliseBrandName(name) {
    return String(name || '').toLowerCase();
  }

  function findBrandTheme(name) {
    if (!name) return null;
    const target = normaliseBrandName(name);
    return BRAND_THEMES.find((theme) =>
      theme.tokens.some((tokenRaw) => {
        const token = normaliseBrandName(tokenRaw);
        if (!token) return false;
        if (token.startsWith('^') && token.endsWith('$')) {
          return target === token.slice(1, -1);
        }
        return target.includes(token);
      })
    );
  }

  function hashNameToHue(name) {
    const input = normaliseBrandName(name);
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 360;
  }

  function applyEntityBranding(card, name) {
    if (!card) return;
    card.className = 'vault-card';
    card.style.removeProperty('--card-brand-hue');
    const theme = findBrandTheme(name);
    if (theme) {
      card.classList.add('vault-card--brand', theme.className);
      return;
    }
    if (name) {
      card.classList.add('vault-card--brand', 'vault-card--brand-generic');
      card.style.setProperty('--card-brand-hue', `${hashNameToHue(name)}`);
    }
  }

  const state = {
    sessions: new Map(),
    files: new Map(),
    timers: { uploads: null, tiles: null, lists: null },
    placeholders: new Map(),
    collections: [],
    selectedCollectionId: null,
    viewer: { type: null, context: null, files: [], selectedFileId: null },
  };

  const processingPollers = new Map();

  let unauthorised = false;
  let viewerPreviewUrl = null;
  let viewerPreviewToken = 0;
  let jsonTestEnabled = false;
  let jsonModal = null;
  let jsonModalTitle = null;
  let jsonModalMeta = null;
  let jsonModalContent = null;
  let jsonModalClose = null;
  let jsonModalReturnFocus = null;
  let jsonModalStylesInjected = false;
  let manualEditorModal = null;
  let manualEditorDialog = null;
  let manualEditorTitle = null;
  let manualEditorSubtitle = null;
  let manualEditorMessage = null;
  let manualEditorError = null;
  let manualEditorLoading = null;
  let manualEditorForm = null;
  let manualEditorSections = null;
  let manualEditorSave = null;
  let manualEditorCancel = null;
  let manualEditorMeta = null;
  let manualEditorMetaDoc = null;
  let manualEditorMetaSchema = null;
  let manualEditorMetaStatus = null;
  let manualEditorMetaStatusContainer = null;
  let manualEditorReturnFocus = null;
  let manualEditorDocId = null;
  let manualEditorFile = null;
  let manualEditorRequired = null;
  let manualEditorStylesInjected = false;
  let manualEditorSchemaKey = null;
  let manualEditorFormData = null;

  const MANUAL_EDITOR_SCHEMAS = {
    bank_statement: {
      title: 'Bank statement data',
      sections: [
        {
          id: 'institution',
          type: 'group',
          title: 'Institution',
          description: 'Information about the banking institution.',
          fields: [
            { path: 'institution.name', label: 'Institution name', type: 'text', required: true },
            { path: 'institution.address', label: 'Branch address', type: 'text' },
            { path: 'institution.swiftBic', label: 'SWIFT/BIC', type: 'text' },
            { path: 'institution.contactInfo.telephone', label: 'Telephone', type: 'text' },
            { path: 'institution.contactInfo.website', label: 'Website', type: 'text' },
          ],
        },
        {
          id: 'account',
          type: 'group',
          title: 'Account',
          description: 'Details of the account featured on the statement.',
          fields: [
            { path: 'account.holderName', label: 'Account holder', type: 'text', required: true },
            { path: 'account.holderAddress.street', label: 'Holder street', type: 'text' },
            { path: 'account.holderAddress.city', label: 'Holder city', type: 'text' },
            { path: 'account.holderAddress.postalCode', label: 'Holder postal code', type: 'text' },
            { path: 'account.accountNumber', label: 'Account number', type: 'text', required: true },
            { path: 'account.sortCode', label: 'Sort code', type: 'text' },
            { path: 'account.iban', label: 'IBAN', type: 'text' },
            {
              path: 'account.type',
              label: 'Account type',
              type: 'select',
              options: [
                { value: '', label: 'Select type' },
                { value: 'current', label: 'Current' },
                { value: 'checking', label: 'Checking' },
                { value: 'savings', label: 'Savings' },
                { value: 'credit_card', label: 'Credit card' },
                { value: 'investment', label: 'Investment' },
                { value: 'brokerage', label: 'Brokerage' },
                { value: 'e_money', label: 'E-money' },
                { value: 'other', label: 'Other' },
              ],
            },
            { path: 'account.currency', label: 'Currency', type: 'text', required: true },
          ],
        },
        {
          id: 'statement',
          type: 'group',
          title: 'Statement period',
          description: 'Dates and identifiers for the statement.',
          fields: [
            { path: 'statement.statementNumber', label: 'Statement number', type: 'text' },
            { path: 'statement.period.startDate', label: 'Period start', type: 'date', required: true },
            { path: 'statement.period.endDate', label: 'Period end', type: 'date', required: true },
            { path: 'statement.period.Date', label: 'Statement month', type: 'month', placeholder: 'MM/YYYY' },
          ],
        },
        {
          id: 'balances',
          type: 'group',
          title: 'Balances',
          description: 'Key balances and totals for the statement period.',
          fields: [
            { path: 'balances.openingBalance', label: 'Opening balance', type: 'number', format: 'currency', required: true },
            { path: 'balances.closingBalance', label: 'Closing balance', type: 'number', format: 'currency', required: true },
            { path: 'balances.totalMoneyIn', label: 'Total money in', type: 'number', format: 'currency' },
            { path: 'balances.totalMoneyOut', label: 'Total money out', type: 'number', format: 'currency' },
            { path: 'balances.overdraftLimit', label: 'Overdraft limit', type: 'number', format: 'currency' },
            { path: 'balances.averageBalances.averageCreditBalance', label: 'Average credit balance', type: 'number', format: 'currency' },
            { path: 'balances.averageBalances.averageDebitBalance', label: 'Average debit balance', type: 'number', format: 'currency' },
          ],
        },
        {
          id: 'interest',
          type: 'group',
          title: 'Interest information',
          description: 'Rates and interest payments.',
          fields: [
            { path: 'interestInformation.creditInterestRate', label: 'Credit interest rate', type: 'text' },
            { path: 'interestInformation.overdraftInterestRate', label: 'Overdraft interest rate', type: 'text' },
            { path: 'interestInformation.interestPaid.date', label: 'Interest paid date', type: 'date' },
            { path: 'interestInformation.interestPaid.description', label: 'Interest paid description', type: 'text' },
            { path: 'interestInformation.interestPaid.amount', label: 'Interest paid amount', type: 'number', format: 'currency' },
          ],
        },
        {
          id: 'transactions',
          type: 'array',
          path: 'transactions',
          title: 'Transactions',
          description: 'List of transactions during the statement period.',
          addLabel: 'Add transaction',
          itemLabel: 'Transaction',
          fields: [
            { path: 'date', label: 'Date', type: 'date', required: true },
            { path: 'description', label: 'Description', type: 'text', required: true },
            { path: 'moneyIn', label: 'Money in', type: 'number', format: 'currency' },
            { path: 'moneyOut', label: 'Money out', type: 'number', format: 'currency' },
            { path: 'balance', label: 'Running balance', type: 'number', format: 'currency' },
            {
              path: 'transactionType',
              label: 'Transaction type',
              type: 'select',
              options: [
                { value: '', label: 'Select type' },
                { value: 'card_payment', label: 'Card payment' },
                { value: 'direct_debit', label: 'Direct debit' },
                { value: 'faster_payment', label: 'Faster payment' },
                { value: 'transfer', label: 'Transfer' },
                { value: 'credit', label: 'Credit' },
                { value: 'debit', label: 'Debit' },
                { value: 'other', label: 'Other' },
              ],
            },
            { path: 'paymentMethod', label: 'Payment method', type: 'text' },
            { path: 'counterparty', label: 'Counterparty', type: 'text' },
            { path: 'reference', label: 'Reference', type: 'text' },
          ],
        },
        {
          id: 'additional',
          type: 'group',
          title: 'Additional information',
          description: 'Optional supplementary details provided in the statement.',
          fields: [
            { path: 'additionalInformation.fscsInformation', label: 'FSCS information', type: 'textarea' },
            { path: 'additionalInformation.serviceQualitySurvey.region', label: 'Survey region', type: 'text' },
            { path: 'additionalInformation.serviceQualitySurvey.ranking', label: 'Survey ranking', type: 'text' },
            { path: 'additionalInformation.serviceQualitySurvey.score', label: 'Survey score', type: 'text' },
          ],
        },
        {
          id: 'news',
          type: 'array',
          path: 'additionalInformation.news',
          title: 'News items',
          description: 'Notices and news shared with the statement.',
          addLabel: 'Add news item',
          itemLabel: 'News item',
          fields: [
            { path: 'title', label: 'Title', type: 'text', required: true },
            { path: 'content', label: 'Content', type: 'textarea', required: true },
          ],
        },
      ],
    },
    payslip: {
      title: 'Payslip data',
      sections: [
        {
          id: 'employee',
          type: 'group',
          title: 'Employee details',
          fields: [
            { path: 'employee.fullName', label: 'Full name', type: 'text', required: true },
            { path: 'employee.employeeId', label: 'Employee ID', type: 'text' },
            { path: 'employee.niNumber', label: 'NI number', type: 'text' },
            { path: 'employee.taxCode', label: 'Tax code', type: 'text' },
            { path: 'employee.niCategory', label: 'NI category', type: 'text' },
            { path: 'employee.address.street', label: 'Street address', type: 'text' },
            { path: 'employee.address.city', label: 'City', type: 'text' },
            { path: 'employee.address.county', label: 'County', type: 'text' },
            { path: 'employee.address.postcode', label: 'Postcode', type: 'text' },
          ],
        },
        {
          id: 'employer',
          type: 'group',
          title: 'Employer details',
          fields: [
            { path: 'employer.name', label: 'Employer name', type: 'text', required: true },
            { path: 'employer.taxDistrict', label: 'Tax district', type: 'text' },
            { path: 'employer.taxReference', label: 'Tax reference', type: 'text' },
            { path: 'employer.employersNicThisPeriod', label: 'Employer NI this period', type: 'number', format: 'currency' },
            { path: 'employer.employersNicYtd', label: 'Employer NI YTD', type: 'number', format: 'currency' },
            { path: 'employer.employersPensionThisPeriod', label: 'Employer pension this period', type: 'number', format: 'currency' },
            { path: 'employer.employersPensionYtd', label: 'Employer pension YTD', type: 'number', format: 'currency' },
          ],
        },
        {
          id: 'period',
          type: 'group',
          title: 'Pay period',
          fields: [
            { path: 'period.Date', label: 'Pay month', type: 'month', required: true, placeholder: 'MM/YYYY' },
            { path: 'period.start', label: 'Period start', type: 'date' },
            { path: 'period.end', label: 'Period end', type: 'date' },
            {
              path: 'period.payFrequency',
              label: 'Pay frequency',
              type: 'select',
              options: [
                { value: '', label: 'Select frequency' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'biweekly', label: 'Bi-weekly' },
                { value: 'fourweekly', label: 'Four-weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'other', label: 'Other' },
              ],
            },
          ],
        },
        {
          id: 'currency',
          type: 'group',
          title: 'Currency',
          fields: [{ path: 'currency', label: 'Currency', type: 'text', required: true }],
        },
        {
          id: 'earnings',
          type: 'array',
          path: 'earnings',
          title: 'Earnings',
          description: 'Itemised earnings for the period.',
          addLabel: 'Add earning',
          itemLabel: 'Earning',
          fields: [
            { path: 'rawLabel', label: 'Label', type: 'text', required: true },
            {
              path: 'category',
              label: 'Category',
              type: 'select',
              options: [
                { value: '', label: 'Select category' },
                { value: 'base_salary', label: 'Base salary' },
                { value: 'overtime', label: 'Overtime' },
                { value: 'holiday_pay', label: 'Holiday pay' },
                { value: 'sick_pay', label: 'Sick pay' },
                { value: 'bonus', label: 'Bonus' },
                { value: 'commission', label: 'Commission' },
                { value: 'mbo', label: 'MBO' },
                { value: 'allowance', label: 'Allowance' },
                { value: 'shift_allowance', label: 'Shift allowance' },
                { value: 'backpay', label: 'Back pay' },
                { value: 'expenses_reimbursed', label: 'Expenses reimbursed' },
                { value: 'other', label: 'Other' },
              ],
            },
            { path: 'amountPeriod', label: 'Amount this period', type: 'number', format: 'currency', required: true },
            { path: 'amountYtd', label: 'Amount YTD', type: 'number', format: 'currency' },
          ],
        },
        {
          id: 'deductions',
          type: 'array',
          path: 'deductions',
          title: 'Deductions',
          description: 'Deductions applied to this payslip.',
          addLabel: 'Add deduction',
          itemLabel: 'Deduction',
          fields: [
            { path: 'rawLabel', label: 'Label', type: 'text', required: true },
            {
              path: 'category',
              label: 'Category',
              type: 'select',
              options: [
                { value: '', label: 'Select category' },
                { value: 'income_tax', label: 'Income tax' },
                { value: 'national_insurance', label: 'National insurance' },
                { value: 'student_loan', label: 'Student loan' },
                { value: 'pension_employee', label: 'Pension (employee)' },
                { value: 'pension_employer', label: 'Pension (employer)' },
                { value: 'attachment_of_earnings', label: 'Attachment of earnings' },
                { value: 'benefits_in_kind', label: 'Benefits in kind' },
                { value: 'union_dues', label: 'Union dues' },
                { value: 'cycle_to_work', label: 'Cycle to work' },
                { value: 'childcare_vouchers', label: 'Childcare vouchers' },
                { value: 'other', label: 'Other' },
              ],
            },
            { path: 'amountPeriod', label: 'Amount this period', type: 'number', format: 'currency', required: true },
            { path: 'amountYtd', label: 'Amount YTD', type: 'number', format: 'currency' },
          ],
        },
        {
          id: 'totals',
          type: 'group',
          title: 'Totals',
          fields: [
            { path: 'totals.grossPeriod', label: 'Gross pay this period', type: 'number', format: 'currency', required: true },
            { path: 'totals.netPeriod', label: 'Net pay this period', type: 'number', format: 'currency', required: true },
            { path: 'totals.grossYtd', label: 'Gross pay YTD', type: 'number', format: 'currency' },
            { path: 'totals.netYtd', label: 'Net pay YTD', type: 'number', format: 'currency' },
          ],
        },
        {
          id: 'meta',
          type: 'group',
          title: 'Metadata',
          fields: [
            { path: 'meta.documentId', label: 'Document ID', type: 'text' },
            { path: 'meta.confidence', label: 'Confidence score', type: 'number', format: 'decimal' },
          ],
        },
      ],
    },
  };

  let trimModal = null;
  let trimModalDialog = null;
  let trimModalTitle = null;
  let trimModalMeta = null;
  let trimModalList = null;
  let trimModalLoading = null;
  let trimModalError = null;
  let trimModalForm = null;
  let trimModalApply = null;
  let trimModalCancel = null;
  let trimModalClose = null;
  let trimModalReturnFocus = null;
  let trimModalStylesInjected = false;

  const trimReviewState = {
    docId: null,
    file: null,
    pageCount: 0,
    keptPages: new Set(),
    isLoading: false,
    isSubmitting: false,
  };

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const sessionRows = document.getElementById('session-rows');
  const sessionEmpty = document.getElementById('session-empty');
  const sessionActions = document.getElementById('session-actions');
  const sessionClearBtn = document.getElementById('session-clear');
  const sessionReminder = document.getElementById('session-reminder');
  const tilesGrid = document.getElementById('tiles-grid');
  const payslipGrid = document.getElementById('payslip-grid');
  const statementGrid = document.getElementById('statement-grid');
  const collectionGrid = document.getElementById('collection-grid');
  const payslipMeta = document.getElementById('payslip-meta');
  const statementMeta = document.getElementById('statement-meta');
  const collectionMeta = document.getElementById('collection-meta');
  const progressContainer = document.getElementById('vault-progress');
  const progressPhase = document.getElementById('vault-progress-phase');
  const progressCount = document.getElementById('vault-progress-count');
  const progressBar = document.getElementById('vault-progress-bar');
  const collectionTarget = document.getElementById('collection-target');
  const viewerRoot = document.getElementById('file-viewer');
  const viewerOverlay = document.getElementById('file-viewer-overlay');
  const viewerList = document.getElementById('file-viewer-list');
  const viewerFrame = document.getElementById('file-viewer-frame');
  const viewerEmpty = document.getElementById('file-viewer-empty');
  const viewerTitle = document.getElementById('file-viewer-title');
  const viewerSubtitle = document.getElementById('file-viewer-subtitle');
  const viewerClose = document.getElementById('file-viewer-close');

  function formatDate(value) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString();
  }

  function toDateLike(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function toNumberLike(value) {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9.-]+/g, '');
      if (!cleaned) return null;
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function formatMoney(value, currency) {
    if (value == null || value === '') return '—';
    const number = toNumberLike(value);
    if (number == null) {
      return typeof value === 'string' && value.trim() ? value : '—';
    }
    const code = typeof currency === 'string' && currency.trim().length === 3 ? currency.trim().toUpperCase() : 'GBP';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(number);
    } catch (error) {
      console.warn('formatMoney fallback', error);
      return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }

  function formatNumber(value) {
    const number = toNumberLike(value);
    if (number == null) return value == null ? '—' : String(value);
    return number.toLocaleString();
  }

  function normalisePageCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.max(1, Math.round(number));
  }

  function pickFirstNumber(values) {
    if (!Array.isArray(values)) return null;
    for (const value of values) {
      const number = normalisePageCount(value);
      if (number != null) return number;
    }
    return null;
  }

  function normalisePageNumbers(value) {
    const pages = [];

    const addPage = (page) => {
      const number = Number(page);
      if (!Number.isFinite(number)) return;
      const rounded = Math.round(number);
      if (rounded >= 1) {
        pages.push(rounded);
      }
    };

    const addRange = (start, end) => {
      const startNumber = Number(start);
      const endNumber = Number(end);
      if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber)) return;
      const startRounded = Math.round(startNumber);
      const endRounded = Math.round(endNumber);
      if (startRounded === endRounded) {
        addPage(startRounded);
        return;
      }
      const step = startRounded < endRounded ? 1 : -1;
      for (let current = startRounded; step > 0 ? current <= endRounded : current >= endRounded; current += step) {
        addPage(current);
      }
    };

    const parseToken = (token) => {
      const trimmed = String(token || '').trim();
      if (!trimmed) return;
      const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        addRange(Number(rangeMatch[1]), Number(rangeMatch[2]));
        return;
      }
      addPage(trimmed);
    };

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (Array.isArray(entry)) {
          entry.forEach(parseToken);
          return;
        }
        if (entry && typeof entry === 'object') {
          if ('start' in entry && 'end' in entry) {
            addRange(entry.start, entry.end);
            return;
          }
          if ('page' in entry) {
            addPage(entry.page);
            return;
          }
        }
        parseToken(entry);
      });
    } else if (value && typeof value === 'object') {
      if ('start' in value && 'end' in value) {
        addRange(value.start, value.end);
      } else if ('page' in value) {
        addPage(value.page);
      } else if (Symbol.iterator in value) {
        Array.from(value).forEach(parseToken);
      }
    } else if (typeof value === 'string') {
      value.split(/[\s,]+/).forEach(parseToken);
    } else {
      parseToken(value);
    }

    const unique = Array.from(new Set(pages)).filter((page) => page >= 1);
    unique.sort((a, b) => a - b);
    return unique;
  }

  function ensureObject(value) {
    return value && typeof value === 'object' ? value : {};
  }

  function ensureFileMeta(file) {
    if (!file) return {};
    const raw = ensureObject(file.raw);
    file.raw = raw;
    const meta = ensureObject(raw.meta);
    raw.meta = meta;
    return meta;
  }

  function normaliseStatus(value, fallback = 'queued') {
    if (!value && value !== 0) return fallback;
    if (typeof value === 'object' && value !== null) {
      const statusValue = value.status || value.state || value.phase;
      if (statusValue) return normaliseStatus(statusValue, fallback);
    }
    const input = String(value || '').trim().toLowerCase();
    if (!input) return fallback;
    if (STATUS_LABELS[input]) return input;
    if (LEGACY_STATUS_MAP[input]) return LEGACY_STATUS_MAP[input];
    return fallback;
  }

  function normaliseProcessingState(value, fallback = 'queued') {
    const info = ensureObject(typeof value === 'object' ? value : {});
    info.status = normaliseStatus(value && typeof value === 'object' ? value.status || value.state || value : value, fallback);
    return info;
  }

  function createStatusIndicator(label, stateValue) {
    const info = normaliseProcessingState(stateValue, 'queued');
    const statusValue = info.status || 'queued';
    const indicator = document.createElement('span');
    indicator.className = 'status-indicator';
    indicator.dataset.state = statusValue;
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('tabindex', '0');
    const labelText = `${label}: ${STATUS_LABELS[statusValue] || STATUS_LABELS.queued}`;
    indicator.setAttribute('aria-label', labelText);
    indicator.title = labelText;

    let icon;
    if (statusValue === 'processing') {
      icon = document.createElement('span');
      icon.className = 'spinner-border spinner-border-sm';
      icon.setAttribute('role', 'presentation');
      icon.setAttribute('aria-hidden', 'true');
    } else {
      icon = document.createElement('i');
      const iconClass = STATUS_ICONS[statusValue] || STATUS_ICONS.queued;
      icon.className = `bi ${iconClass}`;
      icon.setAttribute('aria-hidden', 'true');
    }

    const text = document.createElement('span');
    text.className = 'status-indicator__label';
    text.textContent = STATUS_LABELS[statusValue] || STATUS_LABELS.queued;

    indicator.append(icon, text);
    return indicator;
  }

  function resolveDocId(input) {
    if (!input) return null;
    const source = input.raw && typeof input.raw === 'object' ? input.raw : input;
    const candidates = [
      input.docId,
      input.documentId,
      input.id,
      source?.docId,
      source?.documentId,
      source?.id,
      source?.fileId,
      source?.storage?.fileId,
      source?.processing?.docId,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  }

  function resolveDocClass(input) {
    if (!input) return null;
    const source = input.raw && typeof input.raw === 'object' ? input.raw : input;
    const candidates = [
      source?.meta?.docClass,
      source?.meta?.doc_class,
      source?.docClass,
      source?.doc_class,
      source?.classification?.docClass,
      source?.classification?.doc_class,
      source?.docType,
      source?.documentType,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().toLowerCase();
      }
    }
    return null;
  }

  function docHasWarning(input) {
    const source = input && input.raw && typeof input.raw === 'object' ? input.raw : input;
    if (!source) return false;
    if (source.ui && source.ui.warning) return true;
    const meta = ensureObject(source.meta);
    const trimRequired = meta.trim_required;
    const reviewState = String(meta.trim_review_state || '').trim().toLowerCase();
    if (trimRequired === false || reviewState === 'completed') return false;
    if (trimRequired === true) return true;
    if (reviewState === 'pending' || reviewState === 'required') return true;
    const pageCount = pickFirstNumber([
      meta.page_count_original,
      meta.pageCountOriginal,
      meta.originalPageCount,
      meta.original_page_count,
      meta.page_count,
      meta.pageCount,
      meta.total_pages,
      meta.totalPages,
    ]);
    return pageCount != null && pageCount > 5;
  }

  function getViewerFiles() {
    return Array.isArray(state.viewer.files) ? state.viewer.files : [];
  }

  function findViewerFileByDocId(docId) {
    if (!docId) return null;
    const normalised = String(docId).trim();
    if (!normalised) return null;
    return getViewerFiles().find((file) => resolveDocId(file) === normalised) || null;
  }

  function applyProcessingUpdate(target, updates = {}) {
    const file = typeof target === 'string' ? findViewerFileByDocId(target) : target;
    if (!file) return null;
    const raw = ensureObject(file.raw);
    file.raw = raw;
    const processing = normaliseProcessingState(raw.processing || file.processingInfo || {}, 'queued');
    if (updates.processing && typeof updates.processing === 'object') {
      Object.assign(processing, updates.processing);
    }
    if (updates.status) {
      processing.status = normaliseStatus(updates.status, processing.status || 'queued');
    }
    processing.status = normaliseStatus(processing.status, 'queued');
    raw.processing = processing;
    file.processingInfo = processing;
    file.processingStatus = processing.status;
    file.processing = processing.status;
    if (updates.meta && typeof updates.meta === 'object') {
      raw.meta = { ...ensureObject(raw.meta), ...updates.meta };
    }
    if (updates.result && typeof updates.result === 'object') {
      raw.result = { ...ensureObject(raw.result), ...updates.result };
    }
    if (updates.ui && typeof updates.ui === 'object') {
      raw.ui = { ...ensureObject(raw.ui), ...updates.ui };
    }
    return file;
  }

  function appendUiMessage(file, message) {
    if (!file || !message) return;
    const raw = ensureObject(file.raw);
    const ui = ensureObject(raw.ui);
    const messages = Array.isArray(ui.messages) ? ui.messages.slice() : [];
    if (!messages.includes(message)) {
      messages.push(message);
      ui.messages = messages;
      raw.ui = ui;
    }
  }

  function clearTrimWarning(file) {
    if (!file) return;
    const raw = ensureObject(file.raw);
    const ui = ensureObject(raw.ui);
    if (Array.isArray(ui.messages)) {
      ui.messages = ui.messages.filter((message) => message !== TRIM_AUTOTRIM_MESSAGE);
    }
    ui.warning = false;
    raw.ui = ui;
  }

  function withButtonSpinner(button, label) {
    if (!button) return () => {};
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${label}`;
    return () => {
      button.innerHTML = original;
      button.disabled = false;
    };
  }

  async function requestAutoTrim(file, docId) {
    if (!docId) {
      throw new Error('Document identifier unavailable for trimming.');
    }
    const response = await apiFetch('/autotrim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || 'Auto-trim failed');
    }
    const trim = ensureObject(payload.trim);
    const trimRequired = Boolean(payload.trimRequired);
    const raw = ensureObject(file.raw);
    file.raw = raw;
    applyProcessingUpdate(file, {
      status: trimRequired ? 'idle' : 'queued',
      processing: { provider: 'docupipe' },
      meta: {
        page_count_original: trim.originalPageCount ?? trim.page_count_original ?? raw.meta?.page_count_original,
        pages_kept: trim.keptPages ?? trim.pages_kept ?? raw.meta?.pages_kept,
        trim_required: trimRequired,
        trim_review_state: trimRequired ? 'pending' : 'skipped',
      },
      ui: { warning: trimRequired },
    });
    if (trimRequired) {
      appendUiMessage(file, TRIM_AUTOTRIM_MESSAGE);
    }
    return { trim, trimRequired };
  }

  function stopProcessingPoll(docId) {
    if (!docId) return;
    const timer = processingPollers.get(docId);
    if (timer) {
      clearTimeout(timer);
      processingPollers.delete(docId);
    }
  }

  function stopAllProcessingPolls() {
    processingPollers.forEach((timer) => clearTimeout(timer));
    processingPollers.clear();
  }

  function scheduleProcessingPoll(docId) {
    stopProcessingPoll(docId);
    const timer = setTimeout(() => {
      pollProcessingStatus(docId).catch((error) => console.warn('Processing poll error', error));
    }, PROCESS_POLL_INTERVAL);
    processingPollers.set(docId, timer);
  }

  async function pollProcessingStatus(docId) {
    if (!docId) return;
    stopProcessingPoll(docId);
    const file = findViewerFileByDocId(docId);
    if (!file) return;
    try {
      const response = await apiFetch(`/status?docId=${encodeURIComponent(docId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || response.statusText || 'Status check failed');
      }
      if (payload?.state === 'completed') {
        applyProcessingUpdate(file, { status: 'completed' });
        renderViewerFiles();
        return;
      }
      if (payload?.state === 'failed' || payload?.ok === false) {
        const errorMessage = payload?.error || 'Processing failed';
        applyProcessingUpdate(file, {
          status: 'failed',
          processing: { error: errorMessage },
        });
        appendUiMessage(file, errorMessage);
        renderViewerFiles();
        return;
      }
      scheduleProcessingPoll(docId);
    } catch (error) {
      console.warn('Processing status poll failed', error);
      appendUiMessage(file, error?.message || 'Processing status check failed');
      renderViewerFiles();
    }
  }

  function startProcessingPoll(docId) {
    if (!docId) return;
    pollProcessingStatus(docId).catch((error) => console.warn('Initial processing poll failed', error));
  }

  function pickMetric(metrics, keys) {
    if (!metrics) return null;
    for (const key of keys) {
      if (metrics[key] != null) return metrics[key];
    }
    return null;
  }

  function normaliseStatementName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return 'Institution';
    return trimmed.replace(/^statement\s+/i, '').trim() || trimmed;
  }

  function pickFirstLabel(candidates, fallback = '') {
    for (const candidate of candidates) {
      if (candidate == null) continue;
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
        continue;
      }
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return String(candidate);
      }
    }
    return fallback;
  }

  function normaliseEmployerName(source) {
    if (!source) return 'Employer';
    if (typeof source === 'string') {
      const trimmed = source.trim();
      return trimmed || 'Employer';
    }
    const name = pickFirstLabel([
      source.name,
      source.employerName,
      source.employer?.name,
      source.employer?.legalName,
      source.employer?.displayName,
      source.companyName,
      source.company,
      source.organisation,
      source.orgName,
      source.label,
    ]);
    return name || 'Employer';
  }

  function normaliseInstitutionDisplayName(source) {
    if (!source) return 'Institution';
    if (typeof source === 'string') {
      return normaliseStatementName(source);
    }
    const name = pickFirstLabel([
      source.institution?.name,
      source.institution?.displayName,
      source.institution?.legalName,
      source.institutionName,
      source.name,
      source.label,
    ]);
    return normaliseStatementName(name || '');
  }

  function normaliseCount(value) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return number;
    }
    return null;
  }

  function formatCountLabel(count, singular, plural = `${singular}s`) {
    const normalised = normaliseCount(count);
    if (normalised == null) return null;
    const label = normalised === 1 ? singular : plural;
    return `${formatNumber(normalised)} ${label}`;
  }

  function createMetaRow(label, value) {
    const row = document.createElement('div');
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.textContent = value == null || value === '' ? '—' : String(value);
    row.append(labelEl, valueEl);
    return row;
  }

  function normalisePayslipViewerFiles(files, { employerName = '', includeEmployerInSummary = false } = {}) {
    const employerLabel = employerName || '';
    const normalised = Array.isArray(files) ? files : [];
    const mapped = normalised.map((file) => {
      const metrics = file?.metrics || {};
      const currency = metrics.currency || metrics.currencyCode || 'GBP';
      const payDateValue = metrics.payDate || file.documentDate || file.documentMonth;
      const sortDate = toDateLike(payDateValue);
      const totalEarnings = pickMetric(metrics, ['totalEarnings', 'gross', 'grossPay']);
      const totalDeductions = pickMetric(metrics, ['totalDeductions', 'totalDeductibles', 'deductionsTotal']);
      const netPay = pickMetric(metrics, ['net', 'netPay', 'takeHome']);
      const details = [];
      const periodStart = metrics.periodStart || metrics.period?.start || metrics.periodStartDate || metrics.period?.from;
      const periodEnd = metrics.periodEnd || metrics.period?.end || metrics.periodEndDate || metrics.period?.to;
      if (periodStart) details.push({ label: 'Period start', value: formatDate(periodStart) });
      if (periodEnd) details.push({ label: 'Period end', value: formatDate(periodEnd) });
      if (metrics.payFrequency) details.push({ label: 'Pay frequency', value: metrics.payFrequency });
      if (metrics.taxCode) details.push({ label: 'Tax code', value: metrics.taxCode });
      if (metrics.tax != null) details.push({ label: 'Income tax', value: formatMoney(metrics.tax, currency) });
      if (metrics.ni != null) details.push({ label: 'National Insurance', value: formatMoney(metrics.ni, currency) });
      if (metrics.pension != null) details.push({ label: 'Pension', value: formatMoney(metrics.pension, currency) });
      if (metrics.studentLoan != null) details.push({ label: 'Student loan', value: formatMoney(metrics.studentLoan, currency) });

      const subtitleParts = [];
      if (includeEmployerInSummary && employerLabel) subtitleParts.push(employerLabel);
      if (metrics.payFrequency) subtitleParts.push(`${metrics.payFrequency} payslip`);

      const summary = [
        { label: 'Date of payslip', value: formatDate(payDateValue) },
        { label: 'Total earnings', value: formatMoney(totalEarnings, currency) },
        { label: 'Total deductibles', value: formatMoney(totalDeductions, currency) },
        { label: 'Net pay', value: formatMoney(netPay, currency) },
      ];
      if (includeEmployerInSummary) {
        summary.unshift({ label: 'Employer', value: employerLabel || file?.metadata?.employerName || '—' });
      }

      const viewerFile = {
        fileId: file.fileId,
        title: formatDate(payDateValue) || 'Payslip',
        subtitle: subtitleParts.join(' · ') || (metrics.payFrequency ? `${metrics.payFrequency} payslip` : 'Payslip'),
        summary,
        details,
        metrics,
        raw: file,
        currency,
        isExpanded: false,
      };
      viewerFile._sortValue = sortDate ? sortDate.getTime() : 0;
      return viewerFile;
    });

    return mapped
      .sort((a, b) => (b._sortValue || 0) - (a._sortValue || 0))
      .map((file) => {
        delete file._sortValue;
        return file;
      });
  }

  function normaliseStatementViewerFiles(accounts, { institutionName = '', includeInstitutionInSummary = false } = {}) {
    const list = Array.isArray(accounts) ? accounts : [];
    const files = [];
    const institutionLabel = normaliseStatementName(institutionName || '');

    list.forEach((account) => {
      const accountName = account?.displayName || institutionLabel;
      const maskedNumber = account?.accountNumberMasked || null;
      const accountType = account?.accountType || null;
      const accountFiles = Array.isArray(account?.files) ? account.files : [];

      accountFiles.forEach((file) => {
        const metrics = file?.metrics || {};
        const currency = metrics.currency || metrics.currencyCode || 'GBP';
        const totalIn = pickMetric(metrics, ['totalIn', 'totalCredit', 'totalCredits', 'sumCredits', 'creditsTotal']);
        const totalOut = pickMetric(metrics, ['totalOut', 'totalDebit', 'totalDebits', 'sumDebits', 'debitsTotal']);
        const periodStart = metrics.periodStart || metrics.period?.start || metrics.period?.from || metrics.statementPeriod?.start;
        const periodEnd = metrics.periodEnd || metrics.period?.end || metrics.period?.to || metrics.statementPeriod?.end;
        const openingBalance = pickMetric(metrics, ['openingBalance', 'startingBalance']);
        const closingBalance = pickMetric(metrics, ['closingBalance', 'endingBalance']);
        const summary = [
          { label: 'Account number', value: file.accountNumberMasked || maskedNumber || '—' },
          { label: 'Total in', value: formatMoney(totalIn, currency) },
          { label: 'Total out', value: formatMoney(totalOut, currency) },
        ];
        if (includeInstitutionInSummary) {
          summary.unshift({ label: 'Institution', value: institutionLabel || '—' });
        }

        const details = [];
        if (periodStart) details.push({ label: 'Period start', value: formatDate(periodStart) });
        if (periodEnd) details.push({ label: 'Period end', value: formatDate(periodEnd) });
        if (openingBalance != null) details.push({ label: 'Opening balance', value: formatMoney(openingBalance, currency) });
        if (closingBalance != null) details.push({ label: 'Closing balance', value: formatMoney(closingBalance, currency) });
        if (metrics.currency) details.push({ label: 'Currency', value: metrics.currency });
        if (accountType) details.push({ label: 'Account type', value: accountType });

        const subtitleParts = [];
        if (includeInstitutionInSummary && institutionLabel) {
          subtitleParts.push(institutionLabel);
        }
        if (periodEnd) {
          subtitleParts.push(`Statement ending ${formatDate(periodEnd)}`);
        } else if (file.documentDate) {
          subtitleParts.push(`Statement ${formatDate(file.documentDate)}`);
        } else if (file.documentMonth) {
          subtitleParts.push(`Statement ${formatDate(file.documentMonth)}`);
        }

        const viewerFile = {
          fileId: file.fileId,
          title: accountName || 'Statement',
          subtitle: subtitleParts.join(' · ') || institutionLabel || 'Statement',
          summary,
          details,
          metrics,
          raw: file,
          currency,
          isExpanded: false,
        };
        const sortDate = toDateLike(periodEnd || file.documentDate || file.documentMonth);
        viewerFile._sortValue = sortDate ? sortDate.getTime() : 0;
        files.push(viewerFile);
      });
    });

    return files
      .sort((a, b) => (b._sortValue || 0) - (a._sortValue || 0))
      .map((file) => {
        delete file._sortValue;
        return file;
      });
  }

  function getSelectedCollection() {
    if (!state.selectedCollectionId) return null;
    return state.collections.find((col) => col.id === state.selectedCollectionId) || null;
  }

  function updateCollectionTargetHint() {
    if (!collectionTarget) return;
    const label = collectionTarget.querySelector('strong');
    const selected = getSelectedCollection();
    if (selected) {
      collectionTarget.hidden = false;
      if (label) label.textContent = selected.name || 'Collection';
    } else {
      collectionTarget.hidden = true;
    }
  }

  function authFetch(path, options) {
    if (window.Auth && typeof Auth.fetch === 'function') {
      return Auth.fetch(path, options);
    }
    return fetch(path, options);
  }

  function setProgress({ phase, completed, total, countLabel }) {
    if (!(progressContainer && progressPhase && progressCount && progressBar)) return;
    progressContainer.hidden = false;
    progressContainer.setAttribute('aria-hidden', 'false');
    progressPhase.textContent = phase;
    const safeTotal = Math.max(0, total || 0);
    let safeCompleted = Math.max(0, completed || 0);
    if (safeTotal) {
      safeCompleted = Math.min(safeCompleted, safeTotal);
    }
    progressBar.setAttribute('aria-label', phase);
    if (countLabel != null) {
      progressCount.textContent = countLabel;
    } else {
      progressCount.textContent = safeTotal ? `${safeCompleted}/${safeTotal} complete` : '';
    }
    const pct = safeTotal ? Math.round((safeCompleted / safeTotal) * 100) : safeCompleted ? 100 : 0;
    progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    progressBar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, pct))));
  }

  function hideProgress() {
    if (!(progressContainer && progressBar)) return;
    progressContainer.hidden = true;
    progressContainer.setAttribute('aria-hidden', 'true');
    progressBar.style.width = '0%';
    progressBar.setAttribute('aria-valuenow', '0');
  }

  function updateProgressUI() {
    if (!(progressContainer && progressPhase && progressCount && progressBar)) return;
    const placeholders = Array.from(state.placeholders.values());
    if (placeholders.length) {
      const total = placeholders.reduce((sum, item) => sum + (item.total || 1), 0);
      const completed = placeholders.reduce((sum, item) => sum + (item.completed || 0), 0);
      const hasZip = placeholders.some((item) => item.phase === 'Extracting zip');
      const phaseLabel = hasZip ? 'Extracting zip' : 'Uploading files';
      const countLabel = total ? `${completed}/${total} complete` : 'Preparing…';
      const phaseWithCount = total ? `${phaseLabel} (${completed}/${total})` : phaseLabel;
      setProgress({ phase: phaseWithCount, completed, total, countLabel });
      return;
    }

    const totalFiles = state.files.size;
    if (!totalFiles) {
      hideProgress();
      return;
    }

    const records = Array.from(state.files.values());
    const uploadCompleted = records.filter((file) => normaliseStatus(file.upload, 'completed') === 'completed').length;
    const processingCompleted = records.filter((file) => normaliseStatus(file.processing, 'queued') === 'completed').length;

    if (uploadCompleted < totalFiles) {
      const phase = `Uploading files (${uploadCompleted}/${totalFiles})`;
      setProgress({ phase, completed: uploadCompleted, total: totalFiles, countLabel: `${uploadCompleted}/${totalFiles} complete` });
      return;
    }

    if (processingCompleted < totalFiles) {
      const phase = `Extracting analytics (${processingCompleted}/${totalFiles})`;
      setProgress({ phase, completed: processingCompleted, total: totalFiles, countLabel: `${processingCompleted}/${totalFiles} complete` });
      return;
    }

    const phase = `All files processed (${totalFiles}/${totalFiles})`;
    setProgress({ phase, completed: totalFiles, total: totalFiles, countLabel: `${totalFiles}/${totalFiles} complete` });
  }

  function closeViewer() {
    if (!viewerRoot) return;
    viewerPreviewToken += 1;
    stopAllProcessingPolls();
    viewerRoot.setAttribute('aria-hidden', 'true');
    if (viewerFrame) {
      viewerFrame.src = 'about:blank';
    }
    if (viewerPreviewUrl) {
      URL.revokeObjectURL(viewerPreviewUrl);
      viewerPreviewUrl = null;
    }
    if (viewerEmpty) {
      viewerEmpty.style.display = '';
      viewerEmpty.textContent = 'Select a file to see the preview and actions.';
    }
    state.viewer = { type: null, context: null, files: [], selectedFileId: null };
  }

  function renderViewerSelection() {
    if (!viewerList) return;
    const cards = viewerList.querySelectorAll('.viewer__file');
    cards.forEach((card) => {
      const isSelected = card.dataset.fileId === state.viewer.selectedFileId;
      card.classList.toggle('is-selected', isSelected);
    });
  }

  async function previewViewerFile(fileId) {
    if (!viewerFrame || !fileId) return;
    const requestId = ++viewerPreviewToken;
    try {
      viewerFrame.src = 'about:blank';
      if (viewerEmpty) {
        viewerEmpty.style.display = 'none';
      }
      const response = await authFetch(`${API_BASE}/files/${encodeURIComponent(fileId)}/view`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to preview documents.');
        return;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || 'Preview failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (requestId !== viewerPreviewToken) {
        URL.revokeObjectURL(url);
        return;
      }
      if (viewerPreviewUrl) {
        URL.revokeObjectURL(viewerPreviewUrl);
      }
      viewerPreviewUrl = url;
      viewerFrame.src = url;
    } catch (error) {
      console.error('Failed to preview document', error);
      if (viewerEmpty) {
        viewerEmpty.style.display = '';
        viewerEmpty.textContent = 'Preview unavailable for this file.';
      }
      if (viewerFrame) {
        viewerFrame.src = 'about:blank';
      }
      window.alert(error.message || 'Unable to preview this document right now.');
    }
  }

  function selectViewerFile(fileId, { preview = false } = {}) {
    state.viewer.selectedFileId = fileId;
    renderViewerSelection();
    if (preview) {
      previewViewerFile(fileId);
    }
  }

  function injectJsonModalStyles() {
    if (jsonModalStylesInjected) return;
    jsonModalStylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .vault-json-editor { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; padding: clamp(24px, 5vw, 48px); background: rgba(12, 21, 32, 0.28); backdrop-filter: blur(18px); z-index: 1320; }
      .vault-json-editor.is-visible { display: flex; }
      .vault-json-editor__dialog { position: relative; width: min(1180px, 100%); max-height: min(92vh, 960px); background: var(--bg-surface, #ffffff); color: var(--fg, #0c1520); border-radius: 28px; box-shadow: 0 30px 80px rgba(12, 21, 32, 0.16); display: flex; flex-direction: column; overflow: hidden; }
      .vault-json-editor__header { display: flex; align-items: flex-start; justify-content: space-between; gap: clamp(18px, 3vw, 28px); padding: clamp(28px, 3vw, 36px); background: linear-gradient(135deg, color-mix(in srgb, var(--brand, #00c2a8) 78%, white 22%), color-mix(in srgb, var(--brand-hover, #00b39b) 72%, white 28%)); color: #ffffff; }
      .vault-json-editor__title-group { display: flex; flex-direction: column; gap: 8px; max-width: 540px; }
      .vault-json-editor__title { margin: 0; font-size: clamp(1.35rem, 2.4vw, 1.8rem); font-weight: 700; letter-spacing: -0.01em; }
      .vault-json-editor__subtitle { margin: 0; font-size: clamp(0.95rem, 1.4vw, 1.08rem); opacity: 0.92; line-height: 1.6; }
      .vault-json-editor__close { border: none; background: rgba(255, 255, 255, 0.18); color: inherit; width: 40px; height: 40px; border-radius: 50%; font-size: 1.6rem; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 160ms ease, transform 160ms ease, box-shadow 160ms ease; }
      .vault-json-editor__close:hover { background: rgba(255, 255, 255, 0.28); transform: translateY(-1px); box-shadow: 0 16px 32px rgba(12, 21, 32, 0.18); }
      .vault-json-editor__close:focus-visible { outline: 3px solid rgba(255, 255, 255, 0.65); outline-offset: 3px; }
      .vault-json-editor__body { flex: 1; display: flex; flex-direction: column; padding: clamp(24px, 3vw, 36px); background: linear-gradient(145deg, color-mix(in srgb, var(--bg-body, #f6faf9) 78%, transparent), transparent 52%); overflow: hidden; }
      .vault-json-editor__layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 320px 1fr; gap: clamp(20px, 3vw, 36px); }
      .vault-json-editor__aside { display: flex; flex-direction: column; gap: 24px; }
      .vault-json-editor__aside-card { background: var(--bg-surface, #ffffff); border-radius: 24px; border: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 80%, transparent); box-shadow: 0 24px 56px rgba(12, 21, 32, 0.12); padding: clamp(18px, 2vw, 26px); display: flex; flex-direction: column; gap: 14px; position: relative; overflow: hidden; }
      .vault-json-editor__aside-card--meta::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--brand, #00c2a8) 18%, transparent), transparent 68%); opacity: 0.55; pointer-events: none; }
      .vault-json-editor__aside-title { margin: 0; font-size: 0.82rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: color-mix(in srgb, var(--fg, #0c1520) 82%, var(--brand, #00c2a8) 18%); }
      .vault-json-editor__aside-description { margin: 0; font-size: 0.9rem; line-height: 1.6; color: var(--fg-2, #63727e); }
      .vault-json-editor__meta { display: flex; flex-direction: column; gap: 12px; }
      .vault-json-editor__meta[hidden] { display: none !important; }
      .vault-json-editor__meta-item { display: flex; flex-direction: column; gap: 6px; position: relative; padding: 14px 18px; border-radius: 18px; border: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 85%, transparent); background: color-mix(in srgb, var(--bg-body, #f6faf9) 94%, transparent); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6); }
      .vault-json-editor__meta-label { font-size: 0.74rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--fg-2, #63727e); }
      .vault-json-editor__meta-value { font-size: 0.98rem; font-weight: 600; color: var(--fg, #0c1520); word-break: break-word; }
      .vault-json-editor__meta-value--status { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 6px 14px; font-size: 0.85rem; font-weight: 600; color: var(--fg, #0c1520); background: color-mix(in srgb, var(--bg-body, #f6faf9) 92%, transparent); border: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 90%, transparent); transition: background 160ms ease, color 160ms ease, border-color 160ms ease; }
      .vault-json-editor__meta-value--status[data-state='warning'] { color: color-mix(in srgb, var(--warning, #ffa600) 80%, #7c4a00); background: color-mix(in srgb, var(--warning, #ffa600) 18%, white); border-color: color-mix(in srgb, var(--warning, #ffa600) 32%, transparent); }
      .vault-json-editor__meta-value--status[data-state='success'] { color: color-mix(in srgb, var(--success, #1db954) 88%, #0b5c33); background: color-mix(in srgb, var(--success, #1db954) 18%, white); border-color: color-mix(in srgb, var(--success, #1db954) 32%, transparent); }
      .vault-json-editor__main { background: var(--bg-surface, #ffffff); border-radius: 26px; border: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 85%, transparent); box-shadow: 0 26px 64px rgba(12, 21, 32, 0.14); padding: clamp(22px, 3vw, 32px); display: flex; flex-direction: column; gap: 24px; overflow: hidden; }
      .vault-json-editor__message,
      .vault-json-editor__error,
      .vault-json-editor__loading { margin: 0; border-radius: 20px; padding: 18px 20px 18px 56px; position: relative; font-size: 0.96rem; line-height: 1.55; box-shadow: 0 20px 48px rgba(12, 21, 32, 0.12); border: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 80%, transparent); background: color-mix(in srgb, var(--bg-surface, #ffffff) 98%, transparent); }
      .vault-json-editor__message[hidden],
      .vault-json-editor__error[hidden],
      .vault-json-editor__loading[hidden] { display: none !important; }
      .vault-json-editor__message::before,
      .vault-json-editor__error::before,
      .vault-json-editor__loading::before { content: ''; position: absolute; left: 22px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; background-repeat: no-repeat; background-size: contain; }
      .vault-json-editor__message { color: color-mix(in srgb, var(--brand, #00c2a8) 68%, #0c1520); background: color-mix(in srgb, var(--brand, #00c2a8) 14%, white); border-color: color-mix(in srgb, var(--brand, #00c2a8) 34%, transparent); }
      .vault-json-editor__message::before { background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="%2300b39b" viewBox="0 0 20 20"><path d="M10 18a8 8 0 118-8 8 8 0 01-8 8zm-.75-5.5a.75.75 0 001.5 0v-4a.75.75 0 00-1.5 0v4zm.75-7a1 1 0 100 2 1 1 0 000-2z"/></svg>'); }
      .vault-json-editor__error { color: color-mix(in srgb, var(--danger, #ff4d4d) 78%, #7a1a1a); background: color-mix(in srgb, var(--danger, #ff4d4d) 16%, white); border-color: color-mix(in srgb, var(--danger, #ff4d4d) 34%, transparent); }
      .vault-json-editor__error::before { background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="%23ff4d4d" viewBox="0 0 20 20"><path d="M10 2a8 8 0 108 8 8 8 0 00-8-8zm-.75 4.75a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4zm.75 7.5a1 1 0 110 2 1 1 0 010-2z"/></svg>'); }
      .vault-json-editor__loading { color: color-mix(in srgb, var(--brand, #00c2a8) 62%, #0c1520); background: color-mix(in srgb, var(--brand, #00c2a8) 10%, white); border-color: color-mix(in srgb, var(--brand, #00c2a8) 24%, transparent); }
      .vault-json-editor__loading::before { background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="%2300b39b" viewBox="0 0 20 20"><path d="M10 2a8 8 0 108 8h-2a6 6 0 11-6-6V2z"/></svg>'); }
      .vault-json-editor__form { display: flex; flex-direction: column; gap: 28px; min-height: 0; }
      .vault-json-editor__sections { display: flex; flex-direction: column; gap: 22px; overflow: auto; padding-right: 4px; }
      .manual-editor__empty { margin: 0; padding: 28px; border-radius: 22px; border: 2px dashed color-mix(in srgb, var(--bd-hairline, #e3eee9) 78%, transparent); background: color-mix(in srgb, var(--bg-body, #f6faf9) 94%, transparent); text-align: center; font-size: 0.96rem; color: var(--fg-2, #63727e); }
      .manual-editor__section { display: flex; flex-direction: column; gap: 18px; padding: clamp(20px, 2.6vw, 28px); border-radius: 22px; border: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 80%, transparent); background: var(--bg-surface, #ffffff); box-shadow: 0 24px 52px rgba(12, 21, 32, 0.1); position: relative; overflow: hidden; }
      .manual-editor__section::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, color-mix(in srgb, var(--brand, #00c2a8) 10%, transparent), transparent 70%); opacity: 0; transition: opacity 180ms ease; pointer-events: none; }
      .manual-editor__section:hover::before { opacity: 1; }
      .manual-editor__section-header { position: relative; display: flex; flex-direction: column; gap: 6px; z-index: 1; }
      .manual-editor__section-title { margin: 0; font-size: clamp(1.05rem, 1.6vw, 1.2rem); font-weight: 700; letter-spacing: -0.01em; color: var(--fg, #0c1520); }
      .manual-editor__section-description { margin: 0; font-size: 0.9rem; color: var(--fg-2, #63727e); line-height: 1.55; }
      .manual-editor__section-body { position: relative; z-index: 1; display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .manual-editor__section--array .manual-editor__section-body { display: flex; flex-direction: column; gap: 16px; }
      .manual-editor__array { display: flex; flex-direction: column; gap: 18px; }
      .manual-editor__array-item { border: 1px solid color-mix(in srgb, var(--brand, #00c2a8) 25%, transparent); border-radius: 20px; background: color-mix(in srgb, var(--bg-body, #f6faf9) 92%, transparent); box-shadow: 0 18px 44px rgba(12, 21, 32, 0.08); padding: 20px; display: flex; flex-direction: column; gap: 16px; }
      .manual-editor__array-item-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 70%, transparent); padding-bottom: 10px; }
      .manual-editor__array-item-title { margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--fg, #0c1520); }
      .manual-editor__array-actions { display: flex; justify-content: flex-end; gap: 10px; }
      .manual-editor__field { display: flex; flex-direction: column; gap: 10px; padding: 18px; border-radius: 18px; border: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 82%, transparent); background: var(--bg-surface, #ffffff); transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background 160ms ease; }
      .manual-editor__field:hover { transform: translateY(-1px); box-shadow: 0 18px 40px rgba(12, 21, 32, 0.08); }
      .manual-editor__field:focus-within { border-color: color-mix(in srgb, var(--brand, #00c2a8) 62%, transparent); box-shadow: 0 22px 48px rgba(0, 194, 168, 0.18); background: color-mix(in srgb, var(--bg-body, #f6faf9) 96%, transparent); }
      .manual-editor__field.has-error { border-color: color-mix(in srgb, var(--danger, #ff4d4d) 60%, transparent); background: color-mix(in srgb, #ffe5e5 85%, transparent); box-shadow: 0 22px 48px rgba(255, 77, 77, 0.18); }
      .manual-editor__label { font-size: 0.76rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-2, #63727e); }
      .manual-editor__input { width: 100%; border: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 85%, transparent); border-radius: 12px; padding: 11px 14px; font-size: 0.95rem; line-height: 1.45; background: color-mix(in srgb, var(--bg-body, #f6faf9) 96%, transparent); color: inherit; transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease; }
      .manual-editor__input:focus-visible { outline: none; border-color: color-mix(in srgb, var(--brand, #00c2a8) 65%, transparent); background: #ffffff; box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand, #00c2a8) 25%, transparent); }
      .manual-editor__input::placeholder { color: color-mix(in srgb, var(--fg-2, #63727e) 70%, transparent); }
      .manual-editor__input--textarea { min-height: 110px; resize: vertical; }
      .manual-editor__input--select { height: 46px; }
      .manual-editor__input--month { letter-spacing: 0.08em; text-transform: uppercase; }
      .manual-editor__error { font-size: 0.8rem; color: color-mix(in srgb, var(--danger, #ff4d4d) 75%, #7a1a1a); min-height: 1em; letter-spacing: 0.01em; }
      .manual-editor__add,
      .manual-editor__remove { border: none; border-radius: 999px; padding: 9px 20px; font-size: 0.82rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease; }
      .manual-editor__add { background: color-mix(in srgb, var(--brand, #00c2a8) 24%, white); color: color-mix(in srgb, var(--brand, #00c2a8) 78%, #0c1520); }
      .manual-editor__add:hover { transform: translateY(-1px); box-shadow: 0 18px 38px rgba(0, 194, 168, 0.22); }
      .manual-editor__remove { background: color-mix(in srgb, var(--danger, #ff4d4d) 22%, white); color: color-mix(in srgb, var(--danger, #ff4d4d) 72%, #7a1a1a); }
      .manual-editor__remove:hover { transform: translateY(-1px); box-shadow: 0 18px 38px rgba(255, 77, 77, 0.18); }
      .manual-editor__remove:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
      .vault-json-editor__footer { display: flex; justify-content: flex-end; gap: 16px; padding: clamp(22px, 3.4vw, 30px); border-top: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 80%, transparent); background: color-mix(in srgb, var(--bg-surface-2, #f9fcfb) 96%, transparent); }
      .vault-json-editor__footer button { min-width: 150px; border-radius: 16px; padding: 12px 24px; font-size: 0.98rem; font-weight: 600; border: none; cursor: pointer; transition: transform 150ms ease, box-shadow 160ms ease, background 150ms ease; }
      .vault-json-editor__footer .btn-secondary { background: color-mix(in srgb, var(--bg-body, #f6faf9) 90%, transparent); color: var(--fg, #0c1520); border: 1px solid color-mix(in srgb, var(--bd-hairline, #e3eee9) 85%, transparent); }
      .vault-json-editor__footer .btn-secondary:hover { transform: translateY(-1px); box-shadow: 0 18px 34px rgba(12, 21, 32, 0.1); }
      .vault-json-editor__footer .btn-primary { background: linear-gradient(135deg, color-mix(in srgb, var(--brand, #00c2a8) 85%, white 15%), color-mix(in srgb, var(--brand-hover, #00b39b) 80%, white 20%)); color: #ffffff; box-shadow: 0 26px 54px rgba(0, 194, 168, 0.35); }
      .vault-json-editor__footer .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 32px 64px rgba(0, 194, 168, 0.4); }
      .vault-json-editor__footer .btn-primary:disabled { opacity: 0.65; filter: saturate(0.6); box-shadow: none; transform: none; }
      @media (max-width: 1080px) {
        .vault-json-editor__layout { grid-template-columns: 1fr; }
        .vault-json-editor__aside { flex-direction: row; overflow: auto; }
        .vault-json-editor__aside-card { min-width: 260px; }
      }
      @media (max-width: 900px) {
        .vault-json-editor { padding: 0; }
        .vault-json-editor__dialog { width: 100%; max-height: 100vh; border-radius: 0; }
        .vault-json-editor__header { border-radius: 0; }
        .vault-json-editor__body { padding: 24px 18px; }
        .vault-json-editor__aside { flex-direction: column; }
      }
      @media (max-width: 640px) {
        .vault-json-editor__main { padding: 20px 18px; }
        .manual-editor__section-body { grid-template-columns: 1fr; }
        .vault-json-editor__footer { flex-direction: column; }
        .vault-json-editor__footer button { width: 100%; }
      }
      .viewer__file-alert { margin: 12px 0 0; padding: 14px 16px; border-radius: 14px; background: color-mix(in srgb, var(--warning, #ffa600) 18%, white); border: 1px solid color-mix(in srgb, var(--warning, #ffa600) 32%, transparent); color: color-mix(in srgb, var(--warning, #ffa600) 78%, #7c4a00); font-size: 0.9rem; display: flex; flex-direction: column; gap: 6px; }
      .viewer__file-alert strong { font-weight: 600; }
    `;
    document.head.appendChild(style);
  }

  function ensureJsonModal() {
    if (jsonModal) return jsonModal;
    injectJsonModalStyles();

    const modal = document.createElement('div');
    modal.className = 'vault-json-modal';
    modal.setAttribute('aria-hidden', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'vault-json-modal__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'vault-json-modal-title');

    const header = document.createElement('header');
    header.className = 'vault-json-modal__header';

    const title = document.createElement('h4');
    title.className = 'vault-json-modal__title';
    title.id = 'vault-json-modal-title';
    title.textContent = 'Processed JSON';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'vault-json-modal__close';
    closeBtn.setAttribute('aria-label', 'Close JSON view');
    closeBtn.textContent = '×';

    const meta = document.createElement('div');
    meta.className = 'vault-json-modal__meta';
    meta.hidden = true;

    const content = document.createElement('pre');
    content.className = 'vault-json-modal__content';

    header.append(title, closeBtn);
    dialog.append(header, meta, content);
    modal.appendChild(dialog);
    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        hideJsonModal();
      }
    });

    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      hideJsonModal();
    });

    jsonModal = modal;
    jsonModalTitle = title;
    jsonModalMeta = meta;
    jsonModalContent = content;
    jsonModalClose = closeBtn;
    return modal;
  }

  function hideJsonModal() {
    if (!jsonModal) return;
    jsonModal.classList.remove('is-visible');
    jsonModal.setAttribute('aria-hidden', 'true');
    if (jsonModalContent) {
      jsonModalContent.textContent = '';
      jsonModalContent.scrollTop = 0;
    }
    if (jsonModalMeta) {
      jsonModalMeta.textContent = '';
      jsonModalMeta.hidden = true;
    }
    const returnTarget = jsonModalReturnFocus;
    jsonModalReturnFocus = null;
    if (returnTarget && typeof returnTarget.focus === 'function') {
      requestAnimationFrame(() => {
        try { returnTarget.focus(); } catch (error) { console.warn('Failed to restore focus after closing JSON modal', error); }
      });
    }
  }

  function buildJsonPayload(file) {
    if (!file) return null;
    if (file.raw && typeof file.raw === 'object') {
      return file.raw;
    }
    const payload = {};
    if (file.fileId || file.id) payload.fileId = file.fileId || file.id;
    if (file.title) payload.title = file.title;
    if (file.subtitle) payload.subtitle = file.subtitle;
    if (file.metrics) payload.metrics = file.metrics;
    if (file.metadata) payload.metadata = file.metadata;
    if (Array.isArray(file.summary)) payload.summary = file.summary;
    if (Array.isArray(file.details)) payload.details = file.details;
    return Object.keys(payload).length ? payload : null;
  }

  async function showProcessedJson(file, trigger) {
    const docId = resolveDocId(file);
    if (!docId) {
      window.alert('Processed JSON is unavailable for this document.');
      return;
    }

    const restore = trigger ? withButtonSpinner(trigger, 'Loading…') : () => {};
    try {
      const response = await apiFetch(`/json?docId=${encodeURIComponent(docId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || typeof payload.json === 'undefined') {
        throw new Error(payload?.error || 'Processed JSON unavailable');
      }

      const modal = ensureJsonModal();
      if (!modal || !jsonModalContent) {
        throw new Error('Unable to display JSON right now.');
      }

      if (jsonModalTitle) {
        jsonModalTitle.textContent = file?.title ? `${file.title} — Processed JSON` : 'Processed JSON';
      }
      if (jsonModalMeta) {
        jsonModalMeta.innerHTML = '';
        const sections = [
          ['Meta', ensureObject(file.raw?.meta)],
          ['Processing', ensureObject(file.raw?.processing)],
          ['Result', ensureObject(file.raw?.result)],
        ];
        sections.forEach(([label, data]) => {
          if (!data || !Object.keys(data).length) return;
          const item = document.createElement('div');
          item.className = 'vault-json-modal__meta-item';
          const name = document.createElement('strong');
          name.textContent = `${label}:`;
          const value = document.createElement('code');
          value.textContent = JSON.stringify(data, null, 2);
          item.append(name, value);
          jsonModalMeta.appendChild(item);
        });
        jsonModalMeta.hidden = jsonModalMeta.childElementCount === 0;
        jsonModalMeta.scrollTop = 0;
      }

      try {
        jsonModalContent.textContent = JSON.stringify(payload.json, null, 2);
      } catch (error) {
        console.error('Failed to serialise processed JSON payload', error);
        jsonModalContent.textContent = 'Unable to serialise processed JSON payload.';
      }
      jsonModalContent.scrollTop = 0;

      jsonModalReturnFocus = trigger || null;
      modal.classList.add('is-visible');
      modal.setAttribute('aria-hidden', 'false');
      if (jsonModalClose) {
        jsonModalClose.focus();
      }
    } catch (error) {
      console.error('Processed JSON preview failed', error);
      window.alert(error.message || 'Unable to load processed JSON right now.');
    } finally {
      restore();
    }
  }

  function showJsonForFile(file, trigger) {
    if (!jsonTestEnabled) return;
    const payload = buildJsonPayload(file);
    if (!payload) {
      window.alert('Processed JSON is unavailable for this document.');
      return;
    }

    const modal = ensureJsonModal();
    if (!modal || !jsonModalContent) {
      window.alert('Unable to display JSON right now.');
      return;
    }

    let text = '';
    try {
      text = JSON.stringify(payload, null, 2);
    } catch (error) {
      console.error('Failed to serialise document JSON', error);
      text = 'Unable to serialise this document\'s JSON payload.';
    }

    if (jsonModalTitle) {
      jsonModalTitle.textContent = file?.title ? `${file.title} — JSON` : 'Processed JSON';
    }
    if (jsonModalMeta) {
      const parts = [];
      if (file?.subtitle) parts.push(file.subtitle);
      if (file?.fileId) parts.push(`ID: ${file.fileId}`);
      if (file?.raw?.catalogueKey) parts.push(file.raw.catalogueKey);
      jsonModalMeta.textContent = parts.join(' • ');
      jsonModalMeta.hidden = parts.length === 0;
    }
    jsonModalContent.textContent = text;
    jsonModalContent.scrollTop = 0;

    jsonModalReturnFocus = trigger || null;
    modal.classList.add('is-visible');
    modal.setAttribute('aria-hidden', 'false');
    if (jsonModalClose) {
      jsonModalClose.focus();
    }
  }

  function injectManualEditorStyles() {
    if (manualEditorStylesInjected) return;
    manualEditorStylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .vault-json-editor { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; padding: clamp(16px, 4vw, 40px); background: radial-gradient(circle at top left, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.94)); backdrop-filter: blur(14px); z-index: 1320; }
      .vault-json-editor.is-visible { display: flex; }
      .vault-json-editor__dialog { position: relative; width: min(1120px, 100%); max-height: min(94vh, 860px); background: rgba(248, 250, 252, 0.96); color: var(--bs-body-color, #0f172a); border-radius: 28px; border: 1px solid rgba(148, 163, 184, 0.28); box-shadow: 0 40px 90px rgba(15, 23, 42, 0.35); display: flex; flex-direction: column; overflow: hidden; }
      .vault-json-editor__header { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: clamp(16px, 3vw, 28px); padding: clamp(24px, 5vw, 36px); background: linear-gradient(135deg, #4338ca, #6366f1); color: #f8fafc; }
      .vault-json-editor__header::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at top right, rgba(255, 255, 255, 0.32), transparent 55%); pointer-events: none; opacity: 0.9; }
      .vault-json-editor__title-group { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px; max-width: 640px; }
      .vault-json-editor__title { margin: 0; font-size: clamp(1.3rem, 2.4vw, 1.75rem); font-weight: 700; letter-spacing: -0.01em; color: inherit; }
      .vault-json-editor__subtitle { margin: 0; font-size: clamp(0.95rem, 1.4vw, 1.05rem); color: rgba(240, 249, 255, 0.82); line-height: 1.6; }
      .vault-json-editor__close { position: relative; z-index: 1; border: none; background: rgba(255, 255, 255, 0.16); color: #fff; font-size: 1.5rem; line-height: 1; padding: 6px 12px; border-radius: 14px; cursor: pointer; transition: background 160ms ease, transform 160ms ease, box-shadow 160ms ease; }
      .vault-json-editor__close:hover { background: rgba(255, 255, 255, 0.26); transform: translateY(-1px); box-shadow: 0 10px 26px rgba(15, 23, 42, 0.2); }
      .vault-json-editor__close:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.6); outline-offset: 3px; }
      .vault-json-editor__body { position: relative; padding: clamp(24px, 4vw, 36px); overflow-y: auto; flex: 1; background: linear-gradient(180deg, rgba(248, 250, 252, 0.94), rgba(241, 245, 249, 0.98)); }
      .vault-json-editor__body::-webkit-scrollbar { width: 10px; }
      .vault-json-editor__body::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.45); border-radius: 999px; }
      .vault-json-editor__body::-webkit-scrollbar-track { background: rgba(226, 232, 240, 0.6); border-radius: 999px; }
      .vault-json-editor__layout { display: grid; grid-template-columns: minmax(220px, 0.85fr) minmax(0, 1fr); gap: clamp(20px, 4vw, 32px); align-items: start; }
      .vault-json-editor__aside { display: flex; flex-direction: column; gap: clamp(18px, 3vw, 24px); position: sticky; top: clamp(8px, 2vw, 20px); }
      .vault-json-editor__main { display: flex; flex-direction: column; gap: clamp(18px, 3vw, 26px); }
      .vault-json-editor__aside-card { display: flex; flex-direction: column; gap: 14px; padding: clamp(18px, 3vw, 24px); border-radius: 22px; border: 1px solid rgba(148, 163, 184, 0.24); background: rgba(255, 255, 255, 0.92); box-shadow: 0 28px 60px rgba(15, 23, 42, 0.14); backdrop-filter: blur(8px); }
      .vault-json-editor__aside-card--meta { background: rgba(238, 242, 255, 0.92); border-color: rgba(99, 102, 241, 0.28); box-shadow: 0 32px 68px rgba(79, 70, 229, 0.16); }
      .vault-json-editor__aside-title { margin: 0; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(79, 70, 229, 0.95); }
      .vault-json-editor__aside-description { margin: 0; font-size: 0.9rem; line-height: 1.55; color: rgba(71, 85, 105, 0.85); }
      .vault-json-editor__meta { display: flex; flex-direction: column; gap: 16px; }
      .vault-json-editor__meta[hidden] { display: none !important; }
      .vault-json-editor__meta-item { display: flex; flex-direction: column; gap: 6px; padding: 14px 18px; border-radius: 18px; border: 1px solid rgba(99, 102, 241, 0.18); background: rgba(255, 255, 255, 0.96); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45); transition: border-color 160ms ease, background 160ms ease, transform 160ms ease; }
      .vault-json-editor__meta-item:hover { transform: translateY(-1px); }
      .vault-json-editor__meta-item[data-state='warning'] { border-color: rgba(217, 119, 6, 0.32); background: rgba(255, 247, 237, 0.98); }
      .vault-json-editor__meta-item[data-state='danger'] { border-color: rgba(220, 38, 38, 0.35); background: rgba(254, 242, 242, 0.96); }
      .vault-json-editor__meta-item[data-state='success'] { border-color: rgba(16, 185, 129, 0.35); background: rgba(236, 253, 245, 0.96); }
      .vault-json-editor__meta-label { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(79, 70, 229, 0.85); }
      .vault-json-editor__meta-value { font-size: 0.98rem; font-weight: 600; color: rgba(15, 23, 42, 0.9); word-break: break-word; }
      .vault-json-editor__meta-value--status { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #4338ca; }
      .vault-json-editor__meta-value--status::before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: currentColor; opacity: 0.6; }
      .vault-json-editor__meta-value--status[data-state='warning'] { color: #b45309; }
      .vault-json-editor__meta-value--status[data-state='danger'] { color: #b91c1c; }
      .vault-json-editor__meta-value--status[data-state='success'] { color: #047857; }
      .vault-json-editor__message,
      .vault-json-editor__error,
      .vault-json-editor__loading { position: relative; margin: 0; padding: 18px 20px 18px 56px; border-radius: 18px; border: 1px solid rgba(148, 163, 184, 0.25); background: rgba(255, 255, 255, 0.95); box-shadow: 0 20px 40px rgba(15, 23, 42, 0.12); font-size: 0.97rem; line-height: 1.55; }
      .vault-json-editor__message[hidden],
      .vault-json-editor__error[hidden],
      .vault-json-editor__loading[hidden] { display: none !important; }
      .vault-json-editor__message::before,
      .vault-json-editor__error::before,
      .vault-json-editor__loading::before { content: 'ℹ️'; position: absolute; left: 22px; top: 50%; transform: translateY(-50%); font-size: 1.35rem; }
      .vault-json-editor__message { border-left: 5px solid rgba(79, 70, 229, 0.75); background: rgba(237, 242, 255, 0.96); color: rgba(49, 46, 129, 0.95); }
      .vault-json-editor__message strong { color: rgba(67, 56, 202, 1); }
      .vault-json-editor__error { border-left: 5px solid rgba(220, 38, 38, 0.78); background: rgba(254, 226, 226, 0.94); color: rgba(153, 27, 27, 0.95); }
      .vault-json-editor__error::before { content: '⚠️'; }
      .vault-json-editor__loading { border-left: 5px solid rgba(37, 99, 235, 0.65); background: rgba(219, 234, 254, 0.9); color: rgba(30, 41, 59, 0.85); }
      .vault-json-editor__loading::before { content: '⏳'; }
      .vault-json-editor__form { display: flex; flex-direction: column; gap: 28px; }
      .vault-json-editor__sections { display: flex; flex-direction: column; gap: 22px; }
      .manual-editor__empty { margin: 0; padding: 30px; text-align: center; font-size: 0.98rem; color: rgba(15, 23, 42, 0.68); border: 2px dashed rgba(148, 163, 184, 0.45); border-radius: 22px; background: rgba(248, 250, 252, 0.96); }
      .manual-editor__section { display: flex; flex-direction: column; gap: 20px; padding: clamp(22px, 3vw, 28px); border-radius: 24px; border: 1px solid rgba(148, 163, 184, 0.26); background: rgba(255, 255, 255, 0.97); box-shadow: 0 28px 62px rgba(15, 23, 42, 0.14); position: relative; overflow: hidden; }
      .manual-editor__section::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(120deg, rgba(79, 70, 229, 0.12), transparent 65%); opacity: 0; transition: opacity 180ms ease; pointer-events: none; }
      .manual-editor__section:hover::before { opacity: 1; }
      .manual-editor__section-header { position: relative; display: flex; flex-direction: column; gap: 8px; z-index: 1; }
      .manual-editor__section-title { margin: 0; font-size: clamp(1.02rem, 1.5vw, 1.12rem); font-weight: 600; letter-spacing: -0.01em; color: rgba(15, 23, 42, 0.9); }
      .manual-editor__section-description { margin: 0; font-size: 0.9rem; color: rgba(71, 85, 105, 0.88); line-height: 1.6; }
      .manual-editor__section-body { position: relative; z-index: 1; display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .manual-editor__section--array .manual-editor__section-body { display: flex; flex-direction: column; gap: 16px; }
      .manual-editor__array { display: flex; flex-direction: column; gap: 18px; }
      .manual-editor__array-item { border: 1px solid rgba(99, 102, 241, 0.22); border-radius: 20px; background: rgba(248, 250, 252, 0.96); box-shadow: 0 24px 54px rgba(15, 23, 42, 0.12); padding: 20px; display: flex; flex-direction: column; gap: 16px; }
      .manual-editor__array-item-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(148, 163, 184, 0.28); }
      .manual-editor__array-item-title { margin: 0; font-size: 0.96rem; font-weight: 600; color: rgba(15, 23, 42, 0.88); }
      .manual-editor__array-actions { display: flex; justify-content: flex-end; gap: 10px; }
      .manual-editor__field { display: flex; flex-direction: column; gap: 10px; padding: 18px; border-radius: 18px; border: 1px solid rgba(203, 213, 225, 0.65); background: rgba(255, 255, 255, 0.98); transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background 160ms ease; }
      .manual-editor__field:hover { transform: translateY(-1px); box-shadow: 0 18px 38px rgba(15, 23, 42, 0.12); }
      .manual-editor__field:focus-within { border-color: rgba(79, 70, 229, 0.6); box-shadow: 0 24px 46px rgba(79, 70, 229, 0.16); background: rgba(248, 250, 252, 0.98); }
      .manual-editor__field.has-error { border-color: rgba(220, 38, 38, 0.65); background: rgba(254, 226, 226, 0.95); box-shadow: 0 20px 40px rgba(220, 38, 38, 0.16); }
      .manual-editor__label { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(71, 85, 105, 0.9); }
      .manual-editor__input { width: 100%; border: 1px solid rgba(148, 163, 184, 0.45); border-radius: 14px; padding: 12px 16px; font-size: 0.96rem; line-height: 1.5; background: rgba(241, 245, 249, 0.9); color: inherit; transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease; }
      .manual-editor__input:focus-visible { outline: none; border-color: rgba(79, 70, 229, 0.72); background: #fff; box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.25); }
      .manual-editor__input::placeholder { color: rgba(100, 116, 139, 0.7); }
      .manual-editor__input--textarea { min-height: 110px; resize: vertical; }
      .manual-editor__input--select { height: 46px; }
      .manual-editor__error { font-size: 0.78rem; color: rgba(220, 38, 38, 1); min-height: 1em; letter-spacing: 0.02em; }
      .manual-editor__add { border: none; background: rgba(16, 185, 129, 0.22); color: #047857; border-radius: 999px; padding: 9px 20px; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: background 150ms ease, transform 150ms ease, box-shadow 150ms ease; }
      .manual-editor__add:hover { background: rgba(16, 185, 129, 0.3); transform: translateY(-1px); box-shadow: 0 16px 34px rgba(16, 185, 129, 0.22); }
      .manual-editor__remove { border: none; background: rgba(239, 68, 68, 0.22); color: #b91c1c; border-radius: 999px; padding: 9px 20px; font-size: 0.82rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: background 150ms ease, transform 150ms ease, box-shadow 150ms ease; }
      .manual-editor__remove:hover { background: rgba(239, 68, 68, 0.32); transform: translateY(-1px); box-shadow: 0 16px 34px rgba(239, 68, 68, 0.22); }
      .vault-json-editor__footer { display: flex; justify-content: flex-end; gap: 16px; padding: clamp(22px, 4vw, 32px); border-top: 1px solid rgba(148, 163, 184, 0.26); background: rgba(248, 250, 252, 0.97); }
      .vault-json-editor__footer button { min-width: 150px; border-radius: 16px; padding: 12px 24px; font-size: 0.98rem; font-weight: 600; border: none; cursor: pointer; transition: transform 150ms ease, box-shadow 160ms ease, background 150ms ease; }
      .vault-json-editor__footer .btn-secondary { background: rgba(15, 23, 42, 0.08); color: rgba(15, 23, 42, 0.85); box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08); }
      .vault-json-editor__footer .btn-secondary:hover { background: rgba(15, 23, 42, 0.12); transform: translateY(-1px); box-shadow: 0 18px 36px rgba(15, 23, 42, 0.12); }
      .vault-json-editor__footer .btn-primary { background: linear-gradient(135deg, #4f46e5, #8b5cf6); color: #fff; box-shadow: 0 28px 58px rgba(99, 102, 241, 0.38); }
      .vault-json-editor__footer .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 32px 68px rgba(99, 102, 241, 0.46); }
      .vault-json-editor__footer .btn-primary:disabled { opacity: 0.65; filter: grayscale(0.1); box-shadow: none; transform: none; }
      .json-editor-section { display: flex; flex-direction: column; gap: 16px; padding: 20px; border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 20px; background: rgba(255, 255, 255, 0.95); box-shadow: 0 24px 48px rgba(15, 23, 42, 0.12); }
      .json-editor-section__header { display: flex; flex-direction: column; gap: 8px; }
      .json-editor-section__title { margin: 0; font-size: 1rem; font-weight: 600; }
      .json-editor-section__description { margin: 0; font-size: 0.88rem; color: rgba(71, 85, 105, 0.88); }
      .json-editor-list { display: flex; flex-direction: column; gap: 14px; }
      .json-editor-row { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(120px, 0.7fr) minmax(200px, 1.2fr) auto; gap: 14px; align-items: flex-start; padding: 16px; border-radius: 16px; background: rgba(255, 255, 255, 0.96); border: 1px solid rgba(148, 163, 184, 0.22); transition: border-color 160ms ease, box-shadow 160ms ease; }
      .json-editor-row.has-error { border-color: rgba(220, 38, 38, 0.45); background: rgba(254, 226, 226, 0.94); }
      .json-editor-row.is-required { border-color: rgba(99, 102, 241, 0.45); }
      .json-editor-col { display: flex; flex-direction: column; gap: 6px; }
      .json-editor-label { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(71, 85, 105, 0.9); }
      .json-editor-input, .json-editor-select, .json-editor-textarea { width: 100%; border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 12px; padding: 10px 14px; font-size: 0.94rem; line-height: 1.45; background: rgba(241, 245, 249, 0.92); color: inherit; transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease; }
      .json-editor-input:focus-visible, .json-editor-select:focus-visible, .json-editor-textarea:focus-visible { outline: none; border-color: rgba(99, 102, 241, 0.65); background: #fff; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18); }
      .json-editor-textarea { resize: vertical; min-height: 60px; }
      .json-editor-select { height: 42px; }
      .json-editor-remove { border: none; background: rgba(239, 68, 68, 0.2); color: #b91c1c; border-radius: 14px; padding: 9px 16px; font-size: 0.86rem; cursor: pointer; transition: background 140ms ease, transform 140ms ease; }
      .json-editor-remove:hover { background: rgba(239, 68, 68, 0.28); transform: translateY(-1px); }
      .json-editor-remove:disabled { opacity: 0.5; cursor: not-allowed; }
      .json-editor-row__error { grid-column: 1 / -1; font-size: 0.82rem; color: rgba(220, 38, 38, 0.95); }
      .json-editor-add { align-self: flex-start; border: none; background: rgba(99, 102, 241, 0.22); color: rgba(67, 56, 202, 1); border-radius: 999px; padding: 8px 18px; font-size: 0.86rem; cursor: pointer; transition: background 140ms ease, transform 140ms ease; }
      .json-editor-add:hover { background: rgba(99, 102, 241, 0.3); transform: translateY(-1px); }
      .json-editor-transaction { display: flex; flex-direction: column; gap: 14px; padding: 18px; border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 18px; background: rgba(255, 255, 255, 0.95); }
      .json-editor-transaction__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .json-editor-transaction__title { margin: 0; font-size: 0.94rem; font-weight: 600; }
      .json-editor-transaction-list { display: flex; flex-direction: column; gap: 12px; }
      .json-editor-narrative { display: flex; flex-direction: column; gap: 12px; }
      .json-editor-narrative-item { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: flex-start; padding: 16px; border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 16px; background: rgba(255, 255, 255, 0.95); transition: border-color 160ms ease, box-shadow 160ms ease; }
      .json-editor-narrative-item.has-error { border-color: rgba(220, 38, 38, 0.45); background: rgba(254, 226, 226, 0.94); }
      .json-editor-footer { display: flex; justify-content: flex-end; gap: 14px; padding: 18px 24px; border-top: 1px solid rgba(148, 163, 184, 0.24); background: rgba(248, 250, 252, 0.95); }
      .json-editor-footer button { min-width: 130px; border-radius: 14px; padding: 10px 20px; font-size: 0.92rem; border: none; cursor: pointer; transition: transform 130ms ease, box-shadow 130ms ease; }
      .json-editor-footer .btn-secondary { background: rgba(15, 23, 42, 0.08); color: rgba(15, 23, 42, 0.85); }
      .json-editor-footer .btn-secondary:hover { background: rgba(15, 23, 42, 0.14); transform: translateY(-1px); }
      .json-editor-footer .btn-primary { background: linear-gradient(135deg, #4f46e5, #8b5cf6); color: #fff; box-shadow: 0 20px 40px rgba(99, 102, 241, 0.32); }
      .json-editor-footer .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 24px 48px rgba(99, 102, 241, 0.4); }
      .json-editor-footer .btn-primary:disabled { opacity: 0.65; }
      @media (max-width: 1080px) {
        .vault-json-editor__dialog { width: min(100%, 940px); }
      }
      @media (max-width: 960px) {
        .vault-json-editor__layout { grid-template-columns: 1fr; }
        .vault-json-editor__aside { position: static; }
        .vault-json-editor__main { order: 2; }
      }
      @media (max-width: 720px) {
        .vault-json-editor__dialog { width: 100%; max-height: 100vh; border-radius: 0; }
        .vault-json-editor__header { padding: 24px 20px; border-radius: 0; }
        .vault-json-editor__body { padding: 24px 20px 28px; }
        .vault-json-editor__footer { padding: 20px; flex-direction: column; align-items: stretch; }
        .vault-json-editor__footer button { width: 100%; }
        .manual-editor__section { padding: 22px; }
        .manual-editor__section-body { grid-template-columns: 1fr; }
      }
      .viewer__file-alert { margin: 12px 0 0; padding: 14px 16px; border-radius: 14px; background: rgba(253, 186, 116, 0.24); border: 1px solid rgba(234, 88, 12, 0.32); font-size: 0.9rem; color: rgba(120, 53, 15, 0.95); display: flex; flex-direction: column; gap: 6px; }
      .viewer__file-alert strong { font-weight: 600; }
    `;
    document.head.appendChild(style);
  }

  function ensureManualEditorModal() {
    if (manualEditorModal) return manualEditorModal;
    injectManualEditorStyles();

    const modal = document.createElement('div');
    modal.className = 'vault-json-editor';
    modal.setAttribute('aria-hidden', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'vault-json-editor__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'vault-json-editor-title');
    dialog.tabIndex = -1;

    const header = document.createElement('header');
    header.className = 'vault-json-editor__header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'vault-json-editor__title-group';

    const title = document.createElement('h4');
    title.className = 'vault-json-editor__title';
    title.id = 'vault-json-editor-title';
    title.textContent = 'Preview Data';

    const subtitle = document.createElement('p');
    subtitle.className = 'vault-json-editor__subtitle';
    subtitle.textContent = 'Review and fine-tune the extracted fields for this document.';

    titleGroup.append(title, subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'vault-json-editor__close';
    closeBtn.setAttribute('aria-label', 'Close data preview');
    closeBtn.textContent = '×';

    const body = document.createElement('div');
    body.className = 'vault-json-editor__body';

    const layout = document.createElement('div');
    layout.className = 'vault-json-editor__layout';

    const aside = document.createElement('aside');
    aside.className = 'vault-json-editor__aside';

    const metaCard = document.createElement('section');
    metaCard.className = 'vault-json-editor__aside-card vault-json-editor__aside-card--meta';

    const metaTitle = document.createElement('h6');
    metaTitle.className = 'vault-json-editor__aside-title';
    metaTitle.textContent = 'Document context';

    const meta = document.createElement('div');
    meta.className = 'vault-json-editor__meta';
    meta.hidden = true;

    const metaDocItem = document.createElement('div');
    metaDocItem.className = 'vault-json-editor__meta-item';

    const metaDocLabel = document.createElement('span');
    metaDocLabel.className = 'vault-json-editor__meta-label';
    metaDocLabel.textContent = 'Document';

    const metaDocValue = document.createElement('span');
    metaDocValue.className = 'vault-json-editor__meta-value';
    metaDocValue.textContent = 'Document details';

    metaDocItem.append(metaDocLabel, metaDocValue);

    const metaSchemaItem = document.createElement('div');
    metaSchemaItem.className = 'vault-json-editor__meta-item';

    const metaSchemaLabel = document.createElement('span');
    metaSchemaLabel.className = 'vault-json-editor__meta-label';
    metaSchemaLabel.textContent = 'Schema';

    const metaSchemaValue = document.createElement('span');
    metaSchemaValue.className = 'vault-json-editor__meta-value';
    metaSchemaValue.textContent = 'Schema';

    metaSchemaItem.append(metaSchemaLabel, metaSchemaValue);

    const metaStatusItem = document.createElement('div');
    metaStatusItem.className = 'vault-json-editor__meta-item';

    const metaStatusLabel = document.createElement('span');
    metaStatusLabel.className = 'vault-json-editor__meta-label';
    metaStatusLabel.textContent = 'Status';

    const metaStatusValue = document.createElement('span');
    metaStatusValue.className = 'vault-json-editor__meta-value vault-json-editor__meta-value--status';
    metaStatusValue.textContent = 'Status';

    metaStatusItem.append(metaStatusLabel, metaStatusValue);

    meta.append(metaDocItem, metaSchemaItem, metaStatusItem);
    metaCard.append(metaTitle, meta);

    const guidanceCard = document.createElement('section');
    guidanceCard.className = 'vault-json-editor__aside-card';

    const guidanceTitle = document.createElement('h6');
    guidanceTitle.className = 'vault-json-editor__aside-title';
    guidanceTitle.textContent = 'Review checklist';

    const guidanceCopy = document.createElement('p');
    guidanceCopy.className = 'vault-json-editor__aside-description';
    guidanceCopy.textContent = 'Compare totals, statement periods, and key identifiers with the source document before saving any changes.';

    guidanceCard.append(guidanceTitle, guidanceCopy);
    aside.append(metaCard, guidanceCard);

    const main = document.createElement('div');
    main.className = 'vault-json-editor__main';

    const message = document.createElement('p');
    message.className = 'vault-json-editor__message';
    message.hidden = true;

    const error = document.createElement('p');
    error.className = 'vault-json-editor__error';
    error.hidden = true;

    const loading = document.createElement('p');
    loading.className = 'vault-json-editor__loading';
    loading.textContent = 'Loading…';
    loading.hidden = true;

    const form = document.createElement('form');
    form.className = 'vault-json-editor__form';
    form.hidden = true;

    const sections = document.createElement('div');
    sections.className = 'vault-json-editor__sections';
    form.appendChild(sections);

    const footer = document.createElement('div');
    footer.className = 'vault-json-editor__footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancel';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = 'Save changes';

    footer.append(cancelBtn, saveBtn);
    form.appendChild(footer);

    main.append(message, error, loading, form);
    layout.append(aside, main);
    body.append(layout);

    header.append(titleGroup, closeBtn);
    dialog.append(header, body);
    modal.appendChild(dialog);
    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        hideManualEditorModal();
      }
    });

    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      hideManualEditorModal();
    });

    cancelBtn.addEventListener('click', (event) => {
      event.preventDefault();
      hideManualEditorModal();
    });

    form.addEventListener('submit', handleManualEditorSubmit);
    form.addEventListener('click', handleManualEditorClick);
    form.addEventListener('change', handleManualEditorChange);

    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        hideManualEditorModal();
      }
    });

    manualEditorModal = modal;
    manualEditorDialog = dialog;
    manualEditorTitle = title;
    manualEditorSubtitle = subtitle;
    manualEditorMessage = message;
    manualEditorError = error;
    manualEditorLoading = loading;
    manualEditorForm = form;
    manualEditorSections = sections;
    manualEditorSave = saveBtn;
    manualEditorCancel = cancelBtn;
    manualEditorMeta = meta;
    manualEditorMetaDoc = metaDocValue;
    manualEditorMetaSchema = metaSchemaValue;
    manualEditorMetaStatus = metaStatusValue;
    manualEditorMetaStatusContainer = metaStatusItem;
    return modal;
  }

  function hideManualEditorModal() {
    if (!manualEditorModal) return;
    manualEditorModal.classList.remove('is-visible');
    manualEditorModal.setAttribute('aria-hidden', 'true');
    manualEditorDocId = null;
    manualEditorFile = null;
    manualEditorRequired = null;
    manualEditorSchemaKey = null;
    manualEditorFormData = null;
    if (manualEditorForm) {
      manualEditorForm.hidden = true;
    }
    if (manualEditorLoading) {
      manualEditorLoading.hidden = true;
    }
    if (manualEditorMessage) {
      manualEditorMessage.hidden = true;
      manualEditorMessage.textContent = '';
    }
    if (manualEditorError) {
      manualEditorError.hidden = true;
      manualEditorError.textContent = '';
    }
    if (manualEditorSections) {
      manualEditorSections.innerHTML = '';
    }
    if (manualEditorSubtitle) {
      manualEditorSubtitle.textContent = 'Review and fine-tune the extracted fields for this document.';
    }
    if (manualEditorMeta) {
      manualEditorMeta.hidden = true;
    }
    if (manualEditorMetaDoc) {
      manualEditorMetaDoc.textContent = 'Document details';
    }
    if (manualEditorMetaSchema) {
      manualEditorMetaSchema.textContent = 'Schema';
    }
    if (manualEditorMetaStatus) {
      manualEditorMetaStatus.textContent = 'Status';
      manualEditorMetaStatus.removeAttribute('data-state');
    }
    if (manualEditorMetaStatusContainer) {
      manualEditorMetaStatusContainer.removeAttribute('data-state');
    }
    const target = manualEditorReturnFocus;
    manualEditorReturnFocus = null;
    if (target && typeof target.focus === 'function') {
      requestAnimationFrame(() => {
        try { target.focus(); } catch (error) { console.warn('Failed to restore focus after closing editor', error); }
      });
    }
  }

  async function openDataPreview(file, trigger) {
    const docId = resolveDocId(file);
    if (!docId) {
      window.alert('Unable to preview this document because it is missing an identifier.');
      return;
    }

    const modal = ensureManualEditorModal();
    if (!modal || !manualEditorForm || !manualEditorLoading) {
      window.alert('Unable to open the editor right now.');
      return;
    }

    manualEditorDocId = docId;
    manualEditorFile = file;
    manualEditorReturnFocus = trigger || null;
    clearManualEditorErrors();

    manualEditorForm.hidden = true;
    manualEditorLoading.hidden = false;
    manualEditorLoading.textContent = 'Fetching structured data…';
    if (manualEditorMessage) {
      manualEditorMessage.hidden = true;
      manualEditorMessage.textContent = '';
    }
    if (manualEditorError) {
      manualEditorError.hidden = true;
      manualEditorError.textContent = '';
    }

    if (manualEditorSubtitle) {
      manualEditorSubtitle.textContent = 'Syncing fields from Docupipe…';
    }
    if (manualEditorMeta) {
      manualEditorMeta.hidden = true;
    }
    if (manualEditorMetaDoc) {
      manualEditorMetaDoc.textContent = 'Document details';
    }
    if (manualEditorMetaSchema) {
      manualEditorMetaSchema.textContent = 'Schema';
    }
    if (manualEditorMetaStatus) {
      manualEditorMetaStatus.textContent = 'Status';
      manualEditorMetaStatus.removeAttribute('data-state');
    }
    if (manualEditorMetaStatusContainer) {
      manualEditorMetaStatusContainer.removeAttribute('data-state');
    }

    const restore = trigger ? withButtonSpinner(trigger, 'Opening…') : () => {};

    try {
      const { data, meta, processing, schema } = await fetchManualJsonPayload(docId);
      manualEditorSchemaKey = resolveManualEditorSchema(file, schema, meta);
      if (!manualEditorSchemaKey || !MANUAL_EDITOR_SCHEMAS[manualEditorSchemaKey]) {
        throw new Error('Data preview is not available for this document type yet.');
      }
      manualEditorFormData = mapManualPayloadToForm(manualEditorSchemaKey, data);
      manualEditorRequired = ensureObject(meta?.requiresManualFields);
      renderManualEditorForm(manualEditorFormData, manualEditorRequired, processing);
      if (manualEditorTitle) {
        manualEditorTitle.textContent = file?.title ? `${file.title} — Preview Data` : 'Preview Data';
      }
      if (manualEditorMessage) {
        const requires = Array.isArray(processing?.requiresManualFields)
          ? processing.requiresManualFields.filter((field) => typeof field === 'string' && field.trim())
          : [];
        if (requires.length) {
          manualEditorMessage.innerHTML = `<strong>Additional review required:</strong> Add values for ${requires.join(', ')} so analytics stay accurate.`;
          manualEditorMessage.hidden = false;
        } else {
          manualEditorMessage.hidden = false;
          manualEditorMessage.innerHTML = '<strong>Review extracted data:</strong> Validate the values below before saving to keep dashboards trustworthy.';
        }
      }
      manualEditorLoading.hidden = true;
      manualEditorForm.hidden = false;
      modal.classList.add('is-visible');
      modal.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        try {
          if (manualEditorDialog) {
            manualEditorDialog.focus();
          } else if (manualEditorSave) {
            manualEditorSave.focus();
          }
        } catch {}
      });
    } catch (error) {
      manualEditorLoading.textContent = error.message || 'Unable to load the data preview right now.';
      manualEditorForm.hidden = true;
      modal.classList.add('is-visible');
      modal.setAttribute('aria-hidden', 'false');
    } finally {
      restore();
    }
  }

  async function fetchManualJsonPayload(docId) {
    const response = await apiFetch(`/json?docId=${encodeURIComponent(docId)}`, { cache: 'no-store' });
    if (response.status === 401) {
      handleUnauthorised('Your session has expired. Please sign in again.');
      throw new Error('Please sign in again to preview this document.');
    }
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.ok) {
      return {
        data: normaliseManualJsonShape(payload.json || {}),
        meta: payload.meta || {},
        processing: payload.processing || {},
        schema: payload.schema || null,
      };
    }
    if (payload?.error === 'JSON_NOT_READY') {
      return {
        data: normaliseManualJsonShape({}),
        meta: payload.meta || {},
        processing: payload.processing || {},
        schema: payload.schema || null,
      };
    }
    throw new Error(payload?.error || 'Unable to load this document\'s data right now.');
  }

  function normaliseManualJsonShape(data) {
    const source = ensureObject(data);
    const embedded = ensureObject(source.data);
    const hasEmbeddedContent =
      embedded &&
      (
        embedded.metadata != null ||
        embedded.metrics != null ||
        Array.isArray(embedded.transactions) ||
        Array.isArray(embedded.narrative)
      );
    const payload = hasEmbeddedContent ? embedded : source;

    return {
      metadata: ensureObject(payload.metadata),
      metrics: ensureObject(payload.metrics),
      transactions: Array.isArray(payload.transactions)
        ? payload.transactions.map((tx) => ensureObject(tx))
        : [],
      narrative: Array.isArray(payload.narrative)
        ? payload.narrative.map((line) => (line == null ? '' : String(line)))
        : [],
    };
  }

  function normalisePathToken(token) {
    return String(token || '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
  }

  function getLooseValue(source, path) {
    if (!source || !path) return undefined;
    const tokens = String(path)
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .filter(Boolean);
    let current = source;
    for (const token of tokens) {
      if (current == null) return undefined;
      if (Array.isArray(current)) {
        const index = Number(token);
        if (Number.isInteger(index) && index >= 0 && index < current.length) {
          current = current[index];
          continue;
        }
        return undefined;
      }
      if (typeof current !== 'object') return undefined;
      let next = current[token];
      if (typeof next === 'undefined') {
        const targetKey = normalisePathToken(token);
        for (const key of Object.keys(current)) {
          if (normalisePathToken(key) === targetKey) {
            next = current[key];
            break;
          }
        }
      }
      if (typeof next === 'undefined') return undefined;
      current = next;
    }
    return current;
  }

  function looseGet(source, ...paths) {
    for (const path of paths) {
      if (!path && path !== 0) continue;
      const value = getLooseValue(source, path);
      if (typeof value !== 'undefined') return value;
    }
    return undefined;
  }

  function isNonEmptyObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
  }

  function pickObjectLoose(...candidates) {
    for (const candidate of candidates) {
      if (isNonEmptyObject(candidate)) return candidate;
    }
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate;
      }
    }
    return {};
  }

  function pickArrayLoose(...candidates) {
    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length) return candidate;
    }
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }

  function firstDefined(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    return undefined;
  }

  function normaliseNumericValue(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[£$,]/g, '').replace(/\s+/g, '');
      const number = Number(cleaned);
      if (Number.isFinite(number)) return number;
      return value.trim();
    }
    return value;
  }

  function renderManualEditorForm(data = {}, required = {}, processing = {}) {
    if (!manualEditorSections || !manualEditorForm) return;
    manualEditorSections.innerHTML = '';

    const schema = manualEditorSchemaKey ? MANUAL_EDITOR_SCHEMAS[manualEditorSchemaKey] : null;
    if (!schema) {
      const unavailable = document.createElement('p');
      unavailable.className = 'manual-editor__empty';
      unavailable.textContent = 'Data preview is not available for this document yet.';
      manualEditorSections.appendChild(unavailable);
      manualEditorForm.hidden = true;
      if (manualEditorMessage) {
        manualEditorMessage.hidden = false;
        manualEditorMessage.textContent = unavailable.textContent;
      }
      if (manualEditorSubtitle) {
        manualEditorSubtitle.textContent = 'Data preview is not available for this document yet.';
      }
      if (manualEditorMeta) {
        manualEditorMeta.hidden = true;
      }
      return;
    }

    if (manualEditorSubtitle) {
      const schemaLabel = schema.title || 'this document';
      manualEditorSubtitle.textContent = `Previewing structured data for ${schemaLabel}`;
    }

    if (manualEditorMetaDoc || manualEditorMetaSchema) {
      const raw = ensureObject(manualEditorFile?.raw);
      const docParts = [];
      if (manualEditorFile?.title) docParts.push(manualEditorFile.title);
      if (raw?.originalName && raw.originalName !== manualEditorFile?.title) docParts.push(raw.originalName);
      if (!docParts.length && manualEditorFile?.fileId) docParts.push(`ID ${manualEditorFile.fileId}`);
      if (manualEditorMetaDoc) {
        manualEditorMetaDoc.textContent = docParts.join(' • ') || 'Document details';
      }
      if (manualEditorMetaSchema) {
        manualEditorMetaSchema.textContent = schema.title || 'Schema';
      }
    }

    schema.sections.forEach((section) => {
      const element = section.type === 'array'
        ? renderManualEditorArraySection(section, data)
        : renderManualEditorSection(section, data);
      manualEditorSections.appendChild(element);
    });

    manualEditorForm.hidden = false;

    const requiresManual = Array.isArray(processing?.requiresManualFields)
      ? processing.requiresManualFields.filter((field) => typeof field === 'string' && field.trim())
      : [];
    if (manualEditorMessage) {
      if (requiresManual.length) {
        manualEditorMessage.innerHTML = `<strong>Additional review required:</strong> Add values for ${requiresManual.join(', ')} so analytics stay accurate.`;
        manualEditorMessage.hidden = false;
      } else if (!manualEditorMessage.innerHTML) {
        manualEditorMessage.innerHTML = '<strong>Review extracted data:</strong> Validate the values below before saving to keep dashboards trustworthy.';
        manualEditorMessage.hidden = false;
      }
    }

    if (manualEditorMetaStatus) {
      if (requiresManual.length) {
        manualEditorMetaStatus.textContent = `${requiresManual.length} field${requiresManual.length === 1 ? '' : 's'} need attention`;
        manualEditorMetaStatus.dataset.state = 'warning';
        if (manualEditorMetaStatusContainer) {
          manualEditorMetaStatusContainer.dataset.state = 'warning';
        }
      } else {
        manualEditorMetaStatus.textContent = 'All fields ready for analytics';
        manualEditorMetaStatus.dataset.state = 'success';
        if (manualEditorMetaStatusContainer) {
          manualEditorMetaStatusContainer.dataset.state = 'success';
        }
      }
    }
    if (manualEditorMeta) {
      manualEditorMeta.hidden = false;
    }
  }

  function renderManualEditorSection(section, data) {
    const wrapper = document.createElement('section');
    wrapper.className = 'manual-editor__section';
    wrapper.dataset.sectionId = section.id || section.title || '';

    const header = document.createElement('div');
    header.className = 'manual-editor__section-header';
    if (section.title) {
      const heading = document.createElement('h5');
      heading.className = 'manual-editor__section-title';
      heading.textContent = section.title;
      header.appendChild(heading);
    }
    if (section.description) {
      const description = document.createElement('p');
      description.className = 'manual-editor__section-description';
      description.textContent = section.description;
      header.appendChild(description);
    }
    wrapper.appendChild(header);

    const body = document.createElement('div');
    body.className = 'manual-editor__section-body';
    section.fields.forEach((field) => {
      const value = getValueAtPath(data, field.path);
      const fieldElement = renderManualEditorField(field, value, field.path);
      body.appendChild(fieldElement);
    });
    wrapper.appendChild(body);

    return wrapper;
  }

  function renderManualEditorArraySection(section, data) {
    const wrapper = document.createElement('section');
    wrapper.className = 'manual-editor__section manual-editor__section--array';
    wrapper.dataset.sectionId = section.id || section.title || '';

    const header = document.createElement('div');
    header.className = 'manual-editor__section-header';
    if (section.title) {
      const heading = document.createElement('h5');
      heading.className = 'manual-editor__section-title';
      heading.textContent = section.title;
      header.appendChild(heading);
    }
    if (section.description) {
      const description = document.createElement('p');
      description.className = 'manual-editor__section-description';
      description.textContent = section.description;
      header.appendChild(description);
    }
    wrapper.appendChild(header);

    const container = document.createElement('div');
    container.className = 'manual-editor__array';
    container.dataset.arrayPath = section.path;

    const values = getValueAtPath(data, section.path);
    const entries = Array.isArray(values) && values.length ? values : [{}];
    entries.forEach((entry, index) => {
      container.appendChild(renderManualEditorArrayItem(section, entry, index));
    });

    wrapper.appendChild(container);

    const actions = document.createElement('div');
    actions.className = 'manual-editor__array-actions';
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'manual-editor__add';
    addButton.dataset.action = 'add-array-item';
    addButton.dataset.arrayPath = section.path;
    addButton.textContent = section.addLabel || 'Add item';
    actions.appendChild(addButton);
    wrapper.appendChild(actions);

    return wrapper;
  }

  function renderManualEditorArrayItem(section, itemData, index) {
    const item = document.createElement('div');
    item.className = 'manual-editor__array-item';
    item.dataset.arrayPath = section.path;
    item.dataset.arrayIndex = String(index);

    const header = document.createElement('div');
    header.className = 'manual-editor__array-item-header';
    const title = document.createElement('h6');
    title.className = 'manual-editor__array-item-title';
    title.textContent = section.itemLabel ? `${section.itemLabel} ${index + 1}` : `Item ${index + 1}`;
    header.appendChild(title);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'manual-editor__remove';
    remove.dataset.action = 'remove-array-item';
    remove.dataset.arrayPath = section.path;
    remove.dataset.arrayIndex = String(index);
    remove.textContent = 'Remove';
    header.appendChild(remove);
    item.appendChild(header);

    const body = document.createElement('div');
    body.className = 'manual-editor__section-body';
    section.fields.forEach((field) => {
      const fullPath = `${section.path}[${index}].${field.path}`;
      const value = getValueAtPath(itemData, field.path);
      const fieldElement = renderManualEditorField(field, value, fullPath, { relativePath: field.path });
      body.appendChild(fieldElement);
    });
    item.appendChild(body);

    return item;
  }

  function renderManualEditorField(field, value, fullPath, options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'manual-editor__field';
    wrapper.dataset.fieldPath = fullPath;
    if (options.relativePath) {
      wrapper.dataset.relativePath = options.relativePath;
    }

    const label = document.createElement('label');
    label.className = 'manual-editor__label';
    const inputId = `manual-editor-${fullPath.replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`;
    label.setAttribute('for', inputId);
    label.textContent = field.required ? `${field.label} *` : field.label;
    wrapper.appendChild(label);

    const control = createManualEditorInput(field, value, fullPath, inputId, options);
    wrapper.appendChild(control);

    const error = document.createElement('div');
    error.className = 'manual-editor__error';
    error.dataset.fieldError = fullPath;
    wrapper.appendChild(error);

    return wrapper;
  }

  function formatNumericDisplay(value, format) {
    if (value == null || value === '') return '';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '');
    if (format === 'integer') return String(Math.trunc(number));
    if (format === 'currency') return number.toFixed(2);
    return String(number);
  }

  function createManualEditorInput(field, value, fullPath, id, options = {}) {
    const type = field.type || 'text';
    let control;
    if (type === 'textarea') {
      control = document.createElement('textarea');
      control.className = 'manual-editor__input manual-editor__input--textarea';
      control.rows = field.rows || 3;
      control.value = value != null ? String(value) : '';
    } else if (type === 'number') {
      const format = field.format || 'currency';
      control = document.createElement('input');
      control.type = 'text';
      control.className = 'manual-editor__input';
      control.inputMode = format === 'integer' ? 'numeric' : 'decimal';
      if (format === 'integer') {
        control.pattern = '^-?\\d+$';
        if (!field.placeholder) control.placeholder = '0';
      } else {
        control.pattern = format === 'currency' ? '^-?\\d*(?:\\.\\d{0,2})?$' : '^-?\\d*(?:\\.\\d{0,4})?$';
        if (!field.placeholder) control.placeholder = format === 'currency' ? '0.00' : '0.0';
      }
      control.value = formatNumericDisplay(value, format);
      control.dataset.fieldFormat = format;
    } else if (type === 'date') {
      control = document.createElement('input');
      control.type = 'date';
      control.className = 'manual-editor__input';
      control.value = formatDateInput(value);
    } else if (type === 'month') {
      control = document.createElement('input');
      control.type = 'text';
      control.className = 'manual-editor__input manual-editor__input--month';
      control.inputMode = 'numeric';
      control.pattern = '^(0[1-9]|1[0-2])\\/\\d{4}$';
      control.maxLength = 7;
      if (!field.placeholder) control.placeholder = 'MM/YYYY';
      const monthKey = formatMonthInput(value);
      control.value = monthKey ? toDisplayMonth(monthKey) || '' : '';
      control.addEventListener('blur', () => {
        const key = formatMonthInput(control.value);
        control.value = key ? toDisplayMonth(key) || '' : control.value;
      });
    } else if (type === 'select') {
      control = document.createElement('select');
      control.className = 'manual-editor__input manual-editor__input--select';
      const optionsList = Array.isArray(field.options) ? field.options : [];
      optionsList.forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        control.appendChild(option);
      });
      control.value = value != null ? String(value) : '';
    } else {
      control = document.createElement('input');
      control.type = 'text';
      control.className = 'manual-editor__input';
      control.value = value != null ? String(value) : '';
    }

    control.id = id;
    control.dataset.fieldPath = fullPath;
    control.dataset.fieldType = type;
    if (options.relativePath) {
      control.dataset.relativePath = options.relativePath;
    }
    if (field.placeholder) {
      control.placeholder = field.placeholder;
    }

    return control;
  }

  function getValueAtPath(source, path) {
    if (!source || !path) return undefined;
    const tokens = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current = source;
    for (const token of tokens) {
      if (current == null) return undefined;
      current = current[token];
    }
    return current;
  }

  function setValueAtPath(target, path, value) {
    if (!target || !path) return;
    const tokens = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current = target;
    tokens.forEach((token, index) => {
      if (index === tokens.length - 1) {
        current[token] = value;
        return;
      }
      if (!current[token] || typeof current[token] !== 'object') {
        const nextToken = tokens[index + 1];
        current[token] = Number.isInteger(Number(nextToken)) ? [] : {};
      }
      current = current[token];
    });
  }

  function formatDateInput(value) {
    if (!value) return '';
    const str = String(value).trim();
    if (!str) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    if (/^\d{4}-\d{2}$/.test(str)) return `${str}-01`;
    if (/^\d{2}\/\d{4}$/.test(str)) {
      const [month, year] = str.split('/');
      return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-01`;
    }
    const parsed = new Date(str);
    if (Number.isNaN(parsed.valueOf())) return '';
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
  }

  function formatMonthInput(value) {
    if (!value) return '';
    const str = String(value).trim();
    if (!str) return '';
    if (/^\d{4}-\d{2}$/.test(str)) return str;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str.slice(0, 7);
    if (/^\d{2}\/\d{4}$/.test(str)) {
      const [month, year] = str.split('/');
      return `${year.padStart(4, '0')}-${month.padStart(2, '0')}`;
    }
    const parsed = new Date(str);
    if (Number.isNaN(parsed.valueOf())) return '';
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function toIsoDateString(value) {
    const formatted = formatDateInput(value);
    return formatted || null;
  }

  function toMonthKey(value) {
    const formatted = formatMonthInput(value);
    return formatted || null;
  }

  function toDisplayMonth(monthKey) {
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return null;
    const [year, month] = monthKey.split('-');
    return `${month}/${year}`;
  }

  function normaliseMonthInputValue(value) {
    const monthKey = toMonthKey(value);
    if (!monthKey) {
      return { monthKey: null, display: null, iso: null };
    }
    return {
      monthKey,
      display: toDisplayMonth(monthKey),
      iso: `${monthKey}-01`,
    };
  }

  function safeNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function collectManualEditorData() {
    const schema = manualEditorSchemaKey ? MANUAL_EDITOR_SCHEMAS[manualEditorSchemaKey] : null;
    const errors = [];
    const form = {};
    if (!schema) {
      errors.push({ path: '', message: 'Unsupported schema.' });
      return { form, errors };
    }

    schema.sections.forEach((section) => {
      if (section.type === 'array') {
        const values = collectManualEditorArray(section, errors);
        if (values.length) {
          setValueAtPath(form, section.path, values);
        }
      } else {
        section.fields.forEach((field) => {
          const value = readManualEditorField(field, field.path, errors);
          if (typeof value !== 'undefined') {
            setValueAtPath(form, field.path, value);
          }
        });
      }
    });

    return { form, errors };
  }

  function collectManualEditorArray(section, errors) {
    const container = manualEditorSections?.querySelector(`.manual-editor__array[data-array-path="${section.path}"]`);
    if (!container) return [];
    const items = Array.from(container.querySelectorAll('[data-array-index]'));
    const results = [];
    items.forEach((item) => {
      const index = Number(item.dataset.arrayIndex);
      const record = {};
      const hasInputValue = section.fields.some((field) => {
        const fullPath = `${section.path}[${index}].${field.path}`;
        const input = manualEditorSections?.querySelector(`[data-field-path="${fullPath}"]`);
        return input && input.value.trim();
      });
      if (!hasInputValue) {
        return;
      }
      section.fields.forEach((field) => {
        const fullPath = `${section.path}[${index}].${field.path}`;
        const value = readManualEditorField(field, fullPath, errors);
        if (typeof value !== 'undefined') {
          setValueAtPath(record, field.path, value);
        }
      });
      if (Object.keys(record).length) {
        results.push(record);
      }
    });
    return results;
  }

  function readManualEditorField(field, fullPath, errors, options = {}) {
    const input = manualEditorSections?.querySelector(`[data-field-path="${fullPath}"]`);
    if (!input) return undefined;
    const type = input.dataset.fieldType || field.type || 'text';
    const raw = input.value != null ? input.value.trim() : '';
    if (!raw) {
      if (field.required && !options.allowBlank) {
        showManualEditorFieldError(fullPath, 'This field is required.');
        errors.push({ path: fullPath, message: 'This field is required.' });
      }
      return undefined;
    }

    if (type === 'number') {
      const format = input.dataset.fieldFormat || field.format || 'decimal';
      const normalised = raw.replace(/[\s,]+/g, '');
      if (format === 'integer') {
        if (!/^-?\d+$/.test(normalised)) {
          showManualEditorFieldError(fullPath, 'Enter a whole number.');
          errors.push({ path: fullPath, message: 'Enter a whole number.' });
          return undefined;
        }
        return Number(normalised);
      }
      const pattern = format === 'currency'
        ? /^-?(?:\d+|\d*\.\d{1,2})$/
        : /^-?(?:\d+|\d*\.\d{1,4})$/;
      if (!pattern.test(normalised)) {
        const message = format === 'currency'
          ? 'Enter a valid currency amount (e.g. 1234.56).'
          : 'Enter a valid number.';
        showManualEditorFieldError(fullPath, message);
        errors.push({ path: fullPath, message });
        return undefined;
      }
      return Number(normalised);
    }

    if (type === 'date') {
      const iso = toIsoDateString(raw);
      if (!iso) {
        showManualEditorFieldError(fullPath, 'Enter a valid date.');
        errors.push({ path: fullPath, message: 'Enter a valid date.' });
        return undefined;
      }
      return iso;
    }

    if (type === 'month') {
      const monthKey = toMonthKey(raw);
      if (!monthKey) {
        showManualEditorFieldError(fullPath, 'Enter a valid month.');
        errors.push({ path: fullPath, message: 'Enter a valid month.' });
        return undefined;
      }
      return monthKey;
    }

    if (type === 'select') {
      if (!raw) {
        if (field.required && !options.allowBlank) {
          showManualEditorFieldError(fullPath, 'Please choose an option.');
          errors.push({ path: fullPath, message: 'Please choose an option.' });
        }
        return undefined;
      }
      return raw;
    }

    return raw;
  }

  function showManualEditorFieldError(path, message) {
    const field = manualEditorSections?.querySelector(`.manual-editor__field[data-field-path="${path}"]`);
    if (!field) return;
    field.classList.add('has-error');
    const error = field.querySelector('.manual-editor__error');
    if (error) error.textContent = message;
  }

  function clearManualEditorFieldError(path) {
    const field = manualEditorSections?.querySelector(`.manual-editor__field[data-field-path="${path}"]`);
    if (!field) return;
    field.classList.remove('has-error');
    const error = field.querySelector('.manual-editor__error');
    if (error) error.textContent = '';
  }

  function clearManualEditorErrors() {
    if (!manualEditorSections) return;
    manualEditorSections.querySelectorAll('.manual-editor__field').forEach((field) => {
      field.classList.remove('has-error');
    });
    manualEditorSections.querySelectorAll('.manual-editor__error').forEach((error) => {
      error.textContent = '';
    });
    if (manualEditorError) {
      manualEditorError.hidden = true;
      manualEditorError.textContent = '';
    }
  }

  function highlightServerValidation(details) {
    if (!Array.isArray(details)) return;
    details.forEach((detail) => {
      const serverPath = typeof detail.path === 'string' ? detail.path : '';
      const message = detail.message || 'Invalid value.';
      const mapped = mapServerPathToFormPath(manualEditorSchemaKey, serverPath);
      highlightPathError(mapped, message);
    });
  }

  function highlightPathError(path, message) {
    if (!path) return;
    showManualEditorFieldError(path, message);
  }

  function mapServerPathToFormPath(schemaKey, path) {
    if (!path) return path;
    if (schemaKey === 'bank_statement') {
      let mapped = path.replace(/^metadata\./, '');
      mapped = mapped.replace(/^metrics\.(openingBalance|closingBalance|totalMoneyIn|totalMoneyOut|overdraftLimit)/, 'balances.$1');
      mapped = mapped.replace(/^metrics\.averageBalances\./, 'balances.averageBalances.');
      mapped = mapped.replace(/^metrics\.period\.start/, 'statement.period.startDate');
      mapped = mapped.replace(/^metrics\.period\.end/, 'statement.period.endDate');
      mapped = mapped.replace(/^metrics\.period\.month/, 'statement.period.Date');
      mapped = mapped.replace(/^metrics\.currency/, 'account.currency');
      mapped = mapped.replace(/^period\.start$/, 'statement.period.startDate');
      mapped = mapped.replace(/^period\.end$/, 'statement.period.endDate');
      mapped = mapped.replace(/^period\.(Date|month)$/, 'statement.period.Date');
      mapped = mapped.replace(/^metadata\.documentMonth/, 'statement.period.Date');
      mapped = mapped.replace(/^metadata\.documentDate/, 'statement.period.endDate');
      return mapped;
    }
    if (schemaKey === 'payslip') {
      let mapped = path.replace(/^metadata\./, '');
      mapped = mapped.replace(/^metrics\.(grossPeriod|netPeriod|grossYtd|netYtd)/, 'totals.$1');
      mapped = mapped.replace(/^metrics\.payDate/, 'period.Date');
      mapped = mapped.replace(/^metrics\.period\.start/, 'period.start');
      mapped = mapped.replace(/^metrics\.period\.end/, 'period.end');
      mapped = mapped.replace(/^metrics\.period\.payFrequency/, 'period.payFrequency');
      mapped = mapped.replace(/^metrics\.currency/, 'currency');
      mapped = mapped.replace(/^metadata\.documentMonth/, 'period.Date');
      mapped = mapped.replace(/^metadata\.documentDate/, 'period.Date');
      return mapped;
    }
    return path;
  }

  function handleManualEditorClick(event) {
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;
    const { action } = actionTarget.dataset;
    if (action === 'add-array-item') {
      event.preventDefault();
      addManualEditorArrayItem(actionTarget.dataset.arrayPath || '');
    } else if (action === 'remove-array-item') {
      event.preventDefault();
      removeManualEditorArrayItem(actionTarget.dataset.arrayPath || '', Number(actionTarget.dataset.arrayIndex));
    }
  }

  function addManualEditorArrayItem(path) {
    if (!path) return;
    const schema = MANUAL_EDITOR_SCHEMAS[manualEditorSchemaKey];
    const section = schema?.sections.find((item) => item.type === 'array' && item.path === path);
    if (!section) return;
    const container = manualEditorSections?.querySelector(`.manual-editor__array[data-array-path="${path}"]`);
    if (!container) return;
    const nextIndex = container.querySelectorAll('[data-array-index]').length;
    container.appendChild(renderManualEditorArrayItem(section, {}, nextIndex));
  }

  function removeManualEditorArrayItem(path, index) {
    if (!path || Number.isNaN(index)) return;
    const container = manualEditorSections?.querySelector(`.manual-editor__array[data-array-path="${path}"]`);
    if (!container) return;
    const item = container.querySelector(`[data-array-index="${index}"]`);
    if (!item) return;
    item.remove();
    reindexManualEditorArrayItems(path);
  }

  function reindexManualEditorArrayItems(path) {
    const container = manualEditorSections?.querySelector(`.manual-editor__array[data-array-path="${path}"]`);
    if (!container) return;
    const items = Array.from(container.querySelectorAll('[data-array-index]'));
    items.forEach((item, index) => {
      item.dataset.arrayIndex = String(index);
      const header = item.querySelector('.manual-editor__array-item-title');
      if (header) {
        header.textContent = header.textContent.replace(/\d+$/, String(index + 1));
      }
      const remove = item.querySelector('[data-action="remove-array-item"]');
      if (remove) {
        remove.dataset.arrayIndex = String(index);
      }
      item.querySelectorAll('[data-field-path]').forEach((input) => {
        const relative = input.dataset.relativePath;
        if (!relative) return;
        const newPath = `${path}[${index}].${relative}`;
        input.dataset.fieldPath = newPath;
        const wrapper = input.closest('.manual-editor__field');
        if (wrapper) {
          wrapper.dataset.fieldPath = newPath;
          const error = wrapper.querySelector('.manual-editor__error');
          if (error) error.dataset.fieldError = newPath;
          const label = wrapper.querySelector('label');
          const newId = `manual-editor-${newPath.replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`;
          if (label) label.setAttribute('for', newId);
          input.id = newId;
        }
      });
    });
  }

  function handleManualEditorChange(event) {
    const input = event.target.closest('[data-field-path]');
    if (!input) return;
    clearManualEditorFieldError(input.dataset.fieldPath);
  }

  function handleManualEditorSubmit(event) {
    event.preventDefault();
    clearManualEditorErrors();
    if (!manualEditorDocId) {
      manualEditorError.hidden = false;
      manualEditorError.textContent = 'Document identifier missing. Close and try again.';
      return;
    }
    if (!manualEditorSchemaKey || !MANUAL_EDITOR_SCHEMAS[manualEditorSchemaKey]) {
      manualEditorError.hidden = false;
      manualEditorError.textContent = 'This document type cannot be edited manually yet.';
      return;
    }

    const { form, errors } = collectManualEditorData();
    if (errors.length) {
      manualEditorError.hidden = false;
      manualEditorError.textContent = 'Please fix the highlighted fields.';
      return;
    }

    manualEditorFormData = form;
    const payload = buildManualPayload(manualEditorSchemaKey, form);
    submitManualEditorPayload(payload).catch((error) => {
      manualEditorError.hidden = false;
      manualEditorError.textContent = error.message || 'Unable to save changes right now.';
    });
  }

  function buildManualPayload(schemaKey, form) {
    if (schemaKey === 'bank_statement') return buildBankStatementPayload(form);
    if (schemaKey === 'payslip') return buildPayslipPayload(form);
    return { metadata: form.metadata || {}, metrics: form.metrics || {}, transactions: [], narrative: [] };
  }

  function buildBankStatementPayload(form) {
    const institutionForm = ensureObject(form.institution);
    const contactInfoForm = ensureObject(institutionForm.contactInfo);
    const institution = {};
    if (typeof institutionForm.name === 'string') institution.name = institutionForm.name;
    if (typeof institutionForm.address === 'string') institution.address = institutionForm.address;
    if (typeof institutionForm.swiftBic === 'string') institution.swiftBic = institutionForm.swiftBic;
    const contactInfo = {};
    if (typeof contactInfoForm.telephone === 'string') contactInfo.telephone = contactInfoForm.telephone;
    if (typeof contactInfoForm.website === 'string') contactInfo.website = contactInfoForm.website;
    if (Object.keys(contactInfo).length) institution.contactInfo = contactInfo;

    const accountForm = ensureObject(form.account);
    const holderAddressForm = ensureObject(accountForm.holderAddress);
    const account = {};
    if (typeof accountForm.holderName === 'string') account.holderName = accountForm.holderName;
    const holderAddress = {};
    if (typeof holderAddressForm.street === 'string') holderAddress.street = holderAddressForm.street;
    if (typeof holderAddressForm.city === 'string') holderAddress.city = holderAddressForm.city;
    if (typeof holderAddressForm.postalCode === 'string') holderAddress.postalCode = holderAddressForm.postalCode;
    if (Object.keys(holderAddress).length) account.holderAddress = holderAddress;
    if (typeof accountForm.accountNumber === 'string') account.accountNumber = accountForm.accountNumber;
    if (typeof accountForm.sortCode === 'string') account.sortCode = accountForm.sortCode;
    if (typeof accountForm.iban === 'string') account.iban = accountForm.iban;
    if (typeof accountForm.type === 'string') account.type = accountForm.type;
    if (typeof accountForm.currency === 'string') account.currency = accountForm.currency;

    const statementForm = ensureObject(form.statement);
    const periodForm = ensureObject(statementForm.period);
    const startIso = toIsoDateString(periodForm.startDate);
    const endIso = toIsoDateString(periodForm.endDate);
    const monthInfo = normaliseMonthInputValue(periodForm.Date || endIso || startIso);
    const statement = {};
    if (typeof statementForm.statementNumber === 'string') statement.statementNumber = statementForm.statementNumber;
    statement.period = {
      startDate: startIso || null,
      endDate: endIso || null,
      Date: monthInfo.display,
    };

    const balancesForm = ensureObject(form.balances);
    const averageBalancesForm = ensureObject(balancesForm.averageBalances);
    const balances = {};
    if (balancesForm.openingBalance != null) balances.openingBalance = safeNumber(balancesForm.openingBalance);
    if (balancesForm.closingBalance != null) balances.closingBalance = safeNumber(balancesForm.closingBalance);
    if (balancesForm.totalMoneyIn != null) balances.totalMoneyIn = safeNumber(balancesForm.totalMoneyIn);
    if (balancesForm.totalMoneyOut != null) balances.totalMoneyOut = safeNumber(balancesForm.totalMoneyOut);
    if (balancesForm.overdraftLimit != null) balances.overdraftLimit = safeNumber(balancesForm.overdraftLimit);
    const averageBalances = {};
    if (averageBalancesForm.averageCreditBalance != null) {
      averageBalances.averageCreditBalance = safeNumber(averageBalancesForm.averageCreditBalance);
    }
    if (averageBalancesForm.averageDebitBalance != null) {
      averageBalances.averageDebitBalance = safeNumber(averageBalancesForm.averageDebitBalance);
    }
    if (Object.keys(averageBalances).length) balances.averageBalances = averageBalances;

    const interestForm = ensureObject(form.interestInformation);
    const interestPaidForm = ensureObject(interestForm.interestPaid);
    const interestInformation = {};
    if (typeof interestForm.creditInterestRate === 'string') {
      interestInformation.creditInterestRate = interestForm.creditInterestRate;
    }
    if (typeof interestForm.overdraftInterestRate === 'string') {
      interestInformation.overdraftInterestRate = interestForm.overdraftInterestRate;
    }
    const interestPaid = {};
    const interestPaidDate = toIsoDateString(interestPaidForm.date);
    if (interestPaidDate) interestPaid.date = interestPaidDate;
    if (typeof interestPaidForm.description === 'string') interestPaid.description = interestPaidForm.description;
    if (interestPaidForm.amount != null) interestPaid.amount = safeNumber(interestPaidForm.amount);
    if (Object.keys(interestPaid).length) interestInformation.interestPaid = interestPaid;

    const additionalForm = ensureObject(form.additionalInformation);
    const additionalInformation = {};
    if (typeof additionalForm.fscsInformation === 'string') {
      additionalInformation.fscsInformation = additionalForm.fscsInformation;
    }
    const surveyForm = ensureObject(additionalForm.serviceQualitySurvey);
    const serviceQualitySurvey = {};
    if (typeof surveyForm.region === 'string') serviceQualitySurvey.region = surveyForm.region;
    if (typeof surveyForm.ranking === 'string') serviceQualitySurvey.ranking = surveyForm.ranking;
    if (typeof surveyForm.score === 'string') serviceQualitySurvey.score = surveyForm.score;
    if (Object.keys(serviceQualitySurvey).length) {
      additionalInformation.serviceQualitySurvey = serviceQualitySurvey;
    }
    const newsItems = Array.isArray(additionalForm.news)
      ? additionalForm.news
          .map((item) => ({
            title: typeof item.title === 'string' ? item.title : '',
            content: typeof item.content === 'string' ? item.content : '',
          }))
          .filter((item) => item.title || item.content)
      : [];
    if (newsItems.length) {
      additionalInformation.news = newsItems;
    }

    const metadata = {
      manualSchema: 'bank_statement',
      institution,
      account,
      statement,
      balances,
      interestInformation,
      additionalInformation,
    };

    metadata.period = {
      start: startIso || null,
      end: endIso || null,
      month: monthInfo.monthKey,
      display: monthInfo.display,
    };

    metadata.currency = typeof account.currency === 'string' ? account.currency : null;
    metadata.documentDate = endIso || startIso || monthInfo.iso;
    metadata.documentMonth = monthInfo.monthKey;
    metadata.displayMonth = monthInfo.display;

    const metrics = {
      currency: metadata.currency || null,
      openingBalance: safeNumber(balances.openingBalance),
      closingBalance: safeNumber(balances.closingBalance),
      totalMoneyIn: safeNumber(balances.totalMoneyIn),
      totalMoneyOut: safeNumber(balances.totalMoneyOut),
      overdraftLimit: safeNumber(balances.overdraftLimit),
      averageBalances,
      period: {
        start: startIso || null,
        end: endIso || null,
        month: monthInfo.monthKey,
        display: monthInfo.display,
      },
    };

    const transactions = Array.isArray(form.transactions)
      ? form.transactions
          .map((entry) => {
            const date = toIsoDateString(entry.date);
            const moneyIn = safeNumber(entry.moneyIn);
            const moneyOut = safeNumber(entry.moneyOut);
            const balance = safeNumber(entry.balance);
            const record = {};
            if (date) record.date = date;
            if (entry.description) record.description = String(entry.description);
            if (moneyIn != null) record.moneyIn = moneyIn;
            if (moneyOut != null) record.moneyOut = moneyOut;
            if (balance != null) record.balance = balance;
            if (entry.transactionType) record.transactionType = entry.transactionType;
            if (entry.paymentMethod) record.paymentMethod = String(entry.paymentMethod);
            if (entry.counterparty) record.counterparty = String(entry.counterparty);
            if (entry.reference) record.reference = String(entry.reference);
            if (!Object.keys(record).length) return null;
            if (moneyIn != null || moneyOut != null) {
              const amount = (moneyIn || 0) - (moneyOut || 0);
              if (amount !== 0) {
                record.amount = amount;
                record.direction = amount >= 0 ? 'inflow' : 'outflow';
              }
            }
            if (account.accountNumber) record.accountNumber = account.accountNumber;
            if (metadata.currency) record.currency = metadata.currency;
            return record;
          })
          .filter(Boolean)
      : [];

    return { metadata, metrics, transactions, narrative: [] };
  }

  function buildPayslipPayload(form) {
    const employeeForm = ensureObject(form.employee);
    const employeeAddressForm = ensureObject(employeeForm.address);
    const employee = {};
    if (typeof employeeForm.fullName === 'string') employee.fullName = employeeForm.fullName;
    if (typeof employeeForm.employeeId === 'string') employee.employeeId = employeeForm.employeeId;
    if (typeof employeeForm.niNumber === 'string') employee.niNumber = employeeForm.niNumber;
    if (typeof employeeForm.taxCode === 'string') employee.taxCode = employeeForm.taxCode;
    if (typeof employeeForm.niCategory === 'string') employee.niCategory = employeeForm.niCategory;
    const employeeAddress = {};
    if (typeof employeeAddressForm.street === 'string') employeeAddress.street = employeeAddressForm.street;
    if (typeof employeeAddressForm.city === 'string') employeeAddress.city = employeeAddressForm.city;
    if (typeof employeeAddressForm.county === 'string') employeeAddress.county = employeeAddressForm.county;
    if (typeof employeeAddressForm.postcode === 'string') employeeAddress.postcode = employeeAddressForm.postcode;
    if (Object.keys(employeeAddress).length) employee.address = employeeAddress;

    const employerForm = ensureObject(form.employer);
    const employer = {};
    if (typeof employerForm.name === 'string') employer.name = employerForm.name;
    if (typeof employerForm.taxDistrict === 'string') employer.taxDistrict = employerForm.taxDistrict;
    if (typeof employerForm.taxReference === 'string') employer.taxReference = employerForm.taxReference;
    if (employerForm.employersNicThisPeriod != null) {
      employer.employersNicThisPeriod = safeNumber(employerForm.employersNicThisPeriod);
    }
    if (employerForm.employersNicYtd != null) {
      employer.employersNicYtd = safeNumber(employerForm.employersNicYtd);
    }
    if (employerForm.employersPensionThisPeriod != null) {
      employer.employersPensionThisPeriod = safeNumber(employerForm.employersPensionThisPeriod);
    }
    if (employerForm.employersPensionYtd != null) {
      employer.employersPensionYtd = safeNumber(employerForm.employersPensionYtd);
    }

    const periodForm = ensureObject(form.period);
    const payFrequency = typeof periodForm.payFrequency === 'string' ? periodForm.payFrequency : null;
    const monthInfo = normaliseMonthInputValue(periodForm.Date || periodForm.end || periodForm.start);
    const payDateIso = monthInfo.iso;
    const periodStartIso = toIsoDateString(periodForm.start);
    const periodEndIso = toIsoDateString(periodForm.end);
    const period = {
      Date: monthInfo.display,
      start: periodStartIso || null,
      end: periodEndIso || null,
      payFrequency,
      month: monthInfo.monthKey,
      display: monthInfo.display,
    };

    const earnings = Array.isArray(form.earnings)
      ? form.earnings
          .map((item) => ({
            rawLabel: typeof item.rawLabel === 'string' ? item.rawLabel : '',
            category: typeof item.category === 'string' ? item.category : '',
            amountPeriod: safeNumber(item.amountPeriod),
            amountYtd: safeNumber(item.amountYtd),
          }))
          .filter((item) => item.rawLabel || item.category)
      : [];

    const deductions = Array.isArray(form.deductions)
      ? form.deductions
          .map((item) => ({
            rawLabel: typeof item.rawLabel === 'string' ? item.rawLabel : '',
            category: typeof item.category === 'string' ? item.category : '',
            amountPeriod: safeNumber(item.amountPeriod),
            amountYtd: safeNumber(item.amountYtd),
          }))
          .filter((item) => item.rawLabel || item.category)
      : [];

    const totalsForm = ensureObject(form.totals);
    const totals = {};
    if (totalsForm.grossPeriod != null) totals.grossPeriod = safeNumber(totalsForm.grossPeriod);
    if (totalsForm.netPeriod != null) totals.netPeriod = safeNumber(totalsForm.netPeriod);
    if (totalsForm.grossYtd != null) totals.grossYtd = safeNumber(totalsForm.grossYtd);
    if (totalsForm.netYtd != null) totals.netYtd = safeNumber(totalsForm.netYtd);

    const metaForm = ensureObject(form.meta);
    const meta = {};
    if (typeof metaForm.documentId === 'string') meta.documentId = metaForm.documentId;
    if (metaForm.confidence != null) meta.confidence = safeNumber(metaForm.confidence);

    const metadata = {
      manualSchema: 'payslip',
      employee,
      employer,
      period,
      currency: typeof form.currency === 'string' ? form.currency : null,
      earnings,
      deductions,
      totals,
      meta,
    };

    metadata.documentDate = payDateIso || periodEndIso || periodStartIso || monthInfo.iso;
    metadata.documentMonth = monthInfo.monthKey;
    metadata.displayMonth = monthInfo.display;

    const metrics = {
      currency: metadata.currency || null,
      grossPeriod: safeNumber(totals.grossPeriod),
      netPeriod: safeNumber(totals.netPeriod),
      grossYtd: safeNumber(totals.grossYtd),
      netYtd: safeNumber(totals.netYtd),
      payDate: payDateIso,
      period: {
        start: periodStartIso || null,
        end: periodEndIso || null,
        month: monthInfo.monthKey,
        display: monthInfo.display,
        payFrequency,
      },
    };

    return { metadata, metrics, transactions: [], narrative: [] };
  }

  function mapManualPayloadToForm(schemaKey, json) {
    if (schemaKey === 'bank_statement') return mapBankStatementPayloadToForm(json);
    if (schemaKey === 'payslip') return mapPayslipPayloadToForm(json);
    return {};
  }

  function mapBankStatementPayloadToForm(json) {
    const payload = ensureObject(json);
    const metadataSource = pickObjectLoose(
      payload.metadata,
      looseGet(payload, 'metadata'),
      looseGet(payload, 'data.metadata'),
      payload.data,
      payload
    );
    const metricsSource = pickObjectLoose(
      payload.metrics,
      looseGet(payload, 'metrics'),
      looseGet(payload, 'data.metrics'),
      looseGet(metadataSource, 'metrics')
    );
    const institutionSource = pickObjectLoose(
      looseGet(metadataSource, 'institution'),
      looseGet(metadataSource, 'institutionDetails'),
      looseGet(metadataSource, 'bank')
    );
    const contactSource = pickObjectLoose(
      looseGet(institutionSource, 'contactInfo'),
      looseGet(institutionSource, 'contactInformation'),
      looseGet(institutionSource, 'contact')
    );
    const accountSource = pickObjectLoose(
      looseGet(metadataSource, 'account'),
      looseGet(metadataSource, 'accountDetails')
    );
    const holderAddressSource = pickObjectLoose(
      looseGet(accountSource, 'holderAddress'),
      looseGet(accountSource, 'address'),
      looseGet(accountSource, 'ownerAddress'),
      looseGet(accountSource, 'holderAddressDetails')
    );
    const statementSource = pickObjectLoose(
      looseGet(metadataSource, 'statement'),
      looseGet(metadataSource, 'statementInfo'),
      looseGet(metadataSource, 'statementDetails'),
      metadataSource
    );
    const statementPeriodSource = pickObjectLoose(
      looseGet(statementSource, 'period'),
      looseGet(metadataSource, 'period'),
      looseGet(metricsSource, 'period')
    );
    const balancesSource = pickObjectLoose(
      looseGet(metadataSource, 'balances'),
      looseGet(metricsSource, 'balances')
    );
    const averageBalancesSource = pickObjectLoose(
      looseGet(balancesSource, 'averageBalances'),
      looseGet(metricsSource, 'averageBalances')
    );
    const interestSource = pickObjectLoose(
      looseGet(metadataSource, 'interestInformation'),
      looseGet(metadataSource, 'interestInfo'),
      looseGet(metadataSource, 'interest')
    );
    const interestPaidSource = pickObjectLoose(
      looseGet(interestSource, 'interestPaid'),
      looseGet(interestSource, 'interestPaidDetails'),
      looseGet(interestSource, 'paidInterest')
    );
    const additionalSource = pickObjectLoose(
      looseGet(metadataSource, 'additionalInformation'),
      looseGet(metadataSource, 'additionalInfo'),
      looseGet(metadataSource, 'supplementaryInformation'),
      looseGet(metadataSource, 'extras')
    );
    const surveySource = pickObjectLoose(
      looseGet(additionalSource, 'serviceQualitySurvey'),
      looseGet(additionalSource, 'serviceQuality'),
      looseGet(additionalSource, 'survey')
    );
    const rawTransactions = pickArrayLoose(
      payload.transactions,
      looseGet(payload, 'transactions'),
      looseGet(metadataSource, 'transactions'),
      looseGet(metricsSource, 'transactions')
    );
    const newsSource = pickArrayLoose(
      looseGet(additionalSource, 'news'),
      looseGet(additionalSource, 'newsItems'),
      looseGet(additionalSource, 'notices')
    );

    const periodStartRaw = firstDefined(
      looseGet(statementPeriodSource, 'startDate'),
      looseGet(statementPeriodSource, 'start'),
      looseGet(statementPeriodSource, 'from'),
      looseGet(metadataSource, 'period.start'),
      looseGet(metricsSource, 'period.start')
    );
    const periodEndRaw = firstDefined(
      looseGet(statementPeriodSource, 'endDate'),
      looseGet(statementPeriodSource, 'end'),
      looseGet(statementPeriodSource, 'to'),
      looseGet(metadataSource, 'period.end'),
      looseGet(metricsSource, 'period.end')
    );
    const periodMonthRaw = firstDefined(
      looseGet(statementPeriodSource, 'Date'),
      looseGet(statementPeriodSource, 'month'),
      looseGet(statementPeriodSource, 'statementMonth'),
      looseGet(statementPeriodSource, 'display'),
      looseGet(metadataSource, 'displayMonth'),
      looseGet(metadataSource, 'documentMonth'),
      looseGet(metricsSource, 'period.month'),
      looseGet(metricsSource, 'period.display')
    );
    const periodMonthKey = formatMonthInput(periodMonthRaw);

    const institution = {
      name: firstDefined(
        looseGet(institutionSource, 'name'),
        looseGet(metadataSource, 'institutionName')
      ) || '',
      address: firstDefined(
        looseGet(institutionSource, 'address'),
        looseGet(institutionSource, 'branchAddress'),
        looseGet(metadataSource, 'institutionAddress')
      ) || '',
      swiftBic: firstDefined(
        looseGet(institutionSource, 'swiftBic'),
        looseGet(institutionSource, 'swift'),
        looseGet(institutionSource, 'bic')
      ) || '',
      contactInfo: {
        telephone: firstDefined(
          looseGet(contactSource, 'telephone'),
          looseGet(contactSource, 'phone'),
          looseGet(contactSource, 'phoneNumber')
        ) || '',
        website: firstDefined(
          looseGet(contactSource, 'website'),
          looseGet(contactSource, 'url')
        ) || '',
      },
    };

    const account = {
      holderName: firstDefined(
        looseGet(accountSource, 'holderName'),
        looseGet(accountSource, 'accountHolder'),
        looseGet(accountSource, 'name')
      ) || '',
      holderAddress: {
        street: firstDefined(
          looseGet(holderAddressSource, 'street'),
          looseGet(holderAddressSource, 'line1'),
          looseGet(holderAddressSource, 'addressLine1')
        ) || '',
        city: firstDefined(
          looseGet(holderAddressSource, 'city'),
          looseGet(holderAddressSource, 'town')
        ) || '',
        postalCode: firstDefined(
          looseGet(holderAddressSource, 'postalCode'),
          looseGet(holderAddressSource, 'postcode'),
          looseGet(holderAddressSource, 'zip')
        ) || '',
      },
      accountNumber: firstDefined(
        looseGet(accountSource, 'accountNumber'),
        looseGet(accountSource, 'number')
      ) || '',
      sortCode: firstDefined(
        looseGet(accountSource, 'sortCode'),
        looseGet(accountSource, 'sortcode'),
        looseGet(accountSource, 'routingNumber')
      ) || '',
      iban: firstDefined(
        looseGet(accountSource, 'iban'),
        looseGet(accountSource, 'ibanNumber')
      ) || '',
      type: firstDefined(
        looseGet(accountSource, 'type'),
        looseGet(accountSource, 'accountType')
      ) || '',
      currency: firstDefined(
        looseGet(accountSource, 'currency'),
        looseGet(metadataSource, 'currency'),
        looseGet(metricsSource, 'currency')
      ) || '',
    };

    const statement = {
      statementNumber: firstDefined(
        looseGet(statementSource, 'statementNumber'),
        looseGet(statementSource, 'number'),
        looseGet(statementSource, 'id')
      ) || '',
      period: {
        startDate: formatDateInput(
          firstDefined(
            periodStartRaw,
            looseGet(metadataSource, 'period.start'),
            looseGet(metricsSource, 'period.start')
          )
        ),
        endDate: formatDateInput(
          firstDefined(
            periodEndRaw,
            looseGet(metadataSource, 'period.end'),
            looseGet(metricsSource, 'period.end')
          )
        ),
        Date: periodMonthKey ? toDisplayMonth(periodMonthKey) || '' : '',
      },
    };

    const balances = {
      openingBalance: normaliseNumericValue(
        firstDefined(
          looseGet(balancesSource, 'openingBalance'),
          looseGet(metricsSource, 'openingBalance')
        )
      ),
      closingBalance: normaliseNumericValue(
        firstDefined(
          looseGet(balancesSource, 'closingBalance'),
          looseGet(metricsSource, 'closingBalance')
        )
      ),
      totalMoneyIn: normaliseNumericValue(
        firstDefined(
          looseGet(balancesSource, 'totalMoneyIn'),
          looseGet(balancesSource, 'totalIn'),
          looseGet(metricsSource, 'totalMoneyIn')
        )
      ),
      totalMoneyOut: normaliseNumericValue(
        firstDefined(
          looseGet(balancesSource, 'totalMoneyOut'),
          looseGet(balancesSource, 'totalOut'),
          looseGet(metricsSource, 'totalMoneyOut')
        )
      ),
      overdraftLimit: normaliseNumericValue(
        firstDefined(
          looseGet(balancesSource, 'overdraftLimit'),
          looseGet(balancesSource, 'limit'),
          looseGet(metricsSource, 'overdraftLimit')
        )
      ),
      averageBalances: {
        averageCreditBalance: normaliseNumericValue(
          firstDefined(
            looseGet(averageBalancesSource, 'averageCreditBalance'),
            looseGet(averageBalancesSource, 'credit'),
            looseGet(metricsSource, 'averageBalances.averageCreditBalance')
          )
        ),
        averageDebitBalance: normaliseNumericValue(
          firstDefined(
            looseGet(averageBalancesSource, 'averageDebitBalance'),
            looseGet(averageBalancesSource, 'debit'),
            looseGet(metricsSource, 'averageBalances.averageDebitBalance')
          )
        ),
      },
    };

    const interestInformation = {
      creditInterestRate: firstDefined(
        looseGet(interestSource, 'creditInterestRate'),
        looseGet(interestSource, 'creditRate')
      ) || '',
      overdraftInterestRate: firstDefined(
        looseGet(interestSource, 'overdraftInterestRate'),
        looseGet(interestSource, 'overdraftRate')
      ) || '',
      interestPaid: {
        date: formatDateInput(
          firstDefined(
            looseGet(interestPaidSource, 'date'),
            looseGet(interestPaidSource, 'paidDate')
          )
        ),
        description: firstDefined(
          looseGet(interestPaidSource, 'description'),
          looseGet(interestPaidSource, 'label'),
          looseGet(interestPaidSource, 'note')
        ) || '',
        amount: normaliseNumericValue(
          firstDefined(
            looseGet(interestPaidSource, 'amount'),
            looseGet(interestPaidSource, 'value')
          )
        ),
      },
    };

    const transactions = rawTransactions.map((tx) => {
      const entry = ensureObject(tx);
      const amountValue = normaliseNumericValue(looseGet(entry, 'amount'));
      let moneyInValue = normaliseNumericValue(
        firstDefined(
          looseGet(entry, 'moneyIn'),
          looseGet(entry, 'credit'),
          looseGet(entry, 'creditAmount'),
          looseGet(entry, 'amountIn'),
          looseGet(entry, 'incoming')
        )
      );
      if (moneyInValue === '' && typeof amountValue === 'number' && amountValue > 0) {
        moneyInValue = amountValue;
      }
      let moneyOutValue = normaliseNumericValue(
        firstDefined(
          looseGet(entry, 'moneyOut'),
          looseGet(entry, 'debit'),
          looseGet(entry, 'debitAmount'),
          looseGet(entry, 'amountOut'),
          looseGet(entry, 'outgoing')
        )
      );
      if (moneyOutValue === '' && typeof amountValue === 'number' && amountValue < 0) {
        moneyOutValue = Math.abs(amountValue);
      }
      const balanceValue = normaliseNumericValue(
        firstDefined(
          looseGet(entry, 'balance'),
          looseGet(entry, 'runningBalance'),
          looseGet(entry, 'closingBalance')
        )
      );
      return {
        date: formatDateInput(
          firstDefined(
            looseGet(entry, 'date'),
            looseGet(entry, 'transactionDate'),
            looseGet(entry, 'postedDate')
          )
        ),
        description: (
          firstDefined(
            looseGet(entry, 'description'),
            looseGet(entry, 'details'),
            looseGet(entry, 'narrative'),
            looseGet(entry, 'note')
          ) || ''
        ).toString(),
        moneyIn: moneyInValue,
        moneyOut: moneyOutValue,
        balance: balanceValue,
        transactionType: firstDefined(
          looseGet(entry, 'transactionType'),
          looseGet(entry, 'type'),
          looseGet(entry, 'category')
        ) || '',
        paymentMethod: firstDefined(
          looseGet(entry, 'paymentMethod'),
          looseGet(entry, 'method')
        ) || '',
        counterparty: firstDefined(
          looseGet(entry, 'counterparty'),
          looseGet(entry, 'counterParty'),
          looseGet(entry, 'partner')
        ) || '',
        reference: firstDefined(
          looseGet(entry, 'reference'),
          looseGet(entry, 'ref'),
          looseGet(entry, 'id')
        ) || '',
      };
    });

    const additionalInformation = {
      fscsInformation: firstDefined(
        looseGet(additionalSource, 'fscsInformation'),
        looseGet(additionalSource, 'fscs'),
        looseGet(additionalSource, 'fscsDetails')
      ) || '',
      serviceQualitySurvey: {
        region: firstDefined(
          looseGet(surveySource, 'region'),
          looseGet(surveySource, 'area')
        ) || '',
        ranking: firstDefined(
          looseGet(surveySource, 'ranking'),
          looseGet(surveySource, 'position')
        ) || '',
        score: firstDefined(
          looseGet(surveySource, 'score'),
          looseGet(surveySource, 'result')
        ) || '',
      },
      news: newsSource
        .map((item) => {
          const entry = ensureObject(item);
          const title = firstDefined(
            looseGet(entry, 'title'),
            looseGet(entry, 'headline')
          ) || '';
          const content = firstDefined(
            looseGet(entry, 'content'),
            looseGet(entry, 'body'),
            looseGet(entry, 'summary')
          ) || '';
          return { title, content };
        })
        .filter((item) => item.title || item.content),
    };

    return {
      institution,
      account,
      statement,
      balances,
      interestInformation,
      transactions,
      additionalInformation,
    };
  }

  function mapPayslipPayloadToForm(json) {
    const payload = ensureObject(json);
    const metadataSource = pickObjectLoose(
      payload.metadata,
      looseGet(payload, 'metadata'),
      looseGet(payload, 'data.metadata'),
      payload.data,
      payload
    );
    const metricsSource = pickObjectLoose(
      payload.metrics,
      looseGet(payload, 'metrics'),
      looseGet(payload, 'data.metrics'),
      looseGet(metadataSource, 'metrics')
    );
    const employeeSource = pickObjectLoose(
      looseGet(metadataSource, 'employee'),
      looseGet(metadataSource, 'employeeDetails'),
      looseGet(metadataSource, 'employeeInfo')
    );
    const employeeAddressSource = pickObjectLoose(
      looseGet(employeeSource, 'address'),
      looseGet(employeeSource, 'contactAddress'),
      looseGet(employeeSource, 'homeAddress')
    );
    const employerSource = pickObjectLoose(
      looseGet(metadataSource, 'employer'),
      looseGet(metadataSource, 'employerDetails'),
      looseGet(metadataSource, 'company')
    );
    const totalsSource = pickObjectLoose(
      looseGet(metadataSource, 'totals'),
      looseGet(metricsSource, 'totals')
    );
    const periodSource = pickObjectLoose(
      looseGet(metadataSource, 'period'),
      looseGet(metricsSource, 'period')
    );
    const earningsSource = pickArrayLoose(
      looseGet(metadataSource, 'earnings'),
      looseGet(metricsSource, 'earnings'),
      looseGet(payload, 'earnings')
    );
    const deductionsSource = pickArrayLoose(
      looseGet(metadataSource, 'deductions'),
      looseGet(metricsSource, 'deductions'),
      looseGet(payload, 'deductions')
    );
    const metaSource = pickObjectLoose(
      looseGet(metadataSource, 'meta'),
      looseGet(payload, 'meta')
    );

    const periodMonthRaw = firstDefined(
      looseGet(periodSource, 'Date'),
      looseGet(periodSource, 'month'),
      looseGet(metricsSource, 'payDate'),
      looseGet(metadataSource, 'documentMonth'),
      looseGet(payload, 'documentMonth')
    );
    const periodMonthKey = formatMonthInput(periodMonthRaw);

    const periodStartRaw = firstDefined(
      looseGet(periodSource, 'start'),
      looseGet(metricsSource, 'period.start'),
      looseGet(periodSource, 'from')
    );
    const periodEndRaw = firstDefined(
      looseGet(periodSource, 'end'),
      looseGet(metricsSource, 'period.end'),
      looseGet(periodSource, 'to')
    );
    const payFrequency = firstDefined(
      looseGet(periodSource, 'payFrequency'),
      looseGet(metricsSource, 'period.payFrequency')
    );

    const employee = {
      fullName: firstDefined(
        looseGet(employeeSource, 'fullName'),
        looseGet(employeeSource, 'name')
      ) || '',
      employeeId: firstDefined(
        looseGet(employeeSource, 'employeeId'),
        looseGet(employeeSource, 'id'),
        looseGet(employeeSource, 'employeeNumber')
      ) || '',
      niNumber: firstDefined(
        looseGet(employeeSource, 'niNumber'),
        looseGet(employeeSource, 'nin'),
        looseGet(employeeSource, 'nationalInsurance')
      ) || '',
      taxCode: firstDefined(
        looseGet(employeeSource, 'taxCode'),
        looseGet(employeeSource, 'taxcode')
      ) || '',
      niCategory: firstDefined(
        looseGet(employeeSource, 'niCategory'),
        looseGet(employeeSource, 'nationalInsuranceCategory')
      ) || '',
      address: {
        street: firstDefined(
          looseGet(employeeAddressSource, 'street'),
          looseGet(employeeAddressSource, 'line1'),
          looseGet(employeeAddressSource, 'addressLine1')
        ) || '',
        city: firstDefined(
          looseGet(employeeAddressSource, 'city'),
          looseGet(employeeAddressSource, 'town')
        ) || '',
        county: firstDefined(
          looseGet(employeeAddressSource, 'county'),
          looseGet(employeeAddressSource, 'state')
        ) || '',
        postcode: firstDefined(
          looseGet(employeeAddressSource, 'postcode'),
          looseGet(employeeAddressSource, 'postalCode'),
          looseGet(employeeAddressSource, 'zip')
        ) || '',
      },
    };

    const employer = {
      name: firstDefined(
        looseGet(employerSource, 'name'),
        looseGet(employerSource, 'employerName'),
        looseGet(employerSource, 'companyName')
      ) || '',
      taxDistrict: firstDefined(
        looseGet(employerSource, 'taxDistrict'),
        looseGet(employerSource, 'district')
      ) || '',
      taxReference: firstDefined(
        looseGet(employerSource, 'taxReference'),
        looseGet(employerSource, 'reference')
      ) || '',
      employersNicThisPeriod: normaliseNumericValue(
        firstDefined(
          looseGet(employerSource, 'employersNicThisPeriod'),
          looseGet(employerSource, 'nicThisPeriod')
        )
      ),
      employersNicYtd: normaliseNumericValue(
        firstDefined(
          looseGet(employerSource, 'employersNicYtd'),
          looseGet(employerSource, 'nicYtd')
        )
      ),
      employersPensionThisPeriod: normaliseNumericValue(
        firstDefined(
          looseGet(employerSource, 'employersPensionThisPeriod'),
          looseGet(employerSource, 'pensionThisPeriod')
        )
      ),
      employersPensionYtd: normaliseNumericValue(
        firstDefined(
          looseGet(employerSource, 'employersPensionYtd'),
          looseGet(employerSource, 'pensionYtd')
        )
      ),
    };

    const earnings = earningsSource
      .map((item) => {
        const entry = ensureObject(item);
        return {
          rawLabel: firstDefined(
            looseGet(entry, 'rawLabel'),
            looseGet(entry, 'label'),
            looseGet(entry, 'name')
          ) || '',
          category: firstDefined(
            looseGet(entry, 'category'),
            looseGet(entry, 'type')
          ) || '',
          amountPeriod: normaliseNumericValue(
            firstDefined(
              looseGet(entry, 'amountPeriod'),
              looseGet(entry, 'periodAmount'),
              looseGet(entry, 'current')
            )
          ),
          amountYtd: normaliseNumericValue(
            firstDefined(
              looseGet(entry, 'amountYtd'),
              looseGet(entry, 'ytdAmount'),
              looseGet(entry, 'ytd')
            )
          ),
        };
      })
      .filter((entry) => entry.rawLabel || entry.category || entry.amountPeriod !== '' || entry.amountYtd !== '');

    const deductions = deductionsSource
      .map((item) => {
        const entry = ensureObject(item);
        return {
          rawLabel: firstDefined(
            looseGet(entry, 'rawLabel'),
            looseGet(entry, 'label'),
            looseGet(entry, 'name')
          ) || '',
          category: firstDefined(
            looseGet(entry, 'category'),
            looseGet(entry, 'type')
          ) || '',
          amountPeriod: normaliseNumericValue(
            firstDefined(
              looseGet(entry, 'amountPeriod'),
              looseGet(entry, 'periodAmount'),
              looseGet(entry, 'current')
            )
          ),
          amountYtd: normaliseNumericValue(
            firstDefined(
              looseGet(entry, 'amountYtd'),
              looseGet(entry, 'ytdAmount'),
              looseGet(entry, 'ytd')
            )
          ),
        };
      })
      .filter((entry) => entry.rawLabel || entry.category || entry.amountPeriod !== '' || entry.amountYtd !== '');

    const totals = {
      grossPeriod: normaliseNumericValue(
        firstDefined(
          looseGet(totalsSource, 'grossPeriod'),
          looseGet(metricsSource, 'grossPeriod')
        )
      ),
      netPeriod: normaliseNumericValue(
        firstDefined(
          looseGet(totalsSource, 'netPeriod'),
          looseGet(metricsSource, 'netPeriod')
        )
      ),
      grossYtd: normaliseNumericValue(
        firstDefined(
          looseGet(totalsSource, 'grossYtd'),
          looseGet(metricsSource, 'grossYtd')
        )
      ),
      netYtd: normaliseNumericValue(
        firstDefined(
          looseGet(totalsSource, 'netYtd'),
          looseGet(metricsSource, 'netYtd')
        )
      ),
    };

    const meta = {
      documentId: firstDefined(
        looseGet(metaSource, 'documentId'),
        looseGet(payload, 'documentId')
      ) || '',
      confidence: normaliseNumericValue(
        firstDefined(
          looseGet(metaSource, 'confidence'),
          looseGet(metricsSource, 'confidence')
        )
      ),
    };

    return {
      employee,
      employer,
      period: {
        Date: periodMonthKey ? toDisplayMonth(periodMonthKey) || '' : '',
        start: formatDateInput(periodStartRaw),
        end: formatDateInput(periodEndRaw),
        payFrequency: payFrequency || '',
      },
      currency: firstDefined(
        looseGet(metadataSource, 'currency'),
        looseGet(metricsSource, 'currency'),
        looseGet(payload, 'currency')
      ) || '',
      earnings,
      deductions,
      totals,
      meta,
    };
  }

  function resolveManualEditorSchema(file, schema, meta) {
    if (schema && MANUAL_EDITOR_SCHEMAS[schema]) return schema;
    const classification = (file?.catalogueKey || file?.classification || meta?.classification?.key || meta?.catalogueKey || '')
      .toString()
      .toLowerCase();
    if (!classification) return null;
    if (classification.includes('payslip')) return 'payslip';
    if (
      classification.includes('statement') ||
      classification.includes('current_account') ||
      classification.includes('savings_account') ||
      classification.includes('isa') ||
      classification.includes('investment') ||
      classification.includes('pension')
    ) {
      return 'bank_statement';
    }
    return null;
  }
  async function submitManualEditorPayload(payload) {
    if (!manualEditorDocId || !manualEditorSave) return;
    const restore = withButtonSpinner(manualEditorSave, 'Saving…');
    try {
      const response = await apiFetch(`/json/${encodeURIComponent(manualEditorDocId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: manualEditorSchemaKey, json: payload }),
      });
      const result = await response.json().catch(() => null);
      if (response.status === 401) {
        handleUnauthorised('Your session has expired. Please sign in again.');
        throw new Error('Please sign in again to continue.');
      }
      if (!response.ok || !result?.ok) {
        const details = Array.isArray(result?.details) ? result.details : [];
        if (details.length) {
          highlightServerValidation(details);
          manualEditorError.hidden = false;
          manualEditorError.textContent = result?.error || 'Please fix the highlighted fields.';
        } else {
          throw new Error(result?.error || 'Unable to save changes right now.');
        }
        return;
      }
      if (manualEditorMessage) {
        manualEditorMessage.hidden = false;
        manualEditorMessage.textContent = 'Changes saved. Your analytics will refresh shortly.';
      }
      manualEditorError.hidden = true;
      if (manualEditorFile) {
        applyProcessingUpdate(manualEditorFile, {
          status: 'completed',
          processing: { requiresManualFields: null },
        });
      }
      renderViewerFiles();
      queueRefresh();
    } catch (error) {
      throw error;
    } finally {
      restore();
    }
  }

  function injectTrimModalStyles() {
    if (trimModalStylesInjected) return;
    trimModalStylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .vault-trim-modal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; padding: 24px; background: var(--viewer-overlay, rgba(15, 23, 42, 0.45)); z-index: 1250; }
      .vault-trim-modal.is-visible { display: flex; }
      .vault-trim-modal__dialog { position: relative; width: min(520px, 100%); max-height: min(90vh, 640px); background: var(--viewer-bg, rgba(255, 255, 255, 0.98)); color: var(--bs-body-color, #0f172a); border-radius: var(--vault-radius, 18px); border: 1px solid var(--vault-border, rgba(15, 23, 42, 0.08)); box-shadow: var(--vault-shadow, 0 16px 48px rgba(15, 23, 42, 0.12)); display: flex; flex-direction: column; outline: none; }
      .vault-trim-modal__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid rgba(15, 23, 42, 0.08); }
      .vault-trim-modal__title { margin: 0; font-size: 1rem; font-weight: 600; }
      .vault-trim-modal__close { border: none; background: transparent; color: inherit; font-size: 1.5rem; line-height: 1; padding: 4px; cursor: pointer; }
      .vault-trim-modal__close:focus-visible { outline: 2px solid var(--vault-accent, #6759ff); outline-offset: 2px; }
      .vault-trim-modal__form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .vault-trim-modal__body { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; flex: 1; overflow: hidden; }
      .vault-trim-modal__description { margin: 0; font-size: 0.9rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.7)); }
      .vault-trim-modal__meta { margin: 0; font-size: 0.85rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.6)); }
      .vault-trim-modal__loading { margin: 0; font-size: 0.85rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.6)); }
      .vault-trim-modal__error { margin: 0; font-size: 0.85rem; color: var(--light-red, #ef4444); }
      .vault-trim-modal__pages { flex: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; padding: 12px; border-radius: 12px; border: 1px solid rgba(15, 23, 42, 0.08); background: rgba(15, 23, 42, 0.03); overflow: auto; min-height: 120px; }
      .vault-trim-modal__page { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; cursor: pointer; }
      .vault-trim-modal__page input { cursor: pointer; }
      .vault-trim-modal__empty { margin: 0; font-size: 0.85rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.6)); }
      .vault-trim-modal__footer { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 20px; border-top: 1px solid rgba(15, 23, 42, 0.08); }
      @media (max-width: 600px) { .vault-trim-modal { padding: 16px; } .vault-trim-modal__dialog { width: 100%; max-height: 100vh; } }
    `;
    document.head.appendChild(style);
  }

  function ensureTrimModal() {
    if (trimModal) return trimModal;
    injectTrimModalStyles();

    let modal = document.getElementById('vault-trim-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'vault-trim-modal';
      modal.id = 'vault-trim-modal';
      modal.setAttribute('aria-hidden', 'true');
      modal.setAttribute('hidden', '');

      const dialog = document.createElement('div');
      dialog.className = 'vault-trim-modal__dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'vault-trim-modal-title');
      dialog.setAttribute('aria-describedby', 'vault-trim-modal-description');
      dialog.tabIndex = -1;

      const header = document.createElement('header');
      header.className = 'vault-trim-modal__header';

      const title = document.createElement('h4');
      title.className = 'vault-trim-modal__title';
      title.id = 'vault-trim-modal-title';
      title.textContent = 'Review Trim';

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'vault-trim-modal__close';
      closeButton.setAttribute('aria-label', 'Close trim review');
      closeButton.textContent = '×';

      header.append(title, closeButton);

      const form = document.createElement('form');
      form.className = 'vault-trim-modal__form';
      form.id = 'vault-trim-modal-form';

      const body = document.createElement('div');
      body.className = 'vault-trim-modal__body';

      const description = document.createElement('p');
      description.className = 'vault-trim-modal__description';
      description.id = 'vault-trim-modal-description';
      description.textContent = 'Choose which pages to keep before processing. Unselected pages will be removed.';

      const meta = document.createElement('p');
      meta.className = 'vault-trim-modal__meta muted';
      meta.hidden = true;

      const loading = document.createElement('p');
      loading.className = 'vault-trim-modal__loading muted';
      loading.hidden = true;
      loading.textContent = 'Loading page suggestions…';

      const error = document.createElement('p');
      error.className = 'vault-trim-modal__error';
      error.hidden = true;

      const pages = document.createElement('div');
      pages.className = 'vault-trim-modal__pages';

      body.append(description, meta, loading, error, pages);

      const footer = document.createElement('footer');
      footer.className = 'vault-trim-modal__footer';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'btn btn-outline-secondary vault-trim-modal__cancel';
      cancelButton.textContent = 'Cancel';

      const applyButton = document.createElement('button');
      applyButton.type = 'submit';
      applyButton.className = 'btn btn-primary vault-trim-modal__apply';
      applyButton.textContent = 'Apply & Queue';
      applyButton.disabled = true;

      footer.append(cancelButton, applyButton);
      form.append(body, footer);
      dialog.append(header, form);
      modal.appendChild(dialog);
      document.body.appendChild(modal);
    }

    trimModal = modal;
    trimModalDialog = modal.querySelector('.vault-trim-modal__dialog');
    if (trimModalDialog && !trimModalDialog.hasAttribute('tabindex')) {
      trimModalDialog.tabIndex = -1;
    }
    trimModalTitle = modal.querySelector('.vault-trim-modal__title');
    trimModalMeta = modal.querySelector('.vault-trim-modal__meta');
    trimModalList = modal.querySelector('.vault-trim-modal__pages');
    trimModalLoading = modal.querySelector('.vault-trim-modal__loading');
    trimModalError = modal.querySelector('.vault-trim-modal__error');
    trimModalForm = modal.querySelector('.vault-trim-modal__form');
    trimModalApply = modal.querySelector('.vault-trim-modal__apply') || modal.querySelector('.vault-trim-modal__form button[type="submit"]');
    trimModalCancel = modal.querySelector('.vault-trim-modal__cancel');
    trimModalClose = modal.querySelector('.vault-trim-modal__close');

    if (!modal.dataset.trimInitialised) {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          hideTrimModal();
        }
      });
      if (trimModalCancel) {
        trimModalCancel.addEventListener('click', (event) => {
          event.preventDefault();
          hideTrimModal();
        });
      }
      if (trimModalClose) {
        trimModalClose.addEventListener('click', (event) => {
          event.preventDefault();
          hideTrimModal();
        });
      }
      if (trimModalForm) {
        trimModalForm.addEventListener('submit', (event) => {
          event.preventDefault();
          submitTrimReview();
        });
      }
      modal.dataset.trimInitialised = 'true';
    }

    return modal;
  }

  function updateTrimModalMeta() {
    if (!trimModalMeta) return;
    const file = trimReviewState.file;
    const raw = ensureObject(file?.raw);
    const parts = [];
    const docParts = [];
    if (file?.title) docParts.push(file.title);
    if (file?.subtitle) docParts.push(file.subtitle);
    if (!docParts.length && raw?.originalName) docParts.push(raw.originalName);
    if (!docParts.length && file?.originalName) docParts.push(file.originalName);
    if (docParts.length) {
      parts.push(docParts.join(' — '));
    }
    const pageCount = trimReviewState.pageCount;
    if (pageCount) {
      parts.push(`${pageCount} page${pageCount === 1 ? '' : 's'}`);
    }
    const keptCount = trimReviewState.keptPages instanceof Set ? trimReviewState.keptPages.size : 0;
    if (keptCount) {
      parts.push(`Keeping ${keptCount} page${keptCount === 1 ? '' : 's'}`);
    }
    trimModalMeta.textContent = parts.join(' • ');
    trimModalMeta.hidden = parts.length === 0;
  }

  function updateTrimModalApplyState() {
    if (trimModalApply) {
      trimModalApply.disabled = trimReviewState.keptPages.size === 0 || trimReviewState.isSubmitting;
    }
    if (trimModalError && trimModalError.dataset && trimModalError.dataset.trimContext === 'selection' && trimReviewState.keptPages.size > 0) {
      trimModalError.hidden = true;
      trimModalError.textContent = '';
      trimModalError.dataset.trimContext = '';
    }
  }

  function renderTrimModalPages() {
    if (!trimModalList) return;
    trimModalList.innerHTML = '';
    if (!(trimReviewState.keptPages instanceof Set)) {
      trimReviewState.keptPages = new Set();
    }
    const { pageCount, keptPages } = trimReviewState;
    if (!pageCount || pageCount < 1) {
      const empty = document.createElement('p');
      empty.className = 'vault-trim-modal__empty';
      empty.textContent = 'Page information unavailable.';
      trimModalList.appendChild(empty);
      updateTrimModalApplyState();
      updateTrimModalMeta();
      return;
    }

    for (let page = 1; page <= pageCount; page += 1) {
      const label = document.createElement('label');
      label.className = 'vault-trim-modal__page';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(page);
      checkbox.checked = keptPages.has(page);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          keptPages.add(page);
        } else {
          keptPages.delete(page);
        }
        updateTrimModalMeta();
        updateTrimModalApplyState();
      });

      const caption = document.createElement('span');
      caption.textContent = `Page ${page}`;

      label.append(checkbox, caption);
      trimModalList.appendChild(label);
    }

    updateTrimModalMeta();
    updateTrimModalApplyState();
  }

  function focusFirstTrimCheckbox() {
    if (!trimModalList) return;
    const target =
      trimModalList.querySelector('input[type="checkbox"]:checked') ||
      trimModalList.querySelector('input[type="checkbox"]');
    if (target && typeof target.focus === 'function') {
      requestAnimationFrame(() => {
        try {
          target.focus();
        } catch (error) {
          console.warn('Failed to focus trim checkbox', error);
        }
      });
    }
  }

  async function prepareTrimReviewData(file, docId) {
    const resolvedFile = findViewerFileByDocId(docId) || file;
    if (!resolvedFile) {
      throw new Error('Document unavailable for trim review.');
    }
    const meta = ensureFileMeta(resolvedFile);

    let pageCount = pickFirstNumber([
      meta.page_count_original,
      meta.pageCountOriginal,
      meta.originalPageCount,
      meta.original_page_count,
      meta.page_count,
      meta.pageCount,
      meta.total_pages,
      meta.totalPages,
    ]);

    let keptPages = normalisePageNumbers(
      meta.pages_kept ?? meta.pagesKept ?? meta.keptPages ?? meta.trim_pages_kept ?? meta.trimPagesKept ?? meta.pages
    );

    if ((!pageCount || !keptPages.length) && docId) {
      const { trim } = await requestAutoTrim(resolvedFile, docId);
      const refreshedMeta = ensureFileMeta(resolvedFile);
      pageCount =
        pickFirstNumber([
          refreshedMeta.page_count_original,
          refreshedMeta.pageCountOriginal,
          refreshedMeta.originalPageCount,
          refreshedMeta.original_page_count,
          trim?.originalPageCount,
          trim?.page_count_original,
        ]) || pageCount;
      const updatedPages =
        refreshedMeta.pages_kept ??
        refreshedMeta.pagesKept ??
        refreshedMeta.keptPages ??
        trim?.keptPages ??
        trim?.pages_kept;
      keptPages = normalisePageNumbers(updatedPages);
      renderViewerFiles();
      queueRefresh();
    }

    if (keptPages.length) {
      const maxPage = Math.max(...keptPages);
      if (!pageCount || maxPage > pageCount) {
        pageCount = maxPage;
      }
    }

    if (!pageCount) {
      const fallbackCount = pickFirstNumber([
        meta.page_count_trimmed,
        meta.pageCountTrimmed,
        meta.pages_total,
        meta.pagesTotal,
      ]);
      if (fallbackCount) pageCount = fallbackCount;
    }

    if (!pageCount) {
      throw new Error('Page information unavailable for this document.');
    }

    if (!keptPages.length) {
      keptPages = Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    return { file: resolvedFile, pageCount, keptPages };
  }

  function hideTrimModal() {
    if (!trimModal) return;
    trimModal.classList.remove('is-visible');
    trimModal.setAttribute('aria-hidden', 'true');
    trimModal.setAttribute('hidden', '');
    if (trimModalForm) {
      trimModalForm.hidden = true;
    }
    if (trimModalLoading) {
      trimModalLoading.hidden = true;
    }
    if (trimModalError) {
      trimModalError.hidden = true;
      trimModalError.textContent = '';
      if (trimModalError.dataset) trimModalError.dataset.trimContext = '';
    }
    if (trimModalMeta) {
      trimModalMeta.hidden = true;
      trimModalMeta.textContent = '';
    }
    if (trimModalList) {
      trimModalList.innerHTML = '';
    }
    trimReviewState.docId = null;
    trimReviewState.file = null;
    trimReviewState.pageCount = 0;
    trimReviewState.keptPages = new Set();
    trimReviewState.isLoading = false;
    trimReviewState.isSubmitting = false;
    const returnTarget = trimModalReturnFocus;
    trimModalReturnFocus = null;
    if (returnTarget && typeof returnTarget.focus === 'function') {
      requestAnimationFrame(() => {
        try {
          returnTarget.focus();
        } catch (error) {
          console.warn('Failed to restore focus after closing trim review', error);
        }
      });
    }
  }

  async function openTrimReview(file, trigger) {
    if (trimReviewState.isLoading) return;
    const docId = resolveDocId(file);
    if (!docId) {
      window.alert('Unable to review trim because the document identifier is unavailable.');
      return;
    }

    const modal = ensureTrimModal();
    if (!modal) {
      window.alert('Trim review unavailable right now.');
      return;
    }

    trimReviewState.isLoading = true;
    trimReviewState.docId = docId;
    trimReviewState.file = findViewerFileByDocId(docId) || file;
    trimReviewState.pageCount = 0;
    trimReviewState.keptPages = new Set();
    trimReviewState.isSubmitting = false;

    trimModalReturnFocus = trigger || document.activeElement || null;

    if (trimModalTitle) {
      trimModalTitle.textContent = 'Review Trim';
    }
    if (trimModalError) {
      trimModalError.hidden = true;
      trimModalError.textContent = '';
      if (trimModalError.dataset) trimModalError.dataset.trimContext = '';
    }
    if (trimModalLoading) {
      trimModalLoading.hidden = false;
      trimModalLoading.textContent = 'Loading page suggestions…';
    }
    if (trimModalForm) {
      trimModalForm.hidden = true;
    }
    if (trimModalApply) {
      trimModalApply.disabled = true;
    }
    if (trimModalCancel) {
      trimModalCancel.disabled = false;
    }
    if (trimModalMeta) {
      trimModalMeta.textContent = '';
      trimModalMeta.hidden = true;
    }

    updateTrimModalMeta();

    modal.classList.add('is-visible');
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (trimModalDialog) {
      trimModalDialog.focus();
    }

    try {
      const { file: resolvedFile, pageCount, keptPages } = await prepareTrimReviewData(trimReviewState.file, docId);
      trimReviewState.file = resolvedFile;
      trimReviewState.pageCount = pageCount;
      trimReviewState.keptPages = new Set(keptPages);
      if (trimModalLoading) {
        trimModalLoading.hidden = true;
      }
      if (trimModalForm) {
        trimModalForm.hidden = false;
      }
      renderTrimModalPages();
      focusFirstTrimCheckbox();
    } catch (error) {
      console.error('Failed to load trim review data', error);
      if (trimModalLoading) {
        trimModalLoading.hidden = true;
      }
      if (trimModalError) {
        trimModalError.textContent = error.message || 'Unable to load trim suggestions right now.';
        trimModalError.hidden = false;
        if (trimModalError.dataset) trimModalError.dataset.trimContext = 'load';
      }
      updateTrimModalApplyState();
    } finally {
      trimReviewState.isLoading = false;
    }
  }

  async function submitTrimReview() {
    if (trimReviewState.isSubmitting) return;
    const docId = trimReviewState.docId;
    if (!docId) {
      hideTrimModal();
      return;
    }
    const kept = Array.from(trimReviewState.keptPages).sort((a, b) => a - b);
    if (!kept.length) {
      if (trimModalError) {
        trimModalError.textContent = 'Select at least one page to keep.';
        trimModalError.hidden = false;
        if (trimModalError.dataset) trimModalError.dataset.trimContext = 'selection';
      }
      updateTrimModalApplyState();
      return;
    }

    const file = findViewerFileByDocId(docId) || trimReviewState.file;
    if (!file) {
      if (trimModalError) {
        trimModalError.textContent = 'Document unavailable for trim review.';
        trimModalError.hidden = false;
        if (trimModalError.dataset) trimModalError.dataset.trimContext = 'apply';
      }
      return;
    }

    trimReviewState.isSubmitting = true;
    if (trimModalError) {
      trimModalError.hidden = true;
      trimModalError.textContent = '';
      if (trimModalError.dataset) trimModalError.dataset.trimContext = '';
    }
    const restore = trimModalApply ? withButtonSpinner(trimModalApply, 'Applying…') : () => {};
    if (trimModalCancel) {
      trimModalCancel.disabled = true;
    }

    try {
      const response = await apiFetch('/trim/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, keptPages: kept }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Unable to apply trim');
      }

      const pageCount = trimReviewState.pageCount || (kept.length ? Math.max(...kept) : null);
      const metaUpdates = {
        pages_kept: kept,
        trim_required: false,
        trim_review_state: 'completed',
      };
      if (pageCount) {
        metaUpdates.page_count_original = pageCount;
      }

      clearTrimWarning(file);
      applyProcessingUpdate(file, {
        meta: metaUpdates,
        ui: { warning: false },
      });
      renderViewerFiles();
      queueRefresh();

      const processResponse = await apiFetch('/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId }),
      });
      const processPayload = await processResponse.json().catch(() => null);
      if (!processResponse.ok || !processPayload?.ok) {
        throw new Error(processPayload?.error || 'Unable to queue processing');
      }

      applyProcessingUpdate(file, {
        status: 'processing',
        processing: {
          provider: 'docupipe',
          stdJobId: processPayload.stdJobId,
          standardizationId: processPayload.standardizationId,
          startedAt: new Date().toISOString(),
        },
      });
      renderViewerFiles();
      queueRefresh();
      startProcessingPoll(docId);
      hideTrimModal();
    } catch (error) {
      console.error('Failed to apply trim selection', error);
      if (trimModalError) {
        trimModalError.textContent = error.message || 'Unable to apply trim right now.';
        trimModalError.hidden = false;
        if (trimModalError.dataset) trimModalError.dataset.trimContext = 'apply';
      }
    } finally {
      trimReviewState.isSubmitting = false;
      restore();
      if (trimModalCancel) {
        trimModalCancel.disabled = false;
      }
    }
  }

  async function deleteViewerFile(fileId) {
    if (!fileId) return;
    const confirmed = window.confirm('Are you sure you want to delete this document? This action cannot be undone.');
    if (!confirmed) return;
    try {
      const response = await apiFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to delete documents.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Delete failed');
      }
      state.viewer.files = state.viewer.files.filter((file) => file.fileId !== fileId);
      if (state.viewer.selectedFileId === fileId) {
        state.viewer.selectedFileId = null;
        if (viewerFrame) viewerFrame.src = 'about:blank';
        if (viewerEmpty) {
          viewerEmpty.style.display = '';
          viewerEmpty.textContent = 'Select a file to see the preview and actions.';
        }
      }
      renderViewerFiles();
      queueRefresh();
    } catch (error) {
      console.error('Failed to delete file', error);
      window.alert(error.message || 'Unable to delete file right now.');
    }
  }

  function buildViewerFileCard(file) {
    const card = document.createElement('article');
    card.className = 'viewer__file';
    card.dataset.fileId = file.fileId;
    if (state.viewer.selectedFileId === file.fileId) {
      card.classList.add('is-selected');
    }

    const raw = ensureObject(file.raw);
    file.raw = raw;
    const processing = normaliseProcessingState(file.processingInfo || raw.processing || file.processing || {}, 'idle');
    file.processingInfo = processing;
    file.processingStatus = processing.status;
    file.processing = processing.status;
    const docId = resolveDocId(file);
    if (docId) {
      card.dataset.docId = docId;
    }
    const docClass = resolveDocClass(file);
    const hasWarning = docHasWarning(file);

    const header = document.createElement('div');
    header.className = 'viewer__file-header';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'viewer__file-titles';
    const title = document.createElement('h4');
    title.className = 'viewer__file-title';
    title.textContent = file.title || 'Document';
    titleGroup.appendChild(title);
    if (file.subtitle) {
      const subtitle = document.createElement('span');
      subtitle.className = 'viewer__file-subtitle muted';
      subtitle.textContent = file.subtitle;
      titleGroup.appendChild(subtitle);
    }
    header.appendChild(titleGroup);

    const statusGroup = document.createElement('div');
    statusGroup.className = 'viewer__file-status';
    statusGroup.appendChild(createStatusIndicator('Processing status', processing));
    if (hasWarning) {
      const warningIcon = document.createElement('i');
      warningIcon.className = 'bi bi-exclamation-triangle-fill viewer__file-warning';
      warningIcon.setAttribute('role', 'button');
      warningIcon.setAttribute('aria-label', 'Long document — review trim before processing');
      warningIcon.title = 'Long document — review trim before processing';
      warningIcon.tabIndex = 0;
      warningIcon.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openTrimReview(file, warningIcon);
      });
      warningIcon.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        openTrimReview(file, warningIcon);
      });
      statusGroup.appendChild(warningIcon);
    }
    header.appendChild(statusGroup);
    card.appendChild(header);

    if (Array.isArray(file.summary) && file.summary.length) {
      const meta = document.createElement('div');
      meta.className = 'viewer__file-meta';
      file.summary.forEach((entry) => {
        const block = document.createElement('div');
        const label = document.createElement('strong');
        label.textContent = entry.label;
        const value = document.createElement('span');
        value.textContent = entry.value != null && entry.value !== '' ? entry.value : '—';
        block.append(label, value);
        meta.appendChild(block);
      });
      card.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'viewer__file-actions';
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.textContent = 'Preview';
    previewButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectViewerFile(file.fileId, { preview: true });
    });
    actions.appendChild(previewButton);

    const canAutoTrim = docClass === 'bank_statement';
    if (canAutoTrim) {
      const autoTrimButton = document.createElement('button');
      autoTrimButton.type = 'button';
      autoTrimButton.textContent = 'Auto-trim';
      if (!docId) {
        autoTrimButton.disabled = true;
        autoTrimButton.title = 'Document identifier unavailable for trimming.';
      }
      autoTrimButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!docId) {
          window.alert('Unable to trim this document because it is missing an identifier.');
          return;
        }
        const restore = withButtonSpinner(autoTrimButton, 'Auto-trimming…');
        try {
          await requestAutoTrim(file, docId);
          renderViewerFiles();
          queueRefresh();
        } catch (error) {
          console.error('Auto-trim failed', error);
          window.alert(error.message || 'Unable to auto-trim this document right now.');
        } finally {
          restore();
        }
      });
      actions.appendChild(autoTrimButton);
    }

    if (hasWarning) {
      const reviewTrimButton = document.createElement('button');
      reviewTrimButton.type = 'button';
      reviewTrimButton.textContent = 'Review Trim';
      reviewTrimButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openTrimReview(file, reviewTrimButton);
      });
      actions.appendChild(reviewTrimButton);
    }

    const processableClasses = new Set(['bank_statement', 'payslip']);
    if (processableClasses.has(docClass)) {
      const processButton = document.createElement('button');
      processButton.type = 'button';
      processButton.textContent = processing.status === 'processing' ? 'Processing…' : 'Process';
      if (!docId) {
        processButton.disabled = true;
        processButton.title = 'Document identifier unavailable for processing.';
      }
      if (processing.status === 'processing') {
        processButton.disabled = true;
      }
      processButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!docId) {
          window.alert('Unable to process this document because it is missing an identifier.');
          return;
        }
        const restore = withButtonSpinner(processButton, 'Processing…');
        try {
          const response = await apiFetch('/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.ok) {
            throw new Error(payload?.error || 'Process failed');
          }
          applyProcessingUpdate(file, {
            status: 'processing',
            processing: {
              stdJobId: payload.stdJobId,
              standardizationId: payload.standardizationId,
              startedAt: new Date().toISOString(),
            },
          });
          renderViewerFiles();
          queueRefresh();
          startProcessingPoll(docId);
        } catch (error) {
          console.error('Processing failed', error);
          window.alert(error.message || 'Unable to process this document right now.');
        } finally {
          restore();
        }
      });
      actions.appendChild(processButton);
    }

    const previewDataButton = document.createElement('button');
    previewDataButton.type = 'button';
    previewDataButton.textContent = 'Preview Data';
    if (!docId) {
      previewDataButton.disabled = true;
      previewDataButton.title = 'Document identifier unavailable for data preview.';
    }
    previewDataButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDataPreview(file, previewDataButton);
    });
    actions.appendChild(previewDataButton);

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.textContent = 'Download';
    downloadButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const response = await authFetch(`${API_BASE}/files/${encodeURIComponent(file.fileId)}/download`);
        if (response.status === 401) {
          handleUnauthorised('Please sign in again to download documents.');
          return;
        }
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || 'Download failed');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        const fallbackName = file.title || file.fileId || 'document';
        anchor.download = `${fallbackName.replace(/[^\w. -]+/g, '_')}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } catch (error) {
        console.error('Failed to download document', error);
        window.alert(error.message || 'Unable to download this document right now.');
      }
    });
    actions.appendChild(downloadButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteViewerFile(file.fileId);
    });
    actions.appendChild(deleteButton);
    card.appendChild(actions);

    const uiMessages = Array.isArray(raw.ui?.messages) ? raw.ui.messages.filter((msg) => typeof msg === 'string' && msg.trim()) : [];
    if (uiMessages.length) {
      const messageBox = document.createElement('div');
      messageBox.className = 'viewer__file-messages';
      uiMessages.forEach((msg) => {
        const line = document.createElement('p');
        line.textContent = msg;
        messageBox.appendChild(line);
      });
      card.appendChild(messageBox);
    }

    if (processing.status === 'awaiting_manual_json' || raw.processing?.requiresManualFields) {
      const alertBox = document.createElement('div');
      alertBox.className = 'viewer__file-alert';
      const titleLine = document.createElement('strong');
      titleLine.textContent = 'More details needed';
      const bodyLine = document.createElement('span');
      bodyLine.textContent = 'We could not extract everything from this document. Use “Preview Data” to fill in the missing values.';
      alertBox.append(titleLine, bodyLine);
      card.appendChild(alertBox);
    }

    const details = document.createElement('div');
    details.className = 'viewer__file-details';
    if (Array.isArray(file.details) && file.details.length) {
      file.details.forEach((entry) => {
        const block = document.createElement('div');
        const label = document.createElement('strong');
        label.textContent = entry.label;
        const value = document.createElement('span');
        value.textContent = entry.value != null && entry.value !== '' ? entry.value : '—';
        block.append(label, value);
        details.appendChild(block);
      });
    }
    if (file.isExpanded) {
      details.classList.add('is-expanded');
    }
    card.appendChild(details);

    card.addEventListener('click', () => {
      file.isExpanded = !file.isExpanded;
      details.classList.toggle('is-expanded', file.isExpanded);
      selectViewerFile(file.fileId, { preview: false });
    });

    return card;
  }

  function renderViewerFiles() {
    if (!viewerList) return;
    viewerList.innerHTML = '';
    const files = Array.isArray(state.viewer.files) ? state.viewer.files : [];
    if (!files.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No documents available yet.';
      viewerList.appendChild(empty);
      if (viewerEmpty) {
        viewerEmpty.style.display = '';
        viewerEmpty.textContent = 'Upload a document to see it here.';
      }
      return;
    }
    files.forEach((file) => {
      viewerList.appendChild(buildViewerFileCard(file));
    });
    renderViewerSelection();
    if (viewerEmpty) {
      viewerEmpty.style.display = state.viewer.selectedFileId ? 'none' : '';
      if (!state.viewer.selectedFileId) {
        viewerEmpty.textContent = 'Select a file to see the preview and actions.';
      }
    }
  }

  function showViewer({ type, title, subtitle, files }) {
    if (!viewerRoot) return;
    state.viewer.type = type;
    state.viewer.context = { title, subtitle };
    state.viewer.files = Array.isArray(files) ? files : [];
    state.viewer.selectedFileId = null;
    viewerRoot.setAttribute('aria-hidden', 'false');
    if (viewerTitle) viewerTitle.textContent = title || 'Documents';
    if (viewerSubtitle) viewerSubtitle.textContent = subtitle || '';
    renderViewerFiles();
  }

  function persistState() {
    if (typeof localStorage === 'undefined') return;
    try {
      const sessionsPayload = Array.from(state.sessions.entries()).map(([sessionId, session]) => ({
        sessionId,
        files: Array.from(session.files.values()).map((file) => ({
          fileId: file.fileId,
          originalName: file.originalName,
          upload: file.upload,
          processing: file.processing,
          state: file.state,
          classification: file.classification || null,
          message: file.message || '',
        })),
        rejected: Array.isArray(session.rejected)
          ? session.rejected.map((entry) => ({ originalName: entry.originalName, reason: entry.reason }))
          : [],
      }));
      if (sessionsPayload.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: sessionsPayload }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.warn('Failed to persist vault sessions', error);
    }
  }

  function restoreSessionsFromStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.sessions)) return;
      data.sessions.forEach((entry) => {
        if (!entry || !entry.sessionId) return;
        const session = upsertSession(entry.sessionId);
        session.rejected = Array.isArray(entry.rejected)
          ? entry.rejected.map((item) => ({ originalName: item.originalName, reason: item.reason }))
          : [];
        if (Array.isArray(entry.files)) {
          entry.files.forEach((file) => {
            if (!file || !file.fileId) return;
            const record = normaliseFileRecord(entry.sessionId, {
              fileId: file.fileId,
              originalName: file.originalName,
              upload: file.upload || 'queued',
              processing: file.processing || file.state || 'queued',
              state: file.state || file.processing || 'queued',
              classification: file.classification || null,
              message: file.message || '',
            });
            session.files.set(file.fileId, record);
          });
        }
      });
      renderSessionPanel();
      queueStatusPolling();
    } catch (error) {
      console.warn('Failed to restore vault sessions', error);
    }
  }

  function beginPlaceholder({ phase }) {
    if (!phase) return null;
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `placeholder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.placeholders.set(id, { phase, total: 1, completed: 0 });
    updateProgressUI();
    return id;
  }

  function completePlaceholder(id) {
    if (!id) return;
    const placeholder = state.placeholders.get(id);
    if (placeholder) {
      placeholder.completed = placeholder.total || 1;
    }
    state.placeholders.delete(id);
    updateProgressUI();
  }

  function stopPolling() {
    if (state.timers.uploads) {
      clearInterval(state.timers.uploads);
      state.timers.uploads = null;
    }
    if (state.timers.tiles) {
      clearInterval(state.timers.tiles);
      state.timers.tiles = null;
    }
    if (state.timers.lists) {
      clearInterval(state.timers.lists);
      state.timers.lists = null;
    }
  }

  function handleUnauthorised(message) {
    if (unauthorised) return;
    unauthorised = true;
    stopPolling();
    showError(message || 'Your session has expired. Please sign in again.');
    if (window.Auth && typeof Auth.enforce === 'function') {
      Auth.enforce({ validateWithServer: true }).catch(() => {});
    }
  }

  async function apiFetch(path, options) {
    const response = await authFetch(`${API_BASE}${path}`, options);
    if (response.status === 401) {
      handleUnauthorised('Your session has expired. Please sign in again.');
    }
    return response;
  }

  function animateOnce(element, className, { duration = 420 } = {}) {
    return new Promise((resolve) => {
      if (!element) return resolve();

      const cleanup = () => {
        element.removeEventListener('animationend', onEnd);
        element.removeEventListener('transitionend', onEnd);
        element.classList.remove(className);
        clearTimeout(timer);
        resolve();
      };

      const onEnd = (event) => {
        if (event.target !== element) return;
        cleanup();
      };

      const timer = setTimeout(cleanup, duration);
      element.addEventListener('animationend', onEnd);
      element.addEventListener('transitionend', onEnd);
      element.classList.add(className);
    });
  }

  function setSessionReminder(message) {
    if (!sessionReminder) return;
    const text = message && String(message).trim();
    if (text) {
      sessionReminder.hidden = false;
      sessionReminder.textContent = text;
    } else {
      sessionReminder.hidden = true;
      sessionReminder.textContent = '';
    }
  }

  function removeDropzoneHighlight() {
    if (dropzone) {
      dropzone.classList.remove('dropzone--highlight');
    }
  }

  function clearSessionHistory() {
    state.sessions.clear();
    state.files.clear();
    renderSessionPanel();
  }

  function dismissRejected(sessionId, index) {
    const session = state.sessions.get(sessionId);
    if (!session || !Array.isArray(session.rejected)) return;
    if (index < 0 || index >= session.rejected.length) return;
    session.rejected.splice(index, 1);
    if (session.rejected.length === 0 && (!session.files || session.files.size === 0)) {
      state.sessions.delete(sessionId);
    }
    renderSessionPanel();
    setSessionReminder('');
    removeDropzoneHighlight();
  }

  function promptRetryUpload(originalName) {
    if (!fileInput || !dropzone) return;
    const name = originalName && String(originalName).trim();
    const label = name ? `Select a replacement for “${name}”.` : 'Select a replacement document to try again.';
    setSessionReminder(label);
    dropzone.classList.add('dropzone--highlight');
    window.setTimeout(() => {
      if (!fileInput.isConnected) return;
      try { fileInput.focus(); } catch {}
      try { fileInput.click(); } catch {}
    }, 20);
  }

  function renderSessionPanel() {
    if (!(sessionRows && sessionEmpty)) return;
    sessionRows.innerHTML = '';
    let rowCount = 0;
    for (const [sessionId, session] of state.sessions.entries()) {
      for (const file of session.files.values()) {
        rowCount += 1;
        sessionRows.appendChild(renderFileRow(file));
      }
      session.rejected.forEach((entry, index) => {
        rowCount += 1;
        sessionRows.appendChild(renderRejectedRow(sessionId, entry, index));
      });
    }
    if (sessionEmpty) {
      sessionEmpty.hidden = rowCount !== 0;
    }
    if (sessionActions) {
      sessionActions.hidden = rowCount === 0;
    }
    if (rowCount === 0) {
      setSessionReminder('');
    }
    updateProgressUI();
    persistState();
  }

  function renderFileRow(file) {
    const row = document.createElement('article');
    row.className = 'session-row';
    row.setAttribute('role', 'listitem');
    if (file.state) {
      row.dataset.state = file.state;
      if (file.state === 'needs_trim' || file.state === 'awaiting_manual_json' || file.state === 'failed') {
        row.classList.add('session-row--attention');
      }
    }

    const title = document.createElement('div');
    title.className = 'session-row__title';
    const name = document.createElement('strong');
    name.className = 'session-row__name';
    name.textContent = file.originalName || 'Document';
    if (name.textContent) {
      name.title = name.textContent;
    }
    title.appendChild(name);

    const classificationLabel = file.classification?.label || file.classification?.key || '';
    if (classificationLabel) {
      const tag = document.createElement('span');
      tag.className = 'session-row__tag';
      tag.textContent = classificationLabel;
      title.appendChild(tag);
    }

    const uploadIndicator = createStatusIndicator('Upload', file.upload || 'completed');
    const processingIndicator = createStatusIndicator('Processing', file.processing || 'queued');
    const indicators = document.createElement('div');
    indicators.className = 'status-list session-row__statuses';
    indicators.append(uploadIndicator, processingIndicator);

    row.append(title, indicators);

    const parts = [];
    if (file.message) parts.push(file.message);
    if (!parts.length) {
      const statusValue = normaliseStatus(file.processing || file.state, 'queued');
      if (statusValue === 'queued') {
        parts.push('Waiting to start processing.');
      } else if (statusValue === 'processing') {
        parts.push('Processing in progress…');
      } else if (statusValue === 'completed') {
        parts.push('Document processed successfully.');
      } else if (statusValue === 'failed') {
        parts.push('Processing failed.');
      } else if (statusValue === 'idle') {
        parts.push('Upload ready.');
      }
    }
    if (parts.length) {
      const message = document.createElement('p');
      message.className = 'session-row__message';
      message.textContent = parts.join(' ');
      row.appendChild(message);
    }

    return row;
  }

  function renderRejectedRow(sessionId, entry, index) {
    const row = document.createElement('article');
    row.className = 'session-row session-row--attention';
    row.dataset.state = 'failed';
    row.setAttribute('role', 'listitem');

    const title = document.createElement('div');
    title.className = 'session-row__title';
    const name = document.createElement('strong');
    name.className = 'session-row__name';
    name.textContent = entry.originalName || 'Upload rejected';
    if (name.textContent) {
      name.title = name.textContent;
    }
    title.appendChild(name);
    const tag = document.createElement('span');
    tag.className = 'session-row__tag';
    tag.textContent = 'Rejected';
    title.appendChild(tag);

    const indicators = document.createElement('div');
    indicators.className = 'status-list session-row__statuses';
    indicators.appendChild(createStatusIndicator('Upload', 'failed'));
    indicators.appendChild(createStatusIndicator('Processing', 'failed'));

    const message = document.createElement('p');
    message.className = 'session-row__message';
    message.textContent = entry.reason || 'The file could not be uploaded. Please try again.';

    const actions = document.createElement('div');
    actions.className = 'session-row__actions';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn-sm btn-primary';
    retryBtn.textContent = 'Upload again';
    retryBtn.addEventListener('click', () => {
      promptRetryUpload(entry.originalName);
    });
    actions.appendChild(retryBtn);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn-sm btn-outline-secondary';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      dismissRejected(sessionId, index);
    });
    actions.appendChild(dismissBtn);

    row.append(title, indicators, message, actions);
    return row;
  }

  // createStatusIndicator defined earlier

  function normaliseFileRecord(sessionId, file) {
    const record = state.files.get(file.fileId) || {
      sessionId,
      fileId: file.fileId,
      upload: 'queued',
      processing: 'queued',
      message: '',
      state: 'queued',
    };
    if (file.originalName) {
      record.originalName = file.originalName;
    }
    if (file.upload) {
      record.upload = normaliseStatus(file.upload, 'completed');
    } else if (!record.upload) {
      record.upload = 'queued';
    }
    if (file.state) {
      record.state = String(file.state);
      record.processing = normaliseStatus(file.state, 'queued');
    } else if (file.processing) {
      record.processing = normaliseStatus(file.processing, 'queued');
    } else if (!record.processing) {
      record.processing = 'queued';
    }
    if (file.classification) {
      record.classification = file.classification;
    }
    if (file.message != null) {
      record.message = file.message;
    } else if (record.message == null) {
      record.message = '';
    }
    if (!record.message) {
      if (record.state === 'needs_trim') {
        record.message = 'Manual trim required before processing.';
      } else if (record.state === 'awaiting_manual_json') {
        record.message = 'Manual JSON input required before processing.';
      }
    }
    state.files.set(file.fileId, record);
    return record;
  }

  function upsertSession(sessionId) {
    if (!state.sessions.has(sessionId)) {
      state.sessions.set(sessionId, { files: new Map(), rejected: [] });
    }
    return state.sessions.get(sessionId);
  }

  function handleUploadResponse(payload) {
    if (!payload) return;
    const sessionId = payload.sessionId
      || ((typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const session = upsertSession(sessionId);
    if (Array.isArray(payload.files)) {
      payload.files.forEach((file) => {
        if (!file.fileId) return;
        const initialState = file.state || file.processing || 'queued';
        const record = normaliseFileRecord(sessionId, {
          ...file,
          upload: 'completed',
          processing: initialState,
          state: initialState,
        });
        session.files.set(file.fileId, record);
      });
    }
    if (Array.isArray(payload.rejected)) {
      payload.rejected.forEach((entry) => {
        session.rejected.push({ originalName: entry.originalName, reason: entry.reason });
      });
    }
    renderSessionPanel();
    queueStatusPolling();
    queueRefresh();
  }

  function showError(message) {
    sessionRows.innerHTML = '';
    sessionEmpty.style.display = '';
    sessionEmpty.textContent = message;
    hideProgress();
  }

  async function uploadFile(file, { placeholderId } = {}) {
    const formData = new FormData();
    formData.append('file', file, file.name);
    if (state.selectedCollectionId) {
      formData.append('collectionId', state.selectedCollectionId);
    }
    try {
      if (window.Auth && typeof Auth.requireAuth === 'function') {
        await Auth.requireAuth();
      }
      const response = await apiFetch('/upload', { method: 'POST', body: formData });
      if (!response.ok) {
        const text = await safeJson(response);
        const errorMessage = response.status === 401 ? 'Your session has expired. Please sign in again.' : (text?.error || 'Upload failed');
        throw new Error(errorMessage);
      }
      const json = await response.json();
      handleUploadResponse(json);
    } catch (error) {
      console.error('Upload error', error);
      if (error.message && error.message.toLowerCase().includes('sign in')) {
        handleUnauthorised(error.message);
      } else {
        showError(error.message || 'Upload failed');
      }
    } finally {
      completePlaceholder(placeholderId);
    }
  }

  function handleFiles(fileList) {
    if (!fileList || !fileList.length) {
      setSessionReminder('');
      removeDropzoneHighlight();
      return;
    }
    setSessionReminder('');
    Array.from(fileList).forEach((file) => {
      const ext = (file.name || '').toLowerCase();
      if (!(ext.endsWith('.pdf') || ext.endsWith('.zip'))) {
        showError('We only accept PDF or ZIP uploads.');
        removeDropzoneHighlight();
        return;
      }
      const phase = ext.endsWith('.zip') ? 'Extracting zip' : 'Uploading files';
      const placeholderId = beginPlaceholder({ phase });
      uploadFile(file, { placeholderId });
    });
    fileInput.value = '';
    removeDropzoneHighlight();
  }

  function setupDropzone() {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('drag-active');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-active');
      removeDropzoneHighlight();
    });
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag-active');
      handleFiles(event.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => handleFiles(fileInput.files));
  }

  if (sessionClearBtn) {
    sessionClearBtn.addEventListener('click', () => {
      if (!state.sessions.size) {
        clearSessionHistory();
        return;
      }
      const confirmClear = window.confirm('Clear upload history? This only removes the queue from this device.');
      if (!confirmClear) return;
      clearSessionHistory();
      setSessionReminder('');
      removeDropzoneHighlight();
    });
  }

  async function pollFileStatus(fileId) {
    try {
      const response = await apiFetch(`/files/${encodeURIComponent(fileId)}/status`);
      if (response.status === 404) {
        const record = state.files.get(fileId);
        if (record) {
          state.files.delete(fileId);
          const session = state.sessions.get(record.sessionId);
          if (session) {
            session.files.delete(fileId);
            if (session.files.size === 0 && session.rejected.length === 0) {
              state.sessions.delete(record.sessionId);
            }
          }
          renderSessionPanel();
        }
        return;
      }
      if (!response.ok) return;
      const data = await response.json();
      const record = state.files.get(fileId);
      if (!record) return;
      const previousProcessing = normaliseStatus(record.processing, 'queued');
      record.upload = normaliseStatus(data.upload || record.upload, 'completed');
      if (data.state) {
        record.state = String(data.state);
        record.processing = normaliseStatus(data.state, 'queued');
      } else if (data.processing) {
        record.processing = normaliseStatus(data.processing, 'queued');
      }
      if (data.classification) {
        record.classification = data.classification;
      }
      const serverMessage = typeof data.message === 'string' ? data.message : '';
      if (serverMessage) {
        record.message = serverMessage;
      } else if (record.state === 'needs_trim') {
        record.message = 'Manual trim required before processing.';
      } else if (record.state === 'awaiting_manual_json') {
        record.message = 'Manual JSON input required before processing.';
      } else if (!record.message) {
        record.message = '';
      }
      const session = state.sessions.get(record.sessionId);
      if (session) {
        session.files.set(fileId, record);
      }
      renderSessionPanel();
      if (previousProcessing !== 'completed' && record.processing === 'completed') {
        queueRefresh();
      }
    } catch (error) {
      console.warn('Status poll failed', error);
    }
  }

  function queueStatusPolling() {
    if (state.timers.uploads) return;
    state.timers.uploads = setInterval(() => {
      for (const fileId of state.files.keys()) {
        pollFileStatus(fileId);
      }
    }, POLL_INTERVAL_UPLOAD);
  }

  async function fetchFeatureFlags() {
    try {
      const response = await authFetch('/api/flags', { cache: 'no-store' });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to continue.');
        return;
      }
      if (!response.ok) return;
      const flags = await response.json().catch(() => null);
      jsonTestEnabled = Boolean(flags?.JSON_TEST_ENABLED);
    } catch (error) {
      console.warn('Failed to load feature flags', error);
    }
  }

  async function fetchTiles() {
    try {
      const response = await apiFetch('/tiles');
      if (!response.ok) return;
      const data = await response.json();
      renderTiles(data);
    } catch (error) {
      console.warn('Tile fetch failed', error);
    }
  }

  function renderTiles(data) {
    const tiles = [];
    const raw = data?.tiles || {};
    tiles.push({
      id: 'payslips',
      label: 'Payslips',
      count: raw.payslips?.count || 0,
      updated: raw.payslips?.lastUpdated || null,
    });
    tiles.push({
      id: 'statements',
      label: 'Statements',
      count: (raw.statements?.count || 0) + (raw.savings?.count || 0),
      updated: raw.statements?.lastUpdated || raw.savings?.lastUpdated || null,
    });
    tiles.push({
      id: 'savings-isa',
      label: 'Savings & ISA',
      count: (raw.savings?.count || 0) + (raw.isa?.count || 0),
      updated: raw.isa?.lastUpdated || raw.savings?.lastUpdated || null,
    });
    tiles.push({
      id: 'investments',
      label: 'Investments',
      count: raw.investments?.count || 0,
      updated: raw.investments?.lastUpdated || null,
    });
    tiles.push({
      id: 'pensions',
      label: 'Pensions',
      count: raw.pension?.count || 0,
      updated: raw.pension?.lastUpdated || null,
    });
    tiles.push({
      id: 'hmrc',
      label: 'HMRC',
      count: raw.hmrc?.count || 0,
      updated: raw.hmrc?.lastUpdated || null,
    });

    tilesGrid.innerHTML = '';

    tiles.forEach((tile) => {
      const card = document.createElement('article');
      card.className = 'tile';
      card.dataset.tileId = tile.id;
      card.dataset.tileCount = String(tile.count ?? 0);

      const isInteractive = tile.id === 'payslips' || tile.id === 'statements';
      if (isInteractive) {
        card.classList.add('tile--interactive');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `View ${tile.label} documents`);
        card.tabIndex = 0;
        const handleOpen = (event) => {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
          if (card.classList.contains('tile-is-busy')) return;
          handleTileOpen(tile, card);
        };
        card.addEventListener('click', handleOpen);
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            handleOpen(event);
          }
        });
      }

      const header = document.createElement('div');
      header.className = 'tile-header';

      const labelGroup = document.createElement('div');
      labelGroup.className = 'tile-label';

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = tile.label;

      const count = document.createElement('strong');
      count.textContent = tile.count.toLocaleString();
      labelGroup.append(label, count);

      const actions = document.createElement('div');
      actions.className = 'tile-actions';

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'tile-delete-btn btn-icon';
      deleteButton.innerHTML = '<i class="bi bi-trash"></i>';
      deleteButton.setAttribute('aria-label', `Delete all ${tile.label} documents`);
      deleteButton.title = tile.count
        ? `Delete all ${tile.label} documents`
        : `No ${tile.label.toLowerCase()} documents to delete`;
      deleteButton.disabled = tile.count === 0;
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        handleTileDelete(tile, card, deleteButton);
      });
      actions.appendChild(deleteButton);

      header.append(labelGroup, actions);
      card.appendChild(header);

      if (tile.updated) {
        const updated = document.createElement('span');
        updated.className = 'muted tile-updated';
        updated.textContent = `Updated ${new Date(tile.updated).toLocaleString()}`;
        card.appendChild(updated);
      }

      tilesGrid.appendChild(card);
    });

    if ((data?.processing || 0) > 0) {
      const pill = document.createElement('div');
      pill.className = 'processing-pill';
      pill.textContent = `${data.processing} processing…`;
      tilesGrid.prepend(pill);
    }
  }

  function withTileLoading(card, label = 'Loading…') {
    if (!card) return () => {};
    let overlay = card.querySelector('.tile-loading');
    if (overlay) {
      overlay.remove();
    }
    overlay = document.createElement('div');
    overlay.className = 'tile-loading';
    overlay.innerHTML = `
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      <span>${label}</span>
    `;
    card.appendChild(overlay);
    card.classList.add('tile-is-busy');
    card.setAttribute('aria-busy', 'true');
    return () => {
      card.classList.remove('tile-is-busy');
      card.removeAttribute('aria-busy');
      if (overlay && overlay.isConnected) {
        overlay.remove();
      }
    };
  }

  async function handleTileOpen(tile, card) {
    if (!tile || !card) return;
    const cleanup = withTileLoading(card);
    try {
      if (tile.id === 'payslips') {
        await openPayslipTile();
      } else if (tile.id === 'statements') {
        await openStatementTile();
      }
    } catch (error) {
      console.error('Tile open failed', error);
      window.alert(error.message || `Unable to load ${tile.label || 'documents'} right now.`);
    } finally {
      cleanup();
    }
  }

  async function openPayslipTile() {
    const response = await apiFetch('/payslips/employers');
    if (response.status === 401) {
      handleUnauthorised('Please sign in again to view your payslips.');
      return;
    }
    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload?.error || 'Unable to load payslips.');
    }

    const data = await response.json();
    const employers = Array.isArray(data?.employers) ? data.employers : [];
    if (!employers.length) {
      showViewer({ type: 'payslip', title: 'Payslips', subtitle: 'No documents yet', files: [] });
      return;
    }

    const files = [];
    for (const employer of employers) {
      const employerId = employer?.employerId;
      if (!employerId) continue;
      const detailResponse = await apiFetch(`/payslips/employers/${encodeURIComponent(employerId)}/files`);
      if (detailResponse.status === 401) {
        handleUnauthorised('Please sign in again to view your payslips.');
        return;
      }
      if (!detailResponse.ok) {
        const payload = await safeJson(detailResponse);
        const name = employer?.name || 'employer';
        throw new Error(payload?.error || `Unable to load payslips for ${name}.`);
      }
      const detailData = await detailResponse.json();
      const employerName = employer?.name || detailData?.employer || 'Employer';
      const viewerFiles = normalisePayslipViewerFiles(detailData?.files, {
        employerName,
        includeEmployerInSummary: true,
      });
      files.push(...viewerFiles);
    }

    const subtitleParts = [];
    if (files.length) {
      subtitleParts.push(`${files.length} document${files.length === 1 ? '' : 's'}`);
    }
    subtitleParts.push(`${employers.length} employer${employers.length === 1 ? '' : 's'}`);

    const subtitle = files.length ? subtitleParts.join(' · ') : 'No documents yet';
    showViewer({
      type: 'payslip',
      title: 'Payslips',
      subtitle,
      files,
    });
  }

  async function openStatementTile() {
    const response = await apiFetch('/statements/institutions');
    if (response.status === 401) {
      handleUnauthorised('Please sign in again to view your statements.');
      return;
    }
    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload?.error || 'Unable to load statements.');
    }

    const data = await response.json();
    const institutions = Array.isArray(data?.institutions) ? data.institutions : [];
    if (!institutions.length) {
      showViewer({ type: 'statement', title: 'Statements', subtitle: 'No documents yet', files: [] });
      return;
    }

    const files = [];
    let totalAccounts = 0;
    for (const institution of institutions) {
      const institutionId = institution?.institutionId;
      if (!institutionId) continue;
      const detailResponse = await apiFetch(`/statements/institutions/${encodeURIComponent(institutionId)}/files`);
      if (detailResponse.status === 401) {
        handleUnauthorised('Please sign in again to view your statements.');
        return;
      }
      if (!detailResponse.ok) {
        const payload = await safeJson(detailResponse);
        const name = institution?.name || 'institution';
        throw new Error(payload?.error || `Unable to load statements for ${name}.`);
      }
      const detailData = await detailResponse.json();
      const accounts = Array.isArray(detailData?.accounts) ? detailData.accounts : [];
      totalAccounts += accounts.length;
      const institutionName = normaliseStatementName(institution?.name || detailData?.institution?.name);
      const viewerFiles = normaliseStatementViewerFiles(accounts, {
        institutionName,
        includeInstitutionInSummary: true,
      });
      files.push(...viewerFiles);
    }

    const subtitleParts = [];
    if (files.length) {
      subtitleParts.push(`${files.length} document${files.length === 1 ? '' : 's'}`);
    }
    if (totalAccounts) {
      subtitleParts.push(`${totalAccounts} account${totalAccounts === 1 ? '' : 's'}`);
    }
    subtitleParts.push(`${institutions.length} institution${institutions.length === 1 ? '' : 's'}`);

    const subtitle = files.length ? subtitleParts.join(' · ') : 'No documents yet';
    showViewer({
      type: 'statement',
      title: 'Statements',
      subtitle,
      files,
    });
  }

  async function handleTileDelete(tile, card, button) {
    if (!tile || !card || !button || button.disabled) return;
    if (tile.count === 0) return;

    const countLabel = tile.count === 1 ? '1 document' : `${tile.count.toLocaleString()} documents`;
    const confirmed = window.confirm(
      `Delete ${countLabel} from ${tile.label}? This will permanently remove the files from your vault and Cloudflare R2.`
    );
    if (!confirmed) return;

    const originalContent = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    card.classList.add('tile-is-busy');

    try {
      const response = await apiFetch(`/tiles/${encodeURIComponent(tile.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await safeJson(response);
        throw new Error(payload?.error || 'Failed to delete documents');
      }
      await animateOnce(card, 'tile--cleared', { duration: 520 });
      await Promise.all([fetchTiles(), fetchPayslips(), fetchStatements(), fetchCollections()]);
    } catch (error) {
      console.error('Tile delete failed', error);
      alert(error.message || 'Failed to delete documents');
    } finally {
      if (button.isConnected) {
        button.classList.remove('is-loading');
        button.innerHTML = originalContent;
        button.disabled = false;
      }
      card.classList.remove('tile-is-busy');
    }
  }

  async function fetchPayslips() {
    try {
      const response = await apiFetch('/payslips/employers');
      if (!response.ok) return;
      const data = await response.json();
      renderEmployerGrid(data?.employers || []);
    } catch (error) {
      console.warn('Payslip fetch failed', error);
    }
  }

  async function openPayslipViewer(employer) {
    if (!employer?.employerId) return;
    try {
      const response = await apiFetch(`/payslips/employers/${encodeURIComponent(employer.employerId)}/files`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to view your payslips.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Unable to load payslips');
      }
      const data = await response.json();
      const employerName = employer.name || data?.employer || 'Employer';
      const files = normalisePayslipViewerFiles(data?.files, { employerName, includeEmployerInSummary: false });
      showViewer({
        type: 'payslip',
        title: employerName,
        subtitle: files.length ? `${files.length} document${files.length === 1 ? '' : 's'}` : 'No documents yet',
        files,
      });
    } catch (error) {
      console.error('Failed to open payslip viewer', error);
      window.alert(error.message || 'Unable to load payslip documents right now.');
    }
  }

  function renderEmployerGrid(employers) {
    payslipGrid.innerHTML = '';
    const list = Array.isArray(employers) ? employers : [];
    payslipMeta.textContent = list.length
      ? `${list.length} employer${list.length === 1 ? '' : 's'}`
      : 'No payslips yet.';

    list.forEach((employer) => {
      const employerName = normaliseEmployerName(employer);
      const employerRef = { ...employer, name: employerName };
      const fileCount =
        normaliseCount(
          employer.count ?? employer.fileCount ?? employer.files ?? employer.documents ?? employer.documentCount
        ) ?? null;
      const lastPaySource =
        employer.lastPayDate ?? employer.latestPayDate ?? employer.latest?.date ?? employer.mostRecentDate ?? null;
      const lastPayDate = toDateLike(lastPaySource);
      const lastPayLabel = lastPayDate ? lastPayDate.toLocaleDateString() : '—';
      const subtitleParts = [];
      const fileSummary = formatCountLabel(fileCount, 'document');
      if (fileSummary) subtitleParts.push(fileSummary);
      if (lastPayDate) subtitleParts.push(`Last pay ${lastPayLabel}`);
      const subtitleText = subtitleParts.join(' • ') || 'View payslips';

      const card = document.createElement('article');
      applyEntityBranding(card, employerName);
      card.classList.add('vault-card--interactive', 'vault-card--payslip');

      const header = document.createElement('div');
      header.className = 'vault-card__header';

      const icon = document.createElement('div');
      icon.className = 'vault-card__icon vault-card__icon--payslip';
      icon.innerHTML = '<i class="bi bi-receipt"></i>';

      const text = document.createElement('div');
      text.className = 'vault-card__text';

      const title = document.createElement('h3');
      title.className = 'vault-card__title';
      title.textContent = employerName || 'Employer';

      const subtitle = document.createElement('p');
      subtitle.className = 'vault-card__subtitle';
      subtitle.textContent = subtitleText;

      const chevron = document.createElement('div');
      chevron.className = 'vault-card__chevron';
      chevron.innerHTML = '<i class="bi bi-arrow-up-right"></i>';

      text.append(title, subtitle);
      header.append(icon, text, chevron);

      const meta = document.createElement('dl');
      meta.className = 'vault-card__meta';
      meta.append(createMetaRow('Files', fileCount != null ? formatNumber(fileCount) : '—'));
      meta.append(createMetaRow('Last pay date', lastPayLabel));

      card.append(header, meta);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `View payslips for ${employerName || 'employer'}`);

      const open = () => openPayslipViewer(employerRef);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      payslipGrid.appendChild(card);
    });
  }

  async function fetchStatements() {
    try {
      const response = await apiFetch('/statements/institutions');
      if (!response.ok) return;
      const data = await response.json();
      renderInstitutionGrid(data?.institutions || []);
    } catch (error) {
      console.warn('Statements fetch failed', error);
    }
  }

  async function openStatementViewer(institution) {
    if (!institution?.institutionId) return;
    try {
      const response = await apiFetch(`/statements/institutions/${encodeURIComponent(institution.institutionId)}/files`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to view your statements.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Unable to load statements');
      }
      const data = await response.json();
      const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
      const institutionName = normaliseStatementName(
        institution.name || institution.institution?.name || data?.institution?.name
      );
      const files = normaliseStatementViewerFiles(accounts, {
        institutionName,
        includeInstitutionInSummary: false,
      });
      showViewer({
        type: 'statement',
        title: institutionName,
        subtitle: files.length ? `${files.length} document${files.length === 1 ? '' : 's'}` : 'No documents yet',
        files,
      });
    } catch (error) {
      console.error('Failed to open statements viewer', error);
      window.alert(error.message || 'Unable to load statement documents right now.');
    }
  }

  function renderInstitutionGrid(institutions) {
    statementGrid.innerHTML = '';
    const list = Array.isArray(institutions) ? institutions : [];
    statementMeta.textContent = list.length
      ? `${list.length} institution${list.length === 1 ? '' : 's'}`
      : 'No statements yet.';

    list.forEach((inst) => {
      const cleanName = normaliseInstitutionDisplayName(inst);
      const institutionRef = { ...inst, name: cleanName };
      const accountCountSource = Array.isArray(inst.accounts) ? inst.accounts.length : inst.accounts ?? inst.accountCount;
      const accountCount = normaliseCount(accountCountSource);
      const documentCountSource =
        inst.documents ??
        inst.documentCount ??
        inst.files ??
        inst.count ??
        (Array.isArray(inst.documents) ? inst.documents.length : null);
      const documentCount = normaliseCount(documentCountSource);
      const lastStatementSource =
        inst.lastStatementDate ?? inst.latestStatementDate ?? inst.lastDocumentDate ?? inst.updated ?? inst.latest?.date ?? null;
      const lastStatementDate = toDateLike(lastStatementSource);
      const lastStatementLabel = lastStatementDate ? lastStatementDate.toLocaleDateString() : '—';

      const subtitleParts = [];
      const documentSummary = formatCountLabel(documentCount, 'document');
      if (documentSummary) subtitleParts.push(documentSummary);
      const accountSummary = formatCountLabel(accountCount, 'account');
      if (!documentSummary && accountSummary) subtitleParts.push(accountSummary);
      if (lastStatementDate) subtitleParts.push(`Updated ${lastStatementLabel}`);
      const subtitleText = subtitleParts.join(' • ') || 'View statements';

      const card = document.createElement('article');
      applyEntityBranding(card, cleanName);
      card.classList.add('vault-card--interactive', 'vault-card--statement');

      const header = document.createElement('div');
      header.className = 'vault-card__header';

      const icon = document.createElement('div');
      icon.className = 'vault-card__icon vault-card__icon--statement';
      icon.innerHTML = '<i class="bi bi-bank"></i>';

      const text = document.createElement('div');
      text.className = 'vault-card__text';

      const title = document.createElement('h3');
      title.className = 'vault-card__title';
      title.textContent = cleanName || 'Institution';

      const subtitle = document.createElement('p');
      subtitle.className = 'vault-card__subtitle';
      subtitle.textContent = subtitleText;

      const chevron = document.createElement('div');
      chevron.className = 'vault-card__chevron';
      chevron.innerHTML = '<i class="bi bi-arrow-up-right"></i>';

      text.append(title, subtitle);
      header.append(icon, text, chevron);

      const meta = document.createElement('dl');
      meta.className = 'vault-card__meta';
      meta.append(createMetaRow('Accounts', accountCount != null ? formatNumber(accountCount) : '—'));
      if (documentCount != null) {
        meta.append(createMetaRow('Documents', formatNumber(documentCount)));
      }
      meta.append(createMetaRow('Last statement', lastStatementLabel));

      card.append(header, meta);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `View statements for ${cleanName || 'institution'}`);

      const open = () => openStatementViewer(institutionRef);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      statementGrid.appendChild(card);
    });
  }

  async function fetchCollections() {
    try {
      const response = await apiFetch('/collections');
      if (!response.ok) return;
      const data = await response.json();
      renderCollections(data?.collections || []);
    } catch (error) {
      console.warn('Collections fetch failed', error);
    }
  }

  async function promptCollectionCreate() {
    const name = window.prompt('Name your new collection');
    if (!name || !name.trim()) return;
    try {
      const response = await apiFetch('/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to create a collection.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Create failed');
      }
      const json = await response.json().catch(() => ({}));
      const newId = json?.collection?.id || null;
      await fetchCollections();
      if (newId) {
        state.selectedCollectionId = newId;
        renderCollectionSelection();
        updateCollectionTargetHint();
      }
    } catch (error) {
      console.error('Failed to create collection', error);
      window.alert(error.message || 'Unable to create the collection right now.');
    }
  }

  async function promptCollectionRename(collection) {
    if (!collection?.id) return;
    const name = window.prompt('Rename collection', collection.name || 'Collection');
    if (!name || !name.trim() || name.trim() === collection.name) return;
    try {
      const response = await apiFetch(`/collections/${encodeURIComponent(collection.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to rename collections.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Rename failed');
      }
      await fetchCollections();
    } catch (error) {
      console.error('Failed to rename collection', error);
      window.alert(error.message || 'Unable to rename this collection right now.');
    }
  }

  async function deleteCollection(collection) {
    if (!collection?.id) return;
    const confirmed = window.confirm('Are you sure you want to delete this collection and all contained files? This action is irreversible.');
    if (!confirmed) return;
    try {
      const response = await apiFetch(`/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to delete collections.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Delete failed');
      }
      if (state.selectedCollectionId === collection.id) {
        state.selectedCollectionId = null;
      }
      await fetchCollections();
      updateCollectionTargetHint();
    } catch (error) {
      console.error('Failed to delete collection', error);
      window.alert(error.message || 'Unable to delete this collection right now.');
    }
  }

  async function downloadCollection(collection) {
    if (!collection?.id) return;
    try {
      const response = await apiFetch(`/collections/${encodeURIComponent(collection.id)}/archive`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to download collections.');
        return;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || 'Download failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(collection.name || 'collection').replace(/[^\w. -]+/g, '_')}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      console.error('Failed to download collection', error);
      window.alert(error.message || 'Unable to download this collection right now.');
    }
  }

  function selectCollection(collectionId) {
    state.selectedCollectionId = state.selectedCollectionId === collectionId ? null : collectionId;
    renderCollectionSelection();
    updateCollectionTargetHint();
  }

  function renderCollectionSelection() {
    if (!collectionGrid) return;
    const cards = collectionGrid.querySelectorAll('.collection-card');
    cards.forEach((card) => {
      const id = card.dataset.collectionId || null;
      card.classList.toggle('is-selected', id && id === state.selectedCollectionId);
    });
  }

  function buildCollectionCard(collection) {
    const card = document.createElement('article');
    card.className = 'collection-card';
    card.dataset.collectionId = collection.id;
    if (state.selectedCollectionId === collection.id) {
      card.classList.add('is-selected');
    }
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Select collection ${collection.name || 'collection'}`);

    const title = document.createElement('h3');
    title.className = 'collection-card__title';
    title.textContent = collection.name || 'Collection';

    const meta = document.createElement('div');
    meta.className = 'collection-card__meta';
    meta.innerHTML = `
      <span>${formatNumber(collection.fileCount || 0)} file${collection.fileCount === 1 ? '' : 's'}</span>
      <span>${collection.lastUpdated ? `Updated ${formatDate(collection.lastUpdated)}` : 'No recent uploads'}</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'collection-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      promptCollectionRename(collection);
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      downloadCollection(collection);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteCollection(collection);
    });

    actions.append(renameBtn, downloadBtn, deleteBtn);

    card.append(title, meta, actions);

    const select = () => selectCollection(collection.id);
    card.addEventListener('click', select);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });

    return card;
  }

  function renderCollections(collections) {
    state.collections = Array.isArray(collections) ? collections : [];
    if (state.selectedCollectionId && !state.collections.some((collection) => collection.id === state.selectedCollectionId)) {
      state.selectedCollectionId = null;
    }
    if (collectionGrid) {
      collectionGrid.innerHTML = '';
      const createCard = document.createElement('button');
      createCard.type = 'button';
      createCard.className = 'collection-card collection-card__create';
      createCard.innerHTML = '<span>+ New collection</span>';
      createCard.addEventListener('click', (event) => {
        event.stopPropagation();
        promptCollectionCreate();
      });
      collectionGrid.appendChild(createCard);
      state.collections.forEach((collection) => {
        collectionGrid.appendChild(buildCollectionCard(collection));
      });
      renderCollectionSelection();
    }
    collectionMeta.textContent = state.collections.length
      ? `${state.collections.length} collection${state.collections.length === 1 ? '' : 's'}`
      : 'No collections yet.';
    updateCollectionTargetHint();
  }

  function queueRefresh() {
    if (!state.timers.tiles) {
      fetchTiles();
      state.timers.tiles = setInterval(fetchTiles, POLL_INTERVAL_TILES);
    }
    if (!state.timers.lists) {
      fetchPayslips();
      fetchStatements();
      fetchCollections();
      state.timers.lists = setInterval(() => {
        fetchPayslips();
        fetchStatements();
        fetchCollections();
      }, POLL_INTERVAL_LISTS);
    }
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function init() {
    if (window.Auth && typeof Auth.requireAuth === 'function') {
      try {
        await Auth.requireAuth();
      } catch (error) {
        console.warn('Auth required for vault page', error);
        handleUnauthorised('Please sign in to access your vault.');
        return;
      }
    }

    setupDropzone();
    await fetchFeatureFlags();
    restoreSessionsFromStorage();
    queueRefresh();
    fetchTiles();
    fetchPayslips();
    fetchStatements();
    fetchCollections();
  }

  if (viewerClose) {
    viewerClose.addEventListener('click', () => {
      closeViewer();
    });
  }
  if (viewerOverlay) {
    viewerOverlay.addEventListener('click', () => {
      closeViewer();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (trimModal && trimModal.classList.contains('is-visible')) {
      event.preventDefault();
      hideTrimModal();
      return;
    }
    if (jsonModal && jsonModal.classList.contains('is-visible')) {
      hideJsonModal();
      return;
    }
    if (viewerRoot && viewerRoot.getAttribute('aria-hidden') === 'false') {
      closeViewer();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('Failed to initialise vault page', error);
      showError('Something went wrong initialising the vault. Please try again.');
    });
  });
})();
