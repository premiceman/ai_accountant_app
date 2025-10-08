export type RawInstitutionNamesUpdateMode = 'replace' | 'appendUnique' | 'elementUpdate';

export type RawInstitutionNamesUpdatePlanSummary = {
  mode: RawInstitutionNamesUpdateMode | 'none';
  operators: string[];
  paths: string[];
  additionsSample: string[];
  additionsCount: number;
  resultingLength: number;
  arrayFilters: boolean;
};

export type RawInstitutionNamesUpdatePlan = {
  update: Record<string, any>;
  arrayFilters?: Record<string, unknown>[];
  summary: RawInstitutionNamesUpdatePlanSummary;
  resultingArray: string[];
  applied: boolean;
};

export type ElementUpdateOptions = {
  matchValue: string;
  identifier?: string;
};

export function normalizeRawInstitutionNamesInput(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined && item !== null)
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .filter((item) => item !== undefined && item !== null)
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

export function buildRawInstitutionNamesUpdate(
  mode: RawInstitutionNamesUpdateMode,
  currentArray: string[],
  incomingValues: string[],
  options: ElementUpdateOptions | undefined = undefined
): RawInstitutionNamesUpdatePlan {
  const normalizedCurrent = dedupe(currentArray.map((item) => item.trim()).filter((item) => item.length > 0));
  const normalizedIncoming = dedupe(
    incomingValues
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0)
  );

  switch (mode) {
    case 'replace': {
      const resultingArray = dedupe(normalizedIncoming);
      const shouldApply = !arraysEqual(normalizedCurrent, resultingArray);
      const summary: RawInstitutionNamesUpdatePlanSummary = {
        mode,
        operators: shouldApply ? ['$set'] : [],
        paths: shouldApply ? ['rawInstitutionNames'] : [],
        additionsSample: resultingArray.slice(0, 5),
        additionsCount: resultingArray.length,
        resultingLength: resultingArray.length,
        arrayFilters: false,
      };
      return {
        update: shouldApply
          ? { $set: { rawInstitutionNames: resultingArray } }
          : {},
        arrayFilters: undefined,
        summary,
        resultingArray,
        applied: shouldApply,
      };
    }
    case 'appendUnique': {
      const additions = normalizedIncoming.filter((value) => !normalizedCurrent.includes(value));
      const resultingArray = dedupe([...normalizedCurrent, ...additions]);
      const summary: RawInstitutionNamesUpdatePlanSummary = {
        mode,
        operators: additions.length ? ['$addToSet'] : [],
        paths: additions.length ? ['rawInstitutionNames'] : [],
        additionsSample: additions.slice(0, 5),
        additionsCount: additions.length,
        resultingLength: resultingArray.length,
        arrayFilters: false,
      };
      return {
        update: additions.length
          ? { $addToSet: { rawInstitutionNames: { $each: additions } } }
          : {},
        arrayFilters: undefined,
        summary,
        resultingArray,
        applied: additions.length > 0,
      };
    }
    case 'elementUpdate': {
      if (!options) {
        throw new Error('Element update requires options');
      }
      const identifier = options.identifier ?? 'i';
      const nextValue = normalizedIncoming[0];
      if (!nextValue) {
        return {
          update: {},
          arrayFilters: undefined,
          summary: {
            mode,
            operators: [],
            paths: [],
            additionsSample: [],
            additionsCount: 0,
            resultingLength: normalizedCurrent.length,
            arrayFilters: false,
          },
          resultingArray: normalizedCurrent,
          applied: false,
        };
      }
      const index = normalizedCurrent.findIndex((value) => value === options.matchValue);
      if (index === -1) {
        return {
          update: {},
          arrayFilters: undefined,
          summary: {
            mode,
            operators: [],
            paths: [],
            additionsSample: [],
            additionsCount: 0,
            resultingLength: normalizedCurrent.length,
            arrayFilters: false,
          },
          resultingArray: normalizedCurrent,
          applied: false,
        };
      }
      const resultingArray = normalizedCurrent.slice();
      resultingArray[index] = nextValue;
      const summary: RawInstitutionNamesUpdatePlanSummary = {
        mode,
        operators: ['$set'],
        paths: [`rawInstitutionNames.$[${identifier}]`],
        additionsSample: [nextValue],
        additionsCount: 1,
        resultingLength: resultingArray.length,
        arrayFilters: true,
      };
      return {
        update: {
          $set: {
            [`rawInstitutionNames.$[${identifier}]`]: nextValue,
          },
        },
        arrayFilters: [
          {
            [identifier]: { $eq: options.matchValue },
          },
        ],
        summary,
        resultingArray,
        applied: normalizedCurrent[index] !== nextValue,
      };
    }
    default:
      throw new Error(`Unsupported mode: ${mode satisfies never}`);
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function createNoopSummary(length: number): RawInstitutionNamesUpdatePlanSummary {
  return {
    mode: 'none',
    operators: [],
    paths: [],
    additionsSample: [],
    additionsCount: 0,
    resultingLength: length,
    arrayFilters: false,
  };
}

export function ensureSingleOperatorForRawInstitutionNames(update: Record<string, any>): void {
  const operators = new Map<string, Set<string>>();
  let rootTouchedBy: string | null = null;
  for (const [operator, payload] of Object.entries(update)) {
    if (!operator.startsWith('$') || typeof payload !== 'object' || payload === null) {
      continue;
    }
    const paths = Object.keys(payload as Record<string, unknown>).filter((path) =>
      path === 'rawInstitutionNames' || path.startsWith('rawInstitutionNames.')
    );
    if (!paths.length) continue;
    operators.set(operator, new Set(paths));
    for (const path of paths) {
      if (path === 'rawInstitutionNames') {
        if (rootTouchedBy && rootTouchedBy !== operator) {
          throw new Error(
            `Conflicting operators on rawInstitutionNames: ${rootTouchedBy} and ${operator}`
          );
        }
        rootTouchedBy = operator;
      }
    }
  }
  if (operators.size <= 1) {
    const [paths] = operators.values();
    if (paths && [...paths].some((path) => path !== 'rawInstitutionNames')) {
      const hasRoot = [...paths].includes('rawInstitutionNames');
      if (hasRoot && paths.size > 1) {
        throw new Error('Conflicting updates on rawInstitutionNames root and sub-paths');
      }
    }
    return;
  }
  throw new Error(
    `Conflicting operators on rawInstitutionNames: ${[...operators.keys()].join(', ')}`
  );
}

export function summarizeForLogging(summary: RawInstitutionNamesUpdatePlanSummary) {
  return {
    mode: summary.mode,
    operators: summary.operators,
    paths: summary.paths,
    additionsSample: summary.additionsSample.slice(0, 5),
    additionsCount: summary.additionsCount,
    resultingLength: summary.resultingLength,
    arrayFilters: summary.arrayFilters,
  };
}

