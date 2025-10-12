export type DocumentType = string;

export interface ParseJob {
  docId: string;
  userId: string;
  storagePath: string;
  docType: DocumentType;
  userRulesVersion?: string | null;
  dedupeKey?: string | null;
  attempts?: number;
  source?: string | null;
}

export interface RuleBase {
  expectedType: 'number' | 'string' | 'date';
  label?: string;
}

export interface AnchorRegexRule extends RuleBase {
  strategy: 'anchor+regex';
  anchor: string;
  regex: string;
}

export interface LineOffsetRule extends RuleBase {
  strategy: 'line-offset';
  anchor: string;
  lineOffset: number;
}

export interface BoxRule extends RuleBase {
  strategy: 'box';
  top: number;
  left: number;
  width: number;
  height: number;
}

export type UserFieldRule = AnchorRegexRule | LineOffsetRule | BoxRule;

export type UserRuleSet = Record<string, UserFieldRule>;

export type StatementColumnKey = 'date' | 'description' | 'amount' | 'ignore';

export interface StatementColumnRule {
  key: StatementColumnKey;
  regex?: string;
  start?: number;
  end?: number;
}

export interface StatementRowTemplate {
  id?: string;
  label?: string;
  startLine: number;
  lineStride?: number;
  maxRows?: number;
  stopRegex?: string;
  columns: StatementColumnRule[];
}

export interface StatementRules {
  templates: StatementRowTemplate[];
}

export interface UserSchematicRules {
  fields?: UserRuleSet | null;
  statement?: StatementRules | null;
}

export interface ExtractedFieldValue {
  value: string | number | null;
  source: 'rule' | 'heuristic';
  field: string;
  detail?: string;
  positions?: FieldPosition[];
}

export interface ExtractFieldsResult {
  values: Record<string, ExtractedFieldValue>;
  issues: string[];
  usedRuleFields: string[];
  statementTransactions: Array<{
    date: string;
    description: string;
    amount: number;
  }>;
  statementIssues: string[];
}

export interface ParseResultPayload {
  ok: boolean;
  classification: {
    docType: DocumentType;
    confidence: number;
    anchors: string[];
  };
  fieldValues: Record<string, ExtractedFieldValue>;
  insights: {
    metrics: Record<string, number | null>;
  };
  narrative: string[];
  metadata: {
    payDate: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    extractionSource: string;
    employerName: string | null;
    personName: string | null;
    rulesVersion: string | null;
    dateConfidence: number;
    fieldPositions?: Record<string, FieldPosition[]>;
  };
  text: string;
  storage: {
    path: string;
    processedAt: string;
  };
  metrics: {
    latencyMs: number;
    ruleLatencyMs: number;
  };
  softErrors: string[];
  statement?: {
    transactions: Array<{
      date: string;
      description: string;
      amount: number;
    }>;
    issues: string[];
  };
}
