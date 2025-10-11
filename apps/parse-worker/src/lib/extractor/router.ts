import { extractPayslipMetrics } from './payslip';
import { OverrideValue } from '../overrides';
import { PayslipMetrics } from '../types';

export type ExtractResult = {
  metrics: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export async function routeExtraction(
  docType: string,
  text: string,
  overrides: Map<string, OverrideValue>
): Promise<ExtractResult> {
  if (docType === 'payslip') {
    const metrics: Record<string, PayslipMetrics> = {
      payslip: extractPayslipMetrics(text, overrides),
    };
    return { metrics, metadata: {} };
  }
  return { metrics: {}, metadata: { notes: `No extractor implemented for ${docType}` } };
}

export default routeExtraction;
