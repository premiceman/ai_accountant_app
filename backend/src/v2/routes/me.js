const express = require('express');
const { getProfile, updateProfile } = require('../services/profile');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const profile = await getProfile(req.user.id);
    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

router.patch('/', async (req, res, next) => {
  try {
    const profile = await updateProfile(req.user.id, req.body || {});
    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
