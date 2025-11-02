import { createHash } from 'node:crypto';
import type { Types } from 'mongoose';
import pino from 'pino';
import * as v1 from '../../../../shared/v1/index.js';
import { callOpenAIJson } from '../lib/openai.js';
import { hashPII } from '../lib/pii.js';
import {
  TransactionCategoryCacheModel,
  type TransactionCategoryCache,
  TRANSACTION_CATEGORY_VALUES,
} from '../models/transactionCategoryCache.js';

const CATEGORY_SET = new Set(TRANSACTION_CATEGORY_VALUES);

const RULES: Array<{
  category: (typeof TRANSACTION_CATEGORY_VALUES)[number];
  patterns: RegExp[];
  predicate?: (tx: v1.TransactionV1) => boolean;
}> = [
  { category: 'Housing', patterns: [/\brent\b/i, /mortgage/i, /landlord/i, /lettings?/i] },
  {
    category: 'Utilities',
    patterns: [/utility/i, /energy/i, /electric/i, /gas/i, /water/i, /power/i, /broadband/i, /internet/i],
  },
  {
    category: 'Groceries',
    patterns: [
      /supermarket/i,
      /groc(ery|eries)/i,
      /tesco/i,
      /sainsbury/i,
      /aldi/i,
      /lidl/i,
      /waitrose/i,
      /asda/i,
      /morrisons/i,
      /whole ?foods/i,
      /iceland/i,
      /coop/i,
    ],
  },
  {
    category: 'Transport',
    patterns: [
      /\buber\b/i,
      /bolt/i,
      /lyft/i,
      /train/i,
      /rail/i,
      /transport/i,
      /bus/i,
      /petrol/i,
      /fuel/i,
      /shell/i,
      /bp/i,
      /parking/i,
      /taxi/i,
      /flight/i,
      /airline/i,
      /tfl/i,
    ],
  },
  {
    category: 'Subscriptions',
    patterns: [
      /subscription/i,
      /netflix/i,
      /spotify/i,
      /prime/i,
      /icloud/i,
      /apple/i,
      /google/i,
      /microsoft/i,
      /adobe/i,
      /patreon/i,
      /disney/i,
      /now tv/i,
      /paramount/i,
      /itunes/i,
    ],
  },
  {
    category: 'Leisure',
    patterns: [
      /restaurant/i,
      /cafe/i,
      /coffee/i,
      /bar/i,
      /pub/i,
      /cinema/i,
      /theatre/i,
      /gym/i,
      /fitness/i,
      /holiday/i,
      /travel/i,
      /hotel/i,
      /airbnb/i,
      /ticket/i,
      /event/i,
    ],
  },
  { category: 'Fees/Charges', patterns: [/fee/i, /charge/i, /interest/i, /overdraft/i, /penalty/i, /fine/i] },
  {
    category: 'Income',
    patterns: [/payroll/i, /salary/i, /wages/i, /income/i, /bonus/i, /dividend/i, /benefit/i, /pension/i],
    predicate: (tx) => tx.direction === 'inflow',
  },
  {
    category: 'Refunds',
    patterns: [/refund/i, /reversal/i, /chargeback/i, /rebate/i, /cashback/i],
    predicate: (tx) => tx.direction === 'inflow',
  },
  {
    category: 'Savings/Transfers',
    patterns: [/transfer/i, /standing order/i, /savings/i, /isa/i, /move to/i, /internal/i],
  },
];

const UNCATEGORISED_MARKERS = new Set(['misc', 'uncategorised', 'uncategorized', 'unknown', 'other', '']);

export type CategorisedTransaction = v1.TransactionV1 & { category: string };

function sanitiseDescription(raw: string): string {
  const trimmed = raw.trim().slice(0, 120);
  return trimmed.replace(/\d{4,}/g, (match) => `${'#'.repeat(Math.max(0, match.length - 4))}${match.slice(-4)}`);
}

function hashMerchant(description: string): string {
  const normalised = description.toLowerCase().replace(/\s+/g, ' ').trim();
  return hashPII(normalised) || createHash('sha256').update(normalised).digest('hex');
}

function mapExistingCategory(category: string | null | undefined, tx: v1.TransactionV1): string | null {
  if (!category) return null;
  const raw = String(category).trim();
  if (!raw) return null;
  const simplified = raw.toLowerCase();
  if (UNCATEGORISED_MARKERS.has(simplified)) {
    if (tx.direction === 'inflow') {
      return 'Income';
    }
    return null;
  }
  if (CATEGORY_SET.has(raw as (typeof TRANSACTION_CATEGORY_VALUES)[number])) {
    return raw;
  }
  if (/rentmortgage/i.test(raw) || /housing/i.test(raw)) return 'Housing';
  if (/utility/i.test(raw)) return 'Utilities';
  if (/grocery/i.test(raw) || /groceries/i.test(raw)) return 'Groceries';
  if (/subscription/i.test(raw)) return 'Subscriptions';
  if (/fee/i.test(raw) || /charge/i.test(raw)) return 'Fees/Charges';
  if (/transfer/i.test(raw)) return 'Savings/Transfers';
  if (/income/i.test(raw) || /salary/i.test(raw)) return 'Income';
  if (/refund/i.test(raw)) return 'Refunds';
  if (/transport/i.test(raw) || /fuel/i.test(raw) || /travel/i.test(raw)) return 'Transport';
  if (/entertainment/i.test(raw) || /leisure/i.test(raw) || /eatingout/i.test(raw)) return 'Leisure';
  return null;
}

function applyRuleBasedCategory(tx: v1.TransactionV1): string | null {
  const description = tx.description || '';
  for (const rule of RULES) {
    if (rule.predicate && !rule.predicate(tx)) continue;
    if (rule.patterns.some((pattern) => pattern.test(description))) {
      return rule.category;
    }
  }
  if (tx.direction === 'inflow') {
    if (Math.abs(tx.amountMinor) <= 0) {
      return 'Income';
    }
  }
  return null;
}

type OpenAICategoryResponse = { category: (typeof TRANSACTION_CATEGORY_VALUES)[number] };

async function fetchCategoryFromOpenAI(
  tx: v1.TransactionV1,
  options: { logger: pino.Logger; merchantHash: string }
): Promise<(typeof TRANSACTION_CATEGORY_VALUES)[number] | null> {
  const { logger, merchantHash } = options;
  const description = sanitiseDescription(tx.description || '');
  const amountMajor = Math.round(Math.abs(tx.amountMinor)) / 100;
  const direction = tx.direction;

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['category'],
    properties: {
      category: { type: 'string', enum: TRANSACTION_CATEGORY_VALUES },
    },
  };

  const systemPrompt =
    'You categorise UK personal finance transactions into one of the fixed budget categories. ' +
    'Choose the single best category even if the description is vague. Respond with JSON only.';

  const userPrompt = JSON.stringify(
    {
      merchantHash,
      description,
      amount: amountMajor,
      direction,
      categories: TRANSACTION_CATEGORY_VALUES,
    },
    null,
    2
  );

  try {
    const response = await callOpenAIJson<OpenAICategoryResponse>({
      system: systemPrompt,
      user: userPrompt,
      schema,
      maxTokens: 200,
    });
    if (response && typeof response.category === 'string' && CATEGORY_SET.has(response.category as any)) {
      return response.category as (typeof TRANSACTION_CATEGORY_VALUES)[number];
    }
  } catch (error) {
    logger.warn(
      { err: error, merchantHash, transactionId: tx.id },
      'OpenAI categorisation failed; falling back to Other'
    );
  }
  return null;
}

export async function categoriseTransactions({
  userId,
  transactions,
  logger = pino({ name: 'transaction-categoriser' }),
}: {
  userId: Types.ObjectId;
  transactions: v1.TransactionV1[];
  logger?: pino.Logger;
}): Promise<v1.TransactionV1[]> {
  if (!transactions.length) return transactions;

  const updated: v1.TransactionV1[] = [];
  const uncachedRequests: Array<{ tx: v1.TransactionV1; merchantHash: string; index: number }> = [];

  const cacheMap = new Map<string, TransactionCategoryCache>();
  const cacheReady = TransactionCategoryCacheModel.db?.readyState === 1;
  if (cacheReady) {
    try {
      const cacheDocs = await TransactionCategoryCacheModel.find({ userId })
        .lean<TransactionCategoryCache[]>()
        .exec();
      for (const doc of cacheDocs) {
        cacheMap.set(doc.merchantHash, doc);
      }
    } catch (error) {
      logger.warn({ err: error, userId }, 'Unable to load transaction category cache; continuing without cache');
    }
  }

  for (let index = 0; index < transactions.length; index += 1) {
    const tx = transactions[index];
    const existing = mapExistingCategory(tx.category, tx);
    if (existing && CATEGORY_SET.has(existing as any)) {
      updated.push({ ...tx, category: existing });
      continue;
    }
    const ruleCategory = applyRuleBasedCategory(tx);
    if (ruleCategory) {
      updated.push({ ...tx, category: ruleCategory });
      continue;
    }
    const merchantHash = hashMerchant(tx.description || tx.id || String(index));
    const cached = cacheMap.get(merchantHash);
    if (cached) {
      updated.push({ ...tx, category: cached.category });
      continue;
    }
    uncachedRequests.push({ tx, merchantHash, index });
    updated.push(tx);
  }

  if (!uncachedRequests.length) {
    return updated;
  }

  for (const request of uncachedRequests) {
    const category = await fetchCategoryFromOpenAI(request.tx, {
      logger,
      merchantHash: request.merchantHash,
    });
    const resolved = category ?? 'Other';
    const nextTx = { ...updated[request.index], category: resolved };
    updated[request.index] = nextTx;
    if (cacheReady) {
      try {
        await TransactionCategoryCacheModel.updateOne(
          { userId, merchantHash: request.merchantHash },
          {
            $set: {
              category: resolved,
              descriptionSample: sanitiseDescription(request.tx.description || ''),
              lastAmountMinor: request.tx.amountMinor,
              lastDirection: request.tx.direction,
            },
          },
          { upsert: true }
        ).exec();
      } catch (error) {
        logger.warn(
          { err: error, userId, merchantHash: request.merchantHash },
          'Failed to persist transaction category cache entry'
        );
      }
    }
  }

  return updated;
}
