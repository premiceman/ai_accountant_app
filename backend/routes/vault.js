/**
 * Legacy compatibility shim.
 *
 * The schematics-aware vault router now lives in `src/routes/vault.routes.js`.
 * Export it from this legacy path so existing requires continue to work.
 */
module.exports = require('../src/routes/vault.routes');
