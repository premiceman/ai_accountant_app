const { config } = require('../config');

class IngestQueue {
  constructor(concurrency = config.docupipe.maxInFlight) {
    this.concurrency = Math.max(1, concurrency);
    this.queue = [];
    this.active = 0;
  }

  push(task) {
    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject };
      this.queue.push(entry);
      this._drain();
    });
  }

  async _drain() {
    if (this.active >= this.concurrency) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active += 1;
    try {
      const result = await next.task();
      next.resolve(result);
    } catch (error) {
      next.reject(error);
    } finally {
      this.active -= 1;
      setImmediate(() => this._drain());
    }
  }
}

const queue = new IngestQueue();

module.exports = { queue, IngestQueue };
