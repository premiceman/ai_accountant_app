// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
'use strict';

const express = require('express');
const auth = require('../../middleware/auth');
const { serialiseFlagsForClient } = require('../../../shared/config/featureFlags');

const router = express.Router();

router.use(auth);

router.get('/', (_req, res) => {
  const flags = serialiseFlagsForClient();
  res.json({
    ENABLE_FRONTEND_ANALYTICS_V1: Boolean(flags.ENABLE_FRONTEND_ANALYTICS_V1),
    ENABLE_STAGED_LOADER_ANALYTICS: Boolean(flags.ENABLE_STAGED_LOADER_ANALYTICS),
    JSON_TEST_ENABLED: Boolean(flags.JSON_TEST_ENABLED),
    JSON_TEST_ENABLE_TRIMLAB: Boolean(flags.JSON_TEST_ENABLE_TRIMLAB),
  });
});

module.exports = router;
