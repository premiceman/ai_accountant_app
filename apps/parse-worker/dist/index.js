"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = require("node:http");
const ioredis_1 = __importDefault(require("ioredis"));
const processor_1 = require("./processor");
const utils_1 = require("./utils");
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
class ParseWorker {
    queueName;
    redis;
    running = false;
    redisConnected = false;
    lastProcessedAt = null;
    startedAt = Date.now();
    healthServer = null;
    healthPort = Number(process.env.PARSE_WORKER_PORT || 8091);
    constructor(queueName) {
        this.queueName = queueName;
        this.redis = new ioredis_1.default(REDIS_URL, { lazyConnect: false });
        this.redis.on('ready', () => {
            this.redisConnected = true;
            console.log('[parse-worker] connected to Redis; BRPOP parse:jobs');
        });
        this.redis.on('end', () => {
            this.redisConnected = false;
            console.warn('[parse-worker] redis connection ended');
        });
        this.redis.on('error', (err) => {
            this.redisConnected = false;
            console.error('[parse-worker] redis error', err);
        });
    }
    markProcessed() {
        this.lastProcessedAt = Date.now();
    }
    startHealthServer() {
        if (this.healthServer)
            return;
        this.healthServer = (0, node_http_1.createServer)((req, res) => {
            if (req.url === '/health') {
                this.respondHealth(res).catch((error) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', message: error.message }));
                });
            }
            else {
                res.writeHead(404).end();
            }
        });
        this.healthServer.listen(this.healthPort, () => {
            console.log('[parse-worker] health server listening', { port: this.healthPort });
        });
    }
    async respondHealth(res) {
        let queueDepth = null;
        try {
            queueDepth = await this.redis.llen(this.queueName);
        }
        catch {
            queueDepth = null;
        }
        const payload = {
            schematicsEnabled: String(process.env.ENABLE_SCHEMATICS || 'true').toLowerCase() === 'true',
            redis: {
                connected: this.redisConnected,
                queueDepth,
            },
            lastProcessedAt: this.lastProcessedAt ? new Date(this.lastProcessedAt).toISOString() : null,
            uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
    }
    async start() {
        this.running = true;
        console.log('[parse-worker] starting worker');
        this.startHealthServer();
        console.log('[parse-worker] waiting on queue', this.queueName);
        while (this.running) {
            try {
                const result = await this.redis.brpop(this.queueName, 0);
                if (!result)
                    continue;
                const [, rawJob] = result;
                let job;
                try {
                    job = JSON.parse(rawJob);
                }
                catch (err) {
                    console.error('[parse-worker] failed to parse job payload', rawJob, err);
                    this.markProcessed();
                    continue;
                }
                if (await (0, processor_1.shouldSkipJob)(this.redis, job)) {
                    console.log('[parse-worker] skipping deduped job', job.docId, {
                        source: job.source ?? 'unknown',
                        docType: job.docType,
                        userRulesVersion: job.userRulesVersion ?? null,
                    });
                    this.markProcessed();
                    continue;
                }
                const started = Date.now();
                try {
                    const payload = await (0, processor_1.processParseJob)(this.redis, job);
                    await (0, processor_1.writeResult)(this.redis, job, payload);
                    console.log('[parse-worker] processed job', job.docId, {
                        latencyMs: payload.metrics.latencyMs,
                        providerLatencyMs: payload.metrics.providerLatencyMs,
                        docupipeStatus: payload.docupipe.status,
                        docupipeId: payload.docupipe.id,
                        source: job.source ?? 'unknown',
                        docType: job.docType,
                        userRulesVersion: job.userRulesVersion ?? null,
                    });
                }
                catch (err) {
                    console.error('[parse-worker] job failed', job.docId, err);
                    await (0, processor_1.handleJobFailure)(this.redis, job, err);
                }
                finally {
                    const elapsed = Date.now() - started;
                    console.log('[parse-worker] job completed (success or retry scheduled)', job.docId, { elapsed });
                    this.markProcessed();
                }
            }
            catch (err) {
                console.error('[parse-worker] loop error', err);
                await (0, utils_1.sleep)(1000);
            }
        }
    }
    async stop() {
        this.running = false;
        if (this.healthServer) {
            await new Promise((resolve) => {
                this.healthServer?.close(() => resolve());
            });
            this.healthServer = null;
        }
        await this.redis.quit();
    }
}
async function main() {
    const worker = new ParseWorker('parse:jobs');
    process.on('SIGINT', async () => {
        console.log('[parse-worker] received SIGINT, shutting down');
        await worker.stop();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        console.log('[parse-worker] received SIGTERM, shutting down');
        await worker.stop();
        process.exit(0);
    });
    await worker.start();
}
main().catch((err) => {
    console.error('[parse-worker] fatal error', err);
    process.exit(1);
});
