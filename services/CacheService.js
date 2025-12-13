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
      Logger.info(`CacheService: Attempting to connect to Redis at ${this.redisUrl}`);
      const { createClient } = require('redis');
      this.redis = createClient({ url: this.redisUrl });
      this.subscriber = createClient({ url: this.redisUrl });
      this.redis.on('error', (e) => {
        const msg = e.message || e.toString() || 'Unknown error';
        Logger.error(`Redis client error (URL: ${this.redisUrl}): ${msg}`);
        if (e.code) Logger.error(`Redis error code: ${e.code}`);
      });
      this.subscriber.on('error', (e) => {
        const msg = e.message || e.toString() || 'Unknown error';
        Logger.error(`Redis subscriber error (URL: ${this.redisUrl}): ${msg}`);
        if (e.code) Logger.error(`Redis error code: ${e.code}`);
      });
      await this.redis.connect();
      await this.subscriber.connect();
      this.enabled = true;
      Logger.success(`CacheService: Connected to Redis at ${this.redisUrl}`);
    } catch (e) {
      const msg = e.message || e.toString() || 'Unknown error';
      Logger.error(`CacheService: Failed to connect to Redis at ${this.redisUrl}`);
      Logger.error(`CacheService: Error: ${msg}`);
      if (e.code) Logger.error(`CacheService: Error code: ${e.code}`);
      Logger.warning('CacheService: Falling back to in-memory cache');
      this.enabled = false;
    }
  }

  /**
   * Reinitialize cache with new Redis URL (hot reload)
   */
  async reinitialize(newRedisUrl) {
    Logger.info(`CacheService: Reinitializing with URL: ${newRedisUrl || 'none (in-memory)'}`);

    // Disconnect existing connections
    try {
      if (this.redis && this.redis.isOpen) {
        await this.redis.quit();
        Logger.info('CacheService: Disconnected existing Redis client');
      }
    } catch (e) {
      Logger.warning(`CacheService: Error disconnecting Redis client: ${e.message}`);
    }

    try {
      if (this.subscriber && this.subscriber.isOpen) {
        await this.subscriber.quit();
        Logger.info('CacheService: Disconnected existing Redis subscriber');
      }
    } catch (e) {
      Logger.warning(`CacheService: Error disconnecting Redis subscriber: ${e.message}`);
    }

    // Reset state
    this.redis = null;
    this.subscriber = null;
    this.enabled = false;
    this.redisUrl = newRedisUrl;

    // Reinitialize
    await this.initialize();
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


