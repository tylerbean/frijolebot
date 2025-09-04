const RateLimiter = require('../../utils/rateLimiter');

// Mock Logger
jest.mock('../../utils/logger');
const Logger = require('../../utils/logger');

describe('RateLimiter', () => {
  let rateLimiter;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear any existing timers
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (rateLimiter) {
      rateLimiter.destroy();
    }
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      rateLimiter = new RateLimiter();
      
      expect(rateLimiter.windowMs).toBe(60000);
      expect(rateLimiter.maxRequests).toBe(5);
      expect(rateLimiter.cleanupInterval).toBe(300000);
      expect(rateLimiter.requests).toBeInstanceOf(Map);
    });

    it('should initialize with custom options', () => {
      const options = {
        windowMs: 30000,
        maxRequests: 10,
        cleanupInterval: 60000
      };
      
      rateLimiter = new RateLimiter(options);
      
      expect(rateLimiter.windowMs).toBe(30000);
      expect(rateLimiter.maxRequests).toBe(10);
      expect(rateLimiter.cleanupInterval).toBe(60000);
    });

    it('should start cleanup timer', () => {
      rateLimiter = new RateLimiter({ cleanupInterval: 1000 });
      
      expect(Logger.info).toHaveBeenCalledWith('Rate limiter cleanup started (interval: 1000ms)');
    });
  });

  describe('checkLimit', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        cleanupInterval: 300000
      });
    });

    it('should allow requests within limit', () => {
      const result1 = rateLimiter.checkLimit('user1', 'test');
      const result2 = rateLimiter.checkLimit('user1', 'test');
      
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);
    });

    it('should block requests when limit exceeded', () => {
      // Make 3 requests (at limit)
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user1', 'test');
      
      // 4th request should be blocked
      const result = rateLimiter.checkLimit('user1', 'test');
      
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should reset window after time expires', () => {
      // Make 3 requests (at limit)
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user1', 'test');
      
      // Advance time past window
      jest.advanceTimersByTime(61000);
      
      // Should allow requests again
      const result = rateLimiter.checkLimit('user1', 'test');
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should handle different users independently', () => {
      const result1 = rateLimiter.checkLimit('user1', 'test');
      const result2 = rateLimiter.checkLimit('user2', 'test');
      
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(2);
    });

    it('should handle different commands independently', () => {
      const result1 = rateLimiter.checkLimit('user1', 'command1');
      const result2 = rateLimiter.checkLimit('user1', 'command2');
      
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(2);
    });

    it('should log warning when rate limit exceeded', () => {
      // Make 3 requests (at limit)
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user1', 'test');
      
      // 4th request should trigger warning
      rateLimiter.checkLimit('user1', 'test');
      
      expect(Logger.warning).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded for user user1 on command test')
      );
    });
  });

  describe('getLimitInfo', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 3
      });
    });

    it('should return full limit for new user', () => {
      const info = rateLimiter.getLimitInfo('user1', 'test');
      
      expect(info.remaining).toBe(3);
      expect(info.retryAfter).toBe(0);
    });

    it('should return correct info for user with requests', () => {
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user1', 'test');
      
      const info = rateLimiter.getLimitInfo('user1', 'test');
      
      expect(info.remaining).toBe(1);
      expect(info.retryAfter).toBeGreaterThan(0);
    });

    it('should not increment counter', () => {
      const info1 = rateLimiter.getLimitInfo('user1', 'test');
      const info2 = rateLimiter.getLimitInfo('user1', 'test');
      
      expect(info1.remaining).toBe(info2.remaining);
    });
  });

  describe('resetLimit', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 3
      });
    });

    it('should reset limit for specific user and command', () => {
      // Make requests
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user1', 'test');
      
      // Reset limit
      rateLimiter.resetLimit('user1', 'test');
      
      // Should have full limit again
      const result = rateLimiter.checkLimit('user1', 'test');
      expect(result.remaining).toBe(2);
    });

    it('should log reset action', () => {
      rateLimiter.resetLimit('user1', 'test');
      
      expect(Logger.info).toHaveBeenCalledWith(
        'Rate limit reset for user user1 on command test'
      );
    });
  });

  describe('resetUserLimits', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 3
      });
    });

    it('should reset all limits for a user', () => {
      // Make requests for different commands
      rateLimiter.checkLimit('user1', 'command1');
      rateLimiter.checkLimit('user1', 'command2');
      
      // Reset all limits
      rateLimiter.resetUserLimits('user1');
      
      // Should have full limits again
      const result1 = rateLimiter.checkLimit('user1', 'command1');
      const result2 = rateLimiter.checkLimit('user1', 'command2');
      
      expect(result1.remaining).toBe(2);
      expect(result2.remaining).toBe(2);
    });

    it('should not affect other users', () => {
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user2', 'test');
      
      rateLimiter.resetUserLimits('user1');
      
      const result1 = rateLimiter.checkLimit('user1', 'test');
      const result2 = rateLimiter.checkLimit('user2', 'test');
      
      expect(result1.remaining).toBe(2); // Reset
      expect(result2.remaining).toBe(1); // Not reset
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 3
      });
    });

    it('should return correct statistics', () => {
      rateLimiter.checkLimit('user1', 'test');
      rateLimiter.checkLimit('user2', 'test');
      
      const stats = rateLimiter.getStats();
      
      expect(stats.activeUsers).toBe(2);
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalEntries).toBe(2);
      expect(stats.windowMs).toBe(60000);
      expect(stats.maxRequests).toBe(3);
    });

    it('should count expired entries', () => {
      rateLimiter.checkLimit('user1', 'test');
      
      // Advance time past window
      jest.advanceTimersByTime(61000);
      
      const stats = rateLimiter.getStats();
      
      expect(stats.activeUsers).toBe(0);
      expect(stats.expiredEntries).toBe(1);
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        cleanupInterval: 1000
      });
    });

    it('should remove expired entries', () => {
      rateLimiter.checkLimit('user1', 'test');
      
      // Advance time past window
      jest.advanceTimersByTime(61000);
      
      // Trigger cleanup
      rateLimiter.cleanup();
      
      const stats = rateLimiter.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('should log cleanup actions', () => {
      rateLimiter.checkLimit('user1', 'test');
      jest.advanceTimersByTime(61000);
      
      rateLimiter.cleanup();
      
      expect(Logger.debug).toHaveBeenCalledWith(
        'Rate limiter cleanup: removed 1 expired entries'
      );
    });

    it('should not log when no cleanup needed', () => {
      rateLimiter.cleanup();
      
      expect(Logger.debug).not.toHaveBeenCalled();
    });
  });

  describe('formatRetryTime', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter();
    });

    it('should format seconds correctly', () => {
      expect(rateLimiter.formatRetryTime(1)).toBe('1 second');
      expect(rateLimiter.formatRetryTime(30)).toBe('30 seconds');
    });

    it('should format minutes correctly', () => {
      expect(rateLimiter.formatRetryTime(60)).toBe('1 minute');
      expect(rateLimiter.formatRetryTime(120)).toBe('2 minutes');
    });

    it('should format hours correctly', () => {
      expect(rateLimiter.formatRetryTime(3600)).toBe('1 hour');
      expect(rateLimiter.formatRetryTime(7200)).toBe('2 hours');
    });
  });

  describe('destroy', () => {
    it('should stop cleanup timer and clear requests', () => {
      rateLimiter = new RateLimiter({ cleanupInterval: 1000 });
      rateLimiter.checkLimit('user1', 'test');
      
      rateLimiter.destroy();
      
      expect(Logger.info).toHaveBeenCalledWith('Rate limiter destroyed');
      expect(rateLimiter.requests.size).toBe(0);
    });
  });
});
