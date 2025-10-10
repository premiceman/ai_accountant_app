class DummyCommand {
  constructor(_input) {
    this.input = _input;
  }
}

class S3Client {
  constructor(_config) {
    this.config = _config;
  }

  async send() {
    return {};
  }
}

module.exports = {
  S3Client,
  PutObjectCommand: DummyCommand,
  GetObjectCommand: DummyCommand,
  DeleteObjectCommand: DummyCommand,
  ListObjectsV2Command: DummyCommand,
};
