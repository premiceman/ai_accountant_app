'use strict';

const express = require('express');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use('/api/vault', require('./routes/vaultProcessing.routes'));

module.exports = app;
