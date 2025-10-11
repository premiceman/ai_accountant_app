// NOTE: Phase-3 — Frontend uses /api/analytics/v1, staged loader on dashboards, Ajv strict. Rollback via flags.
'use strict';

const { featureFlags } = require('../../../shared/config/featureFlags');

module.exports = { featureFlags };
