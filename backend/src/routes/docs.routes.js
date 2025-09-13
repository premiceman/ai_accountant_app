// backend/src/routes/docs.routes.js
// Shim so that /api/docs works in setups that auto-mount routes by filename.
// It re-exports the existing documents router without changing any behavior.

// backend/src/routes/docs.routes.js
// Re-export the documents router so file-based loaders expose it at /api/docs.
module.exports = require('./documents.routes');
