// Adapter to reuse the legacy User model within the v2 codebase.
// The legacy model lives outside of the v2 folder structure, so we
// simply require and re-export it here to keep relative imports tidy.
module.exports = require('../../../models/User');
