const Logger = require('./logger');

class RateLimiter {
    constructor(options = {}) {
        this.windowMs = options.windowMs || 60000; // 1 minute default
        this.maxRequests = options.maxRequests || 5; // 5 requests per window default
        this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes default
        this.requests = new Map(); // userId -> { count: number, resetTime: number }
        this.cleanupTimer = null;
        
        this.startCleanup();
    }

    /**
     * Check if a user can make a request
     * @param {string} userId - Discord user ID
     * @param {string} commandName - Name of the command (optional, for per-command limits)
     * @returns {Object} - { allowed: boolean, remaining: number, resetTime: number, retryAfter: number }
     */
    checkLimit(userId, commandName = 'global') {
        const now = Date.now();
        const key = `${userId}:${commandName}`;
        
        // Get or create user request data
        let userData = this.requests.get(key);
        
        if (!userData || now >= userData.resetTime) {
            // Create new window or reset expired window
            userData = {
                count: 0,
                resetTime: now + this.windowMs
            };
            this.requests.set(key, userData);
        }
        
        // Check if user has exceeded the limit
        if (userData.count >= this.maxRequests) {
            const retryAfter = Math.ceil((userData.resetTime - now) / 1000);
            Logger.warning(`Rate limit exceeded for user ${userId} on command ${commandName}. Retry after ${retryAfter}s`);
            
            return {
                allowed: false,
                remaining: 0,
                resetTime: userData.resetTime,
                retryAfter: retryAfter
            };
        }
        
        // Increment request count
        userData.count++;
        this.requests.set(key, userData);
        
        const remaining = this.maxRequests - userData.count;
        const retryAfter = Math.ceil((userData.resetTime - now) / 1000);
        
        Logger.debug(`Rate limit check for user ${userId} on command ${commandName}: ${remaining} remaining`);
        
        return {
            allowed: true,
            remaining: remaining,
            resetTime: userData.resetTime,
            retryAfter: retryAfter
        };
    }

    /**
     * Get rate limit info for a user without incrementing the counter
     * @param {string} userId - Discord user ID
     * @param {string} commandName - Name of the command
     * @returns {Object} - Rate limit information
     */
    getLimitInfo(userId, commandName = 'global') {
        const now = Date.now();
        const key = `${userId}:${commandName}`;
        const userData = this.requests.get(key);
        
        if (!userData || now >= userData.resetTime) {
            return {
                remaining: this.maxRequests,
                resetTime: now + this.windowMs,
                retryAfter: 0
            };
        }
        
        const remaining = Math.max(0, this.maxRequests - userData.count);
        const retryAfter = Math.max(0, Math.ceil((userData.resetTime - now) / 1000));
        
        return {
            remaining: remaining,
            resetTime: userData.resetTime,
            retryAfter: retryAfter
        };
    }

    /**
     * Reset rate limit for a specific user and command
     * @param {string} userId - Discord user ID
     * @param {string} commandName - Name of the command
     */
    resetLimit(userId, commandName = 'global') {
        const key = `${userId}:${commandName}`;
        this.requests.delete(key);
        Logger.info(`Rate limit reset for user ${userId} on command ${commandName}`);
    }

    /**
     * Reset all rate limits for a user
     * @param {string} userId - Discord user ID
     */
    resetUserLimits(userId) {
        const keysToDelete = [];
        for (const key of this.requests.keys()) {
            if (key.startsWith(`${userId}:`)) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.requests.delete(key));
        Logger.info(`All rate limits reset for user ${userId}`);
    }

    /**
     * Get current rate limit statistics
     * @returns {Object} - Statistics about current rate limits
     */
    getStats() {
        const now = Date.now();
        let activeUsers = 0;
        let totalRequests = 0;
        let expiredEntries = 0;
        
        for (const [key, data] of this.requests.entries()) {
            if (now >= data.resetTime) {
                expiredEntries++;
            } else {
                activeUsers++;
                totalRequests += data.count;
            }
        }
        
        return {
            activeUsers: activeUsers,
            totalRequests: totalRequests,
            expiredEntries: expiredEntries,
            totalEntries: this.requests.size,
            windowMs: this.windowMs,
            maxRequests: this.maxRequests
        };
    }

    /**
     * Start the cleanup timer to remove expired entries
     */
    startCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.cleanupInterval);
        
        Logger.info(`Rate limiter cleanup started (interval: ${this.cleanupInterval}ms)`);
    }

    /**
     * Stop the cleanup timer
     */
    stopCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
            Logger.info('Rate limiter cleanup stopped');
        }
    }

    /**
     * Clean up expired entries
     */
    cleanup() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, data] of this.requests.entries()) {
            if (now >= data.resetTime) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.requests.delete(key));
        
        if (keysToDelete.length > 0) {
            Logger.debug(`Rate limiter cleanup: removed ${keysToDelete.length} expired entries`);
        }
    }

    /**
     * Format retry time in a human-readable way
     * @param {number} retryAfter - Seconds until retry
     * @returns {string} - Formatted time string
     */
    formatRetryTime(retryAfter) {
        if (retryAfter < 60) {
            return `${retryAfter} second${retryAfter !== 1 ? 's' : ''}`;
        } else if (retryAfter < 3600) {
            const minutes = Math.ceil(retryAfter / 60);
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else {
            const hours = Math.ceil(retryAfter / 3600);
            return `${hours} hour${hours !== 1 ? 's' : ''}`;
        }
    }

    /**
     * Destroy the rate limiter and clean up resources
     */
    destroy() {
        this.stopCleanup();
        this.requests.clear();
        Logger.info('Rate limiter destroyed');
    }
}

module.exports = RateLimiter;
