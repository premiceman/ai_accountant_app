const mongoose = require('mongoose');
const { config } = require('../config');

mongoose.set('strictQuery', true);

let connectionPromise;

function connectMongo() {
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(config.mongo.uri, {
      serverSelectionTimeoutMS: 5000,
    });
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
