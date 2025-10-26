'use strict';

let dateFns;
try {
  dateFns = require('date-fns');
} catch (error) {
  dateFns = null;
}

const parse = dateFns?.parse;
const parseISO = dateFns?.parseISO;
const format = dateFns?.format;
const isValid = dateFns?.isValid;

function buildLogger() {
  const level = process.env.LOG_LEVEL ?? 'info';
  try {
    const pino = require('pino');
    return pino({ name: 'insight-normalizer', level });
  } catch (error) {
    const fallback = {};
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    levels.forEach((lvl) => {
      const consoleMethod = typeof console[lvl] === 'function' ? console[lvl].bind(console) : console.log.bind(console);
      fallback[lvl] = (...args) => consoleMethod('[insight-normalizer]', ...args);
    });
    fallback.child = () => fallback;
    return fallback;
  }
}

const log = buildLogger();

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (dateFns?.isValid) {
      return isValid(value) ? value : null;
    }
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const text = String(value);
  if (!text) return null;
  if (parseISO) {
    try {
      const parsed = parseISO(text);
      if (!parsed || (isValid && !isValid(parsed))) {
        // continue to native parsing
      } else {
        if (!isValid || isValid(parsed)) {
          return parsed;
        }
      }
    } catch (error) {
      // ignore and fallback to native
    }
  }
  const native = new Date(text);
  if (!Number.isNaN(native.getTime())) {
    return native;
  }
  const patterns = ['dd/MM/yyyy', 'd/M/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy', 'dd-MM-yyyy', 'd-M-yyyy', 'MM/yyyy'];
  if (parse) {
    for (const pattern of patterns) {
      try {
        const parsed = parse(text, pattern, new Date());
        if (!parsed) continue;
        if (!isValid || isValid(parsed)) {
          return parsed;
        }
      } catch (error) {
        // ignore parse failure
      }
    }
  }
  return null;
}

function toIsoDate(date) {
  if (!date) return null;
  if (format) {
    try {
      return format(date, 'yyyy-MM-dd');
    } catch (error) {
      // ignore and fallback
    }
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toIsoMonth(date) {
  if (!date) return null;
  if (format) {
    try {
      return format(date, 'yyyy-MM');
    } catch (error) {
      // ignore and fallback
    }
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

const toMinor = (value) => {
  if (value == null || value === '') return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
};

const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== '') ?? undefined;

function monthBoundsFrom(date) {
  const startDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const endDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return {
    start: toIsoDate(startDate),
    end: toIsoDate(endDate),
    month: toIsoMonth(date),
  };
}

function ensureValidPeriod(date, documentMonth) {
  if (documentMonth && /^\d{4}-\d{2}$/.test(documentMonth)) {
    const [year, month] = documentMonth.split('-').map((part) => Number(part));
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return {
      start: toIsoDate(start),
      end: toIsoDate(end),
      month: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
    };
  }
  return monthBoundsFrom(date);
}

function normaliseDeductionCategory(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return '';
  if (['ni', 'national insurance', 'national_insurance', 'nationalinsurance'].includes(key)) {
    return 'national_insurance';
  }
  if (['pension', 'pension_employee', 'pension employee', 'ae', 'autoenrolment', 'auto_enrolment'].includes(key)) {
    return 'pension_employee';
  }
  if (['studentloan', 'student_loan', 'student loan'].includes(key)) {
    return 'student_loan';
  }
  if (['incometax', 'income_tax', 'income tax', 'tax'].includes(key)) {
    return 'income_tax';
  }
  return key.replace(/\s+/g, '_');
}

function buildPayslipMetricsV1(di) {
  try {
    if (!di || (di.insightType && di.insightType !== 'payslip')) {
      return null;
    }
    const candidates = [
      di.documentDateV1,
      di.documentDate,
      di?.metadata?.documentDate,
      di?.metadata?.payDate,
      di?.metadata?.period?.end,
      di?.metadata?.period?.Date,
      di?.documentMonth ? `${di.documentMonth}-28` : null,
    ];
    let payDateValue = null;
    for (const candidate of candidates) {
      const parsed = toDate(candidate);
      if (parsed) {
        payDateValue = parsed;
        break;
      }
    }
    if (!payDateValue) {
      log.warn({ id: di?._id }, 'Payslip: unable to determine pay date');
      return null;
    }
    const payDate = toIsoDate(payDateValue);
    const period = ensureValidPeriod(payDateValue, di?.documentMonth);

    const earnings = Array.isArray(di?.metadata?.earnings) ? di.metadata.earnings : [];
    const deductions = Array.isArray(di?.metadata?.deductions) ? di.metadata.deductions : [];
    const totals = di?.metadata?.totals ?? {};
    const sum = (items) => items.reduce((acc, item) => acc + (Number(item?.amountPeriod) || 0), 0);

    const grossMinor = toMinor(first(totals?.grossPeriod, sum(earnings)));
    const netMinor = toMinor(first(totals?.netPeriod, sum(earnings) - sum(deductions)));

    const findDeduction = (category) => {
      const match = deductions.find((item) => normaliseDeductionCategory(item?.category) === category);
      if (match) {
        return toMinor(match.amountPeriod);
      }
      return 0;
    };

    const employerName = first(di?.metadata?.employer?.name, di?.metadata?.employerName);
    const taxCode = first(di?.metadata?.employee?.taxCode, di?.metadata?.taxCode) ?? null;

    const metrics = {
      payDate,
      period,
      employer: employerName ? { name: employerName } : null,
      grossMinor,
      netMinor,
      taxMinor: findDeduction('income_tax'),
      nationalInsuranceMinor: findDeduction('national_insurance'),
      pensionMinor: findDeduction('pension_employee'),
      studentLoanMinor: findDeduction('student_loan'),
      taxCode,
    };

    log.info({ id: di?._id, payDate, month: period.month }, 'Payslip: metrics generated');
    return metrics;
  } catch (error) {
    log.error({ id: di?._id, err: String(error) }, 'Payslip: metrics build failed');
    return null;
  }
}

function buildStatementV1(di) {
  try {
    if (!di) {
      return null;
    }
    const type = String(di.insightType ?? di.catalogueKey ?? '').toLowerCase();
    const isStatement =
      type === 'bank_statement' ||
      type === 'current_account_statement' ||
      type === 'savings_account_statement' ||
      type === 'isa_statement' ||
      type === 'investment_statement' ||
      type === 'pension_statement';
    if (!isStatement) {
      return null;
    }

    const txCandidates = Array.isArray(di.transactionsV1)
      ? di.transactionsV1
      : Array.isArray(di?.metadata?.transactions)
      ? di.metadata.transactions
      : Array.isArray(di?.metadata?.lines)
      ? di.metadata.lines
      : [];

    const toTxDate = (raw) => toDate(first(raw?.date, raw?.Date, raw?.['Transaction Date'], raw?.['Value Date'], raw?.['Posting Date']));

    const parsedDates = [];
    const transactionsV1 = [];

    txCandidates.forEach((raw) => {
      const dateValue = toTxDate(raw);
      if (dateValue) {
        parsedDates.push(dateValue);
      }
      const description = String(first(raw?.description, raw?.Description, raw?.['Transaction Description'], raw?.Details, ''))
        .trim();
      const credit = first(raw?.credit, raw?.Credit, raw?.['Money In'], raw?.['Amount (Cr)']);
      const debit = first(raw?.debit, raw?.Debit, raw?.['Money Out'], raw?.['Amount (Dr)']);
      const amount = first(raw?.amount, raw?.Amount, raw?.['Transaction Amount']);
      let amountMinor;
      if (amount != null && amount !== '') {
        amountMinor = toMinor(String(amount).replace(/,/g, ''));
      } else if (credit != null || debit != null) {
        amountMinor = toMinor(credit || 0) - toMinor(debit || 0);
      } else {
        amountMinor = 0;
      }
      const balance = first(raw?.balance, raw?.Balance, raw?.['Running Balance'], raw?.['Balance Amount']);
      const balanceMinor = balance != null ? toMinor(String(balance).replace(/,/g, '')) : null;
      if (dateValue) {
        transactionsV1.push({
          date: toIsoDate(dateValue),
          description,
          amountMinor,
          balanceMinor,
        });
      }
    });

    let periodStart;
    let periodEnd;
    if (di?.documentMonth && /^\d{4}-\d{2}$/.test(di.documentMonth)) {
      const [year, month] = di.documentMonth.split('-').map((part) => Number(part));
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 0));
      periodStart = toIsoDate(start);
      periodEnd = toIsoDate(end);
    } else if (parsedDates.length) {
      const min = parsedDates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
      const max = parsedDates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
      periodStart = toIsoDate(min);
      periodEnd = toIsoDate(max);
    } else {
      const fallback = toDate(first(di.documentDateV1, di.documentDate));
      if (fallback) {
        const bounds = monthBoundsFrom(fallback);
        periodStart = bounds.start;
        periodEnd = bounds.end;
      } else {
        const today = new Date();
        const bounds = monthBoundsFrom(today);
        periodStart = bounds.start;
        periodEnd = bounds.end;
      }
    }
    const periodMonth = periodStart ? periodStart.slice(0, 7) : null;

    const inflowsMinor = transactionsV1
      .filter((tx) => tx.amountMinor >= 0)
      .reduce((acc, tx) => acc + tx.amountMinor, 0);
    const outflowsMinor = transactionsV1
      .filter((tx) => tx.amountMinor < 0)
      .reduce((acc, tx) => acc + Math.abs(tx.amountMinor), 0);

    const openingBalanceMinor = first(
      di?.metadata?.openingBalance,
      di?.metadata?.balances?.opening,
      di?.metadata?.totals?.opening
    );
    const closingBalanceMinor = first(
      di?.metadata?.closingBalance,
      di?.metadata?.balances?.closing,
      di?.metadata?.totals?.closing
    );

    const account = {
      name: first(di?.metadata?.account?.name, di?.metadata?.accountName) ?? null,
      iban: first(di?.metadata?.account?.iban, di?.metadata?.iban) ?? null,
      sortCode: first(di?.metadata?.account?.sortCode, di?.metadata?.sortCode) ?? null,
      accountNumber: first(di?.metadata?.account?.number, di?.metadata?.accountNumber) ?? null,
    };

    const metrics = {
      account,
      period: { start: periodStart, end: periodEnd, month: periodMonth },
      openingBalanceMinor: openingBalanceMinor != null ? toMinor(openingBalanceMinor) : null,
      closingBalanceMinor: closingBalanceMinor != null ? toMinor(closingBalanceMinor) : null,
      inflowsMinor,
      outflowsMinor,
      netMinor: inflowsMinor - outflowsMinor,
      transactionsV1,
    };

    if (!transactionsV1.length) {
      log.warn({ id: di?._id }, 'Statement: no transactions derived');
    } else {
      log.info({ id: di?._id, count: transactionsV1.length }, 'Statement: tx normalized');
    }

    return metrics;
  } catch (error) {
    log.error({ id: di?._id, err: String(error) }, 'Statement: metrics build failed');
    return null;
  }
}

function normalizeInsightV1(di) {
  if (!di) return null;
  const type = String(di.insightType ?? di.catalogueKey ?? '').toLowerCase();
  if (type === 'payslip') {
    const existing = di.metricsV1 && typeof di.metricsV1 === 'object' ? di.metricsV1 : null;
    const ok = existing && existing.payDate && existing.period?.start && existing.grossMinor !== undefined;
    if (ok) return { kind: 'payslip', metricsV1: existing };
    return { kind: 'payslip', metricsV1: buildPayslipMetricsV1(di) };
  }
  const statementKinds = new Set([
    'bank_statement',
    'current_account_statement',
    'savings_account_statement',
    'isa_statement',
    'investment_statement',
    'pension_statement',
  ]);
  if (statementKinds.has(type)) {
    const metrics = buildStatementV1({ ...di, insightType: type, transactionsV1: di.transactionsV1 });
    if (metrics) return { kind: 'bank_statement', metricsV1: metrics };
    return { kind: 'bank_statement', metricsV1: null };
  }
  return { kind: type || 'unknown', metricsV1: null };
}

module.exports = {
  buildPayslipMetricsV1,
  buildStatementV1,
  normalizeInsightV1,
};
