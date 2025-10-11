import { z } from 'zod';

const mmYYYY = z.string().regex(/^(0[1-9]|1[0-2])\/\d{4}$/);

export const moneyMapSchema = z.record(z.number());

export const payslipSchema = z.object({
  period: z
    .object({
      payDate: mmYYYY.optional(),
      periodStart: mmYYYY.optional(),
      periodEnd: mmYYYY.optional(),
    })
    .strict(),
  totals: moneyMapSchema.optional(),
  earnings: moneyMapSchema.optional(),
  deductions: moneyMapSchema.optional(),
  employer: z
    .object({
      name: z.string().optional(),
    })
    .strict()
    .optional(),
  yearToDate: z
    .object({
      totals: moneyMapSchema.optional(),
      earnings: moneyMapSchema.optional(),
      deductions: moneyMapSchema.optional(),
    })
    .strict()
    .optional(),
});

export const metadataSchema = z
  .object({
    documentName: z.string().optional(),
    notes: z.string().optional(),
    llmNotes: z.union([z.array(z.string()), z.string()]).optional(),
  })
  .catchall(z.any());

export const normalizedInsightSchema = z.object({
  baseKey: z.string(),
  key: z.string(),
  metrics: z.object({ payslip: payslipSchema }).passthrough(),
  metadata: metadataSchema,
});

export type PayslipMetrics = z.infer<typeof payslipSchema>;
