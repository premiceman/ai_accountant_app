const express = require('express');
const { queueUserFileIds } = require('../services/vault/jobService.js');

const router = express.Router();
router.use(express.json());

router.post('/admin/requeue', async (req, res, next) => {
  try {
    const { userId, fileIds } = req.body || {};
    if (!userId || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'userId & fileIds[] required' });
    }
    const result = await queueUserFileIds(userId, fileIds);
    res.json({ ok: true, queued: result.queued });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
