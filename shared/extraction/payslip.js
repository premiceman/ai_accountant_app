"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPayslip = extractPayslip;
exports.analysePayslip = analysePayslip;
const openaiClient_js_1 = require("./openaiClient.js");
let pdfParsePromise = null;
async function loadPdfParse() {
    if (!pdfParsePromise) {
        pdfParsePromise = import('pdf-parse').then((mod) => mod.default ?? mod).catch((err) => {
            console.warn('[shared:payslip] pdf-parse unavailable', err?.message || err);
            return null;
        });
    }
    return pdfParsePromise;
}
async function extractPdfText(buffer) {
    if (!buffer || buffer.length === 0)
        return '';
    try {
        const pdfParse = await loadPdfParse();
        if (pdfParse) {
            const parsed = await pdfParse(buffer);
            if (parsed && typeof parsed.text === 'string') {
                return parsed.text;
            }
        }
    }
    catch (err) {
        console.warn('[shared:payslip] pdf-parse failed', err?.message || err);
    }
    try {
        if (Buffer.isBuffer(buffer)) {
            const str = buffer.toString('utf8');
            if (str.trim().length) {
                return str;
            }
        }
    }
    catch (err) {
        console.warn('[shared:payslip] fallback conversion failed', err?.message || err);
    }
    return '';
}
function normalise(str) {
    return String(str || '').replace(/\r\n?/g, '\n');
}
function parseMoneyTokens(str) {
    const matches = String(str || '').match(/-?£?\d[\d,]*\.?\d{0,2}/g);
    if (!matches)
        return [];
    return matches.map((token) => {
        const cleaned = token.replace(/[^0-9.\-]/g, '');
        const value = Number.parseFloat(cleaned);
        return Number.isFinite(value) ? value : null;
    }).filter((v) => v != null);
}
function cleanLabel(line) {
    return line
        .replace(/[-£]?\d[\d,]*\.?\d{0,2}/g, '')
        .replace(/ytd|year\s+to\s+date|this\s+period|period/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function detectPayFrequency(text) {
    const lower = text.toLowerCase();
    if (/four[-\s]?weekly/.test(lower))
        return { label: 'Four-weekly', periods: 13 };
    if (/fortnight/.test(lower))
        return { label: 'Fortnightly', periods: 26 };
    if (/weekly/.test(lower))
        return { label: 'Weekly', periods: 52 };
    if (/bi[-\s]?weekly/.test(lower))
        return { label: 'Bi-weekly', periods: 26 };
    if (/quarter/.test(lower))
        return { label: 'Quarterly', periods: 4 };
    if (/annual/.test(lower) || /yearly/.test(lower))
        return { label: 'Annual', periods: 1 };
    if (/monthly/.test(lower))
        return { label: 'Monthly', periods: 12 };
    return { label: null, periods: null };
}
function estimateAnnualisedGross(gross, grossYtd, periodsPerYear) {
    if (grossYtd && grossYtd > 0)
        return grossYtd;
    if (gross && periodsPerYear)
        return gross * periodsPerYear;
    if (gross)
        return gross * 12;
    return null;
}
function expectedUkMarginalRate(annualIncome) {
    if (!annualIncome || annualIncome <= 0)
        return null;
    if (annualIncome <= 12570)
        return 0;
    if (annualIncome <= 50270)
        return 0.32; // 20% income tax + 12% NI
    if (annualIncome <= 100000)
        return 0.42; // 40% tax + 2% NI
    if (annualIncome <= 125140)
        return 0.62; // personal allowance taper + NI
    if (annualIncome <= 150000)
        return 0.47; // 45% tax + 2% NI approx
    return 0.47; // 45% tax + 2% NI (rounded)
}
function sumAmounts(list) {
    return list.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
}
function normaliseBreakdown(list) {
    if (!Array.isArray(list))
        return [];
    return list
        .map((item) => ({
        label: item.label?.trim() || 'Item',
        amount: Number.isFinite(Number(item.amount)) ? Number(item.amount) : null,
        category: item.category || item.type || null,
    }))
        .filter((item) => item.amount != null);
}
function firstNumber(nums) {
    return nums.length ? nums[0] : null;
}
function lastNumber(nums) {
    return nums.length ? nums[nums.length - 1] : null;
}
function assignMetric(target, key, line, numbers) {
    const hasYtd = /ytd|year\s+to\s+date|cumulative/i.test(line);
    if (!numbers.length)
        return;
    if (hasYtd) {
        if (numbers.length > 1) {
            if (target[key] == null)
                target[key] = Math.abs(numbers[0]);
            const ytdKey = `${key}Ytd`;
            if (target[ytdKey] == null)
                target[ytdKey] = Math.abs(lastNumber(numbers));
        }
        else {
            const ytdKey = `${key}Ytd`;
            if (target[ytdKey] == null)
                target[ytdKey] = Math.abs(numbers[0]);
        }
    }
    else if (target[key] == null) {
        target[key] = Math.abs(numbers[0]);
    }
}
function parseTaxCode(text) {
    const match = text.match(/tax\s*code[:\s]+([A-Z0-9]{2,6})/i);
    return match ? match[1].trim() : null;
}
function parseDate(value) {
    if (!value)
        return null;
    const iso = new Date(value);
    if (!Number.isNaN(iso.getTime()))
        return iso.toISOString().slice(0, 10);
    const dmy = String(value).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (dmy) {
        const day = dmy[1].padStart(2, '0');
        const month = dmy[2].padStart(2, '0');
        const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
        return `${year}-${month}-${day}`;
    }
    const monthText = String(value).match(/([0-9]{1,2})\s+([A-Za-z]{3,9})\s*(\d{2,4})?/);
    if (monthText) {
        const monthNames = {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
        };
        const month = monthNames[monthText[2].slice(0, 3).toLowerCase()];
        if (month) {
            const day = monthText[1].padStart(2, '0');
            const yearRaw = monthText[3] || `${new Date().getFullYear()}`;
            const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw.padStart(4, '0');
            return `${year}-${month}-${day}`;
        }
    }
    return null;
}
async function llmPayslipExtraction(text) {
    const schema = {
        name: 'payslip_analysis',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                gross_pay: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        period: { type: ['number', 'null'] },
                        ytd: { type: ['number', 'null'] },
                    },
                },
                net_pay: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        period: { type: ['number', 'null'] },
                        ytd: { type: ['number', 'null'] },
                    },
                },
                deductions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            label: { type: 'string' },
                            amount: { type: ['number', 'null'] },
                            category: { type: ['string', 'null'] },
                        },
                    },
                },
                earnings: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            label: { type: 'string' },
                            amount: { type: ['number', 'null'] },
                            category: { type: ['string', 'null'] },
                        },
                    },
                },
                allowances: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            label: { type: 'string' },
                            amount: { type: ['number', 'null'] },
                        },
                    },
                },
                statutory: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        income_tax: { type: ['number', 'null'] },
                        national_insurance: { type: ['number', 'null'] },
                        pension: { type: ['number', 'null'] },
                        student_loan: { type: ['number', 'null'] },
                    },
                },
                pay_frequency: { type: ['string', 'null'] },
                tax_code: { type: ['string', 'null'] },
                notes: {
                    type: 'array',
                    items: { type: 'string' },
                },
                payment_date: { type: ['string', 'null'] },
                period_start: { type: ['string', 'null'] },
                period_end: { type: ['string', 'null'] },
                employee_name: { type: ['string', 'null'] },
                employer_name: { type: ['string', 'null'] },
            },
        },
        strict: true,
    };
    const prompt = `Extract the key payroll metrics from the following UK payslip. Return period values (this pay cycle) and year-to-date values when available.

${text.slice(0, 6000)}`;
    const response = await (0, openaiClient_js_1.callStructuredExtraction)(prompt, schema);
    if (!response)
        return null;
    return {
        raw: response,
        gross: response.gross_pay?.period ?? null,
        grossYtd: response.gross_pay?.ytd ?? null,
        net: response.net_pay?.period ?? null,
        netYtd: response.net_pay?.ytd ?? null,
        tax: response.statutory?.income_tax ?? null,
        ni: response.statutory?.national_insurance ?? null,
        pension: response.statutory?.pension ?? null,
        studentLoan: response.statutory?.student_loan ?? null,
        deductions: normaliseBreakdown(response.deductions),
        earnings: normaliseBreakdown(response.earnings),
        allowances: normaliseBreakdown(response.allowances),
        payFrequencyLabel: response.pay_frequency || null,
        taxCode: response.tax_code || null,
        notes: Array.isArray(response.notes) ? response.notes : [],
        payDate: parseDate(response.payment_date) || null,
        periodStart: parseDate(response.period_start) || null,
        periodEnd: parseDate(response.period_end) || null,
        employeeName: response.employee_name || null,
        employerName: response.employer_name || null,
        source: 'openai',
    };
}
function heuristicPayslipExtraction(text) {
    const lines = normalise(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const metrics = {};
    const deductions = [];
    const earnings = [];
    const allowances = [];
    lines.forEach((line, idx) => {
        const lower = line.toLowerCase();
        const numbers = parseMoneyTokens(line);
        const nextLine = lines[idx + 1] || '';
        if (!numbers.length && nextLine) {
            const merged = `${line} ${nextLine}`;
            const mergedNumbers = parseMoneyTokens(merged);
            if (mergedNumbers.length) {
                numbers.push(...mergedNumbers);
            }
        }
        if (/gross\s+pay/.test(lower)) {
            assignMetric(metrics, 'gross', line, numbers);
            return;
        }
        if (/net\s+pay|take\s*home/.test(lower)) {
            assignMetric(metrics, 'net', line, numbers);
            return;
        }
        if (/income\s*tax|tax\b/.test(lower)) {
            assignMetric(metrics, 'tax', line, numbers);
            deductions.push({ label: cleanLabel(line) || 'Income tax', amount: Math.abs(firstNumber(numbers) ?? 0), category: 'tax' });
            return;
        }
        if (/national\s+insurance|\bni\b/.test(lower)) {
            assignMetric(metrics, 'ni', line, numbers);
            deductions.push({ label: cleanLabel(line) || 'National insurance', amount: Math.abs(firstNumber(numbers) ?? 0), category: 'ni' });
            return;
        }
        if (/pension/.test(lower)) {
            assignMetric(metrics, 'pension', line, numbers);
            deductions.push({ label: cleanLabel(line) || 'Pension', amount: Math.abs(firstNumber(numbers) ?? 0), category: 'pension' });
            return;
        }
        if (/student\s+loan/.test(lower)) {
            assignMetric(metrics, 'studentLoan', line, numbers);
            deductions.push({ label: cleanLabel(line) || 'Student loan', amount: Math.abs(firstNumber(numbers) ?? 0), category: 'student_loan' });
            return;
        }
        if (/allowance/.test(lower) && numbers.length) {
            allowances.push({ label: cleanLabel(line) || 'Allowance', amount: Math.abs(firstNumber(numbers) ?? 0) });
            return;
        }
        if ((/basic|salary|overtime|bonus|commission|shift|back\s*pay/.test(lower)) && numbers.length) {
            earnings.push({ label: cleanLabel(line) || 'Earnings', amount: Math.abs(firstNumber(numbers) ?? 0), category: null });
        }
    });
    const payFrequency = detectPayFrequency(text);
    const annualisedGross = estimateAnnualisedGross(metrics.gross, metrics.grossYtd, payFrequency.periods);
    const totalDeductions = sumAmounts(deductions);
    const effectiveMarginalRate = metrics.gross ? (metrics.gross === 0 ? 0 : Math.min(0.95, totalDeductions / metrics.gross)) : null;
    const expectedRate = expectedUkMarginalRate(annualisedGross);
    const takeHomePercent = metrics.gross ? (metrics.net ?? 0) / metrics.gross : null;
    const payDateMatch = text.match(/pay\s*date[:\s]+([A-Za-z0-9\/-]+)/i)
        || text.match(/date\s*paid[:\s]+([A-Za-z0-9\/-]+)/i)
        || text.match(/payment\s*date[:\s]+([A-Za-z0-9\/-]+)/i);
    const periodMatch = text.match(/period\s*(?:start|from)[:\s]+([A-Za-z0-9\/-]+)/i);
    const periodEndMatch = text.match(/period\s*(?:end|to)[:\s]+([A-Za-z0-9\/-]+)/i);
    return {
        raw: null,
        gross: metrics.gross ?? null,
        grossYtd: metrics.grossYtd ?? null,
        net: metrics.net ?? null,
        netYtd: metrics.netYtd ?? null,
        tax: metrics.tax ?? null,
        ni: metrics.ni ?? null,
        pension: metrics.pension ?? null,
        studentLoan: metrics.studentLoan ?? null,
        deductions,
        earnings,
        allowances,
        payFrequencyLabel: payFrequency.label,
        annualisedGross,
        totalDeductions,
        effectiveMarginalRate,
        expectedMarginalRate: expectedRate,
        marginalRateDelta: expectedRate != null && effectiveMarginalRate != null
            ? Number((effectiveMarginalRate - expectedRate).toFixed(3))
            : null,
        takeHomePercent,
        taxCode: parseTaxCode(text),
        notes: [],
        source: 'heuristic',
        payDate: parseDate(payDateMatch?.[1]) || null,
        periodStart: parseDate(periodMatch?.[1]) || null,
        periodEnd: parseDate(periodEndMatch?.[1]) || null,
    };
}
function mergeExtraction(base, fallback) {
    if (!base)
        return fallback;
    const merged = { ...fallback, ...base };
    merged.deductions = (base.deductions && base.deductions.length) ? base.deductions : fallback.deductions;
    merged.earnings = (base.earnings && base.earnings.length) ? base.earnings : fallback.earnings;
    merged.allowances = (base.allowances && base.allowances.length) ? base.allowances : fallback.allowances;
    if (!merged.annualisedGross)
        merged.annualisedGross = fallback.annualisedGross;
    if (merged.totalDeductions == null)
        merged.totalDeductions = fallback.totalDeductions;
    if (merged.effectiveMarginalRate == null)
        merged.effectiveMarginalRate = fallback.effectiveMarginalRate;
    if (merged.expectedMarginalRate == null)
        merged.expectedMarginalRate = fallback.expectedMarginalRate;
    if (merged.marginalRateDelta == null)
        merged.marginalRateDelta = fallback.marginalRateDelta;
    if (merged.takeHomePercent == null)
        merged.takeHomePercent = fallback.takeHomePercent;
    if (!merged.taxCode)
        merged.taxCode = fallback.taxCode;
    if (!merged.payFrequencyLabel)
        merged.payFrequencyLabel = fallback.payFrequencyLabel;
    if (!merged.payDate)
        merged.payDate = fallback.payDate;
    if (!merged.periodStart)
        merged.periodStart = fallback.periodStart;
    if (!merged.periodEnd)
        merged.periodEnd = fallback.periodEnd;
    merged.notes = Array.from(new Set([...(fallback.notes || []), ...(base.notes || [])])).filter(Boolean);
    return merged;
}
async function analysePayslip(text) {
    const heuristic = heuristicPayslipExtraction(text || '');
    const llm = await llmPayslipExtraction(text || '');
    const merged = mergeExtraction(llm, heuristic);
    const summaryNotes = [];
    if (merged.effectiveMarginalRate != null && merged.expectedMarginalRate != null) {
        const diff = merged.marginalRateDelta || 0;
        const direction = diff > 0.02 ? 'higher than expected' : diff < -0.02 ? 'lower than expected' : 'aligned with expectations';
        summaryNotes.push(`Effective marginal rate ${direction}.`);
    }
    if (merged.takeHomePercent != null) {
        summaryNotes.push(`Take-home is ${(merged.takeHomePercent * 100).toFixed(1)}% of gross.`);
    }
    const breakdown = {
        gross: merged.gross ?? null,
        grossYtd: merged.grossYtd ?? null,
        net: merged.net ?? null,
        netYtd: merged.netYtd ?? null,
        tax: merged.tax ?? null,
        ni: merged.ni ?? null,
        pension: merged.pension ?? null,
        studentLoan: merged.studentLoan ?? null,
        totalDeductions: merged.totalDeductions ?? sumAmounts(merged.deductions || []),
        annualisedGross: merged.annualisedGross ?? estimateAnnualisedGross(merged.gross, merged.grossYtd, null),
        effectiveMarginalRate: merged.effectiveMarginalRate,
        expectedMarginalRate: merged.expectedMarginalRate,
        marginalRateDelta: merged.marginalRateDelta,
        takeHomePercent: merged.takeHomePercent,
        payFrequency: merged.payFrequencyLabel || null,
        taxCode: merged.taxCode || null,
        deductions: merged.deductions || [],
        earnings: merged.earnings || [],
        allowances: merged.allowances || [],
        notes: summaryNotes,
        extractionSource: merged.source,
        llmNotes: merged.notes || [],
        payDate: merged.payDate || null,
        periodStart: merged.periodStart || null,
        periodEnd: merged.periodEnd || null,
        employeeName: merged.employeeName || null,
        employerName: merged.employerName || null,
    };
    return breakdown;
}
async function extractPayslip(buffer) {
    const text = await extractPdfText(buffer);
    const breakdown = await analysePayslip(text || '');
    const payDate = breakdown.payDate || breakdown.periodEnd || breakdown.periodStart || new Date().toISOString().slice(0, 10);
    const periodStart = breakdown.periodStart || breakdown.payDate || null;
    const periodEnd = breakdown.periodEnd || breakdown.payDate || null;
    const monthSource = (periodEnd && periodEnd.slice(0, 7)) ||
        (periodStart && periodStart.slice(0, 7)) ||
        (breakdown.payDate && breakdown.payDate.slice(0, 7)) ||
        payDate.slice(0, 7);
    return {
        payDate,
        period: {
            start: periodStart,
            end: periodEnd,
            month: monthSource,
        },
        employer: breakdown.employerName || null,
        gross: breakdown.gross ?? null,
        net: breakdown.net ?? null,
        tax: breakdown.tax ?? null,
        ni: breakdown.ni ?? null,
        pension: breakdown.pension ?? null,
        studentLoan: breakdown.studentLoan ?? null,
        payFrequency: breakdown.payFrequency || null,
    };
}
