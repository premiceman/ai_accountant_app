class HttpError extends Error {
  constructor(statusCode, message, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function notFound(message = 'Not found', details) {
  return new HttpError(404, message, details);
}

function forbidden(message = 'Forbidden', details) {
  return new HttpError(403, message, details);
}

function badRequest(message = 'Bad request', details) {
  return new HttpError(400, message, details);
}

function conflict(message = 'Conflict', details) {
  return new HttpError(409, message, details);
}

function unauthorised(message = 'Authentication required', details) {
  return new HttpError(401, message, details);
}

module.exports = {
  HttpError,
  notFound,
  forbidden,
  badRequest,
  conflict,
  unauthorised,
};
