'use strict';

const DEFAULT_DOCUPIPE_BASE_URL = 'https://app.docupipe.ai';

function normaliseBaseUrl(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const effective = trimmed ? trimmed : DEFAULT_DOCUPIPE_BASE_URL;
  return effective.replace(/\/$/, '');
}

function assertAbsoluteUrl(url, source = url) {
  try {
    const parsed = new URL(url);
    if (!parsed.protocol || !parsed.host) {
      throw new Error('must include protocol and host');
    }
  } catch (error) {
    const identifier = source && source !== url ? source : url;
    const reason = error && error.message ? `: ${error.message}` : '';
    throw new Error(`DOCUPIPE_BASE_URL "${identifier}" is not a valid absolute URL${reason}`);
  }
  return url;
}

function resolveDocupipeBaseUrl(env = process.env) {
  const raw = env && typeof env === 'object' ? env.DOCUPIPE_BASE_URL : undefined;
  const baseUrl = normaliseBaseUrl(raw);
  return assertAbsoluteUrl(baseUrl, raw);
}

module.exports = {
  DEFAULT_DOCUPIPE_BASE_URL,
  resolveDocupipeBaseUrl,
  assertDocupipeBaseUrl: assertAbsoluteUrl,
};
