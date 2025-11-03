function resolveDocTypeFromSchema(stdJson) {
  const schemaId =
    stdJson?.schemaId
    || stdJson?.data?.schemaId
    || stdJson?.meta?.schemaId
    || stdJson?.document?.schemaId
    || stdJson?.document?.schema_id
    || null;
  const schemaName =
    stdJson?.schemaName
    || stdJson?.data?.schemaName
    || stdJson?.meta?.schemaName
    || stdJson?.document?.schemaName
    || stdJson?.document?.schema_name
    || null;

  const PAYSLIP_ID = process.env.PAYSLIP_SCHEMA_ID;
  const STATEMENT_ID = process.env.BANK_STATEMENT_SCHEMA_ID;

  if (schemaId) {
    if (PAYSLIP_ID && schemaId === PAYSLIP_ID) {
      return 'payslip';
    }
    if (STATEMENT_ID && schemaId === STATEMENT_ID) {
      return 'statement';
    }
  }

  const name = typeof schemaName === 'string' ? schemaName.trim().toLowerCase() : '';
  if (name === 'payslip (v1)') {
    return 'payslip';
  }
  if (name === 'bank statement (v1)') {
    return 'statement';
  }

  return 'unknown';
}

module.exports = {
  resolveDocTypeFromSchema,
};
