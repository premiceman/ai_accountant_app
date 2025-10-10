'use strict';

class DocumentProcessingError extends Error {
  constructor(message, { code = 'DOCUMENT_PROCESSING_FAILED', details = null } = {}) {
    super(message || 'Document processing failed');
    this.name = 'DocumentProcessingError';
    this.code = code;
    if (details) this.details = details;
    Error.captureStackTrace?.(this, DocumentProcessingError);
  }
}

class UnsupportedDocumentError extends DocumentProcessingError {
  constructor(message = 'Document type is not supported', details) {
    super(message, { code: 'DOCUMENT_UNSUPPORTED', details });
    this.name = 'UnsupportedDocumentError';
  }
}

class DocumentClassificationError extends DocumentProcessingError {
  constructor(message = 'Document could not be classified', details) {
    super(message, { code: 'DOCUMENT_CLASSIFICATION_FAILED', details });
    this.name = 'DocumentClassificationError';
  }
}

module.exports = {
  DocumentProcessingError,
  UnsupportedDocumentError,
  DocumentClassificationError,
};
