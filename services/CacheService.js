const Logger = require('../utils/logger');

class CacheService {
  constructor(redisUrl) {
    this.redisUrl = redisUrl || process.env.REDIS_URL || null;
    this.redis = null;
    this.subscriber = null;
    this.enabled = false;
    this.memory = new Map();
  }

  async initialize() {
    try {
      if (!this.redisUrl) {
        Logger.info('CacheService: REDIS_URL not set, using in-memory cache');
        return;
      }
      const { createClient } = require('redis');
      this.redis = createClient({ url: this.redisUrl });
      this.subscriber = createClient({ url: this.redisUrl });
      this.redis.on('error', (e) => Logger.warning(`Redis error: ${e.message}`));
      this.subscriber.on('error', (e) => Logger.warning(`Redis sub error: ${e.message}`));
      await this.redis.connect();
      await this.subscriber.connect();
      this.enabled = true;
      Logger.success('CacheService: Connected to Redis');
    } catch (e) {
      Logger.warning(`CacheService: Failed to connect to Redis, falling back to memory: ${e.message}`);
      this.enabled = false;
    }
  }

  async get(key) {
    if (this.enabled) {
      const val = await this.redis.get(key);
      return val ? JSON.parse(val) : null;
    }
    return this.memory.get(key) || null;
  }

  async set(key, value, ttlSeconds) {
    if (this.enabled) {
      const payload = JSON.stringify(value);
      if (ttlSeconds) await this.redis.set(key, payload, { EX: ttlSeconds });
      else await this.redis.set(key, payload);
      return;
    }
    this.memory.set(key, value);
    if (ttlSeconds) setTimeout(() => this.memory.delete(key), ttlSeconds * 1000).unref?.();
  }

  async del(key) {
    if (this.enabled) return this.redis.del(key);
    this.memory.delete(key);
  }

  async publish(channel, message) {
    if (this.enabled) return this.redis.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel, handler) {
    if (!this.subscriber) return;
    try {
      await this.subscriber.subscribe(channel, (msg) => {
        try { handler(JSON.parse(msg)); } catch (_) { handler(msg); }
      });
      Logger.info(`CacheService: Subscribed to ${channel}`);
    } catch (e) {
      Logger.warning(`CacheService: Failed to subscribe ${channel}: ${e.message}`);
    }
  }
}

module.exports = CacheService;


