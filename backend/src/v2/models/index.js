const mongoose = require('mongoose');
const { config } = require('../config');

mongoose.set('strictQuery', true);

let connectionPromise;

function connectMongo() {
  if (!connectionPromise) {
    const options = {
      serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS ?? 5000,
    };

    if (typeof config.mongo.tls === 'boolean') {
      options.tls = config.mongo.tls;
    }
    if (config.mongo.tlsAllowInvalidCertificates) {
      options.tlsAllowInvalidCertificates = true;
      options.tlsInsecure = true;
      if (options.tls === undefined) options.tls = true;
    }
    if (config.mongo.tlsAllowInvalidHostnames) {
      options.tlsAllowInvalidHostnames = true;
      if (options.tls === undefined) options.tls = true;
    }

    connectionPromise = mongoose.connect(config.mongo.uri, options);
  }
  return connectionPromise;
}

function tenantFilter(userId) {
  return { userId };
}

module.exports = {
  mongoose,
  connectMongo,
  tenantFilter,
};
