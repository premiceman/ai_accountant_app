const mongoose = require('mongoose');
const { config } = require('../config');

mongoose.set('strictQuery', true);

const RETRY_DELAY_MS = config.mongo.connectRetryDelayMs ?? 5000;
const MAX_RETRIES = config.mongo.connectRetries ?? 5;

let connectionPromise;

function redactMongoUri(uri) {
  try {
    const matches = uri.match(/^(mongodb(?:\+srv)?:\/\/)([^@]+)@(.+)$/i);
    if (matches) {
      return `${matches[1]}<credentials>@${matches[3]}`;
    }
    return uri;
  } catch (error) {
    console.warn('Unable to redact MongoDB URI', error);
    return uri;
  }
}

async function connectWithRetry(attempt = 1) {
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

  const redactedUri = redactMongoUri(config.mongo.uri);

  try {
    const connection = await mongoose.connect(config.mongo.uri, options);
    if (attempt > 1) {
      console.info(`MongoDB connection established after ${attempt} attempts (${redactedUri}).`);
    }
    return connection;
  } catch (error) {
    const isLastAttempt = attempt >= MAX_RETRIES;
    const message = `MongoDB connection attempt ${attempt} failed for ${redactedUri}: ${error.message}`;
    if (isLastAttempt) {
      const helpText =
        'Verify the MongoDB Atlas IP allow list includes your hosting provider or switch to the Atlas Data API.';
      console.error(`${message}. No retries left. ${helpText}`);
      const finalError = new Error(`${message}. ${helpText}`);
      finalError.cause = error;
      throw finalError;
    }

    console.warn(`${message}. Retrying in ${RETRY_DELAY_MS}ms...`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return connectWithRetry(attempt + 1);
  }
}

function connectMongo() {
  if (!connectionPromise) {
    connectionPromise = connectWithRetry();
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
