// Mocks must be declared before requiring CommandHandler
jest.mock('../../handlers/reactionHandler');
jest.mock('../../utils/logger');
jest.mock('../../utils/rateLimiter');
const Logger = require('../../utils/logger');
const RateLimiter = require('../../utils/rateLimiter');

const CommandHandler = require('../../handlers/commandHandler');
const { mockConfig, mockDiscordInteraction } = require('../fixtures/mockData');

const PostgreSQLService = require('../../services/PostgreSQLService');
const ReactionHandler = require('../../handlers/reactionHandler');

describe('CommandHandler - Rate Limiting', () => {
  let commandHandler;
  let mockPostgresService;
  let mockReactionHandler;
  let mockInteraction;
  let mockRateLimiter;

  beforeEach(() => {
    mockPostgresService = {
      getUnreadLinksForUser: jest.fn(),
      getUnreadLinksForUserAllGuilds: jest.fn(),
      createDMMapping: jest.fn(),
      createBulkDMMapping: jest.fn()
    };

    mockReactionHandler = {
      addDMMessageMapping: jest.fn(),
      addBulkDMMapping: jest.fn()
    };

    mockRateLimiter = {
      checkLimit: jest.fn(),
      getLimitInfo: jest.fn(),
      resetLimit: jest.fn(),
      resetUserLimits: jest.fn(),
      getStats: jest.fn(),
      destroy: jest.fn(),
      formatRetryTime: jest.fn()
    };

    // Mock RateLimiter constructor
    RateLimiter.mockImplementation(() => mockRateLimiter);

    const configWithRateLimit = {
      ...mockConfig,
      rateLimit: {
        enabled: true,
        windowMs: 60000,
        maxRequests: 5,
        cleanupInterval: 300000
      }
    };

    jest.clearAllMocks();

    commandHandler = new CommandHandler(
      mockPostgresService,
      mockReactionHandler,
      configWithRateLimit,
      {}
    );

    mockInteraction = { ...mockDiscordInteraction };
  });

  afterEach(() => {
    // Clean up rate limiter interval to prevent Jest from hanging
    if (commandHandler && typeof commandHandler.destroy === 'function') {
      commandHandler.destroy();
    }
  });

  describe('constructor with rate limiting enabled', () => {
    it('should initialize rate limiter when enabled', () => {
      expect(RateLimiter).toHaveBeenCalledWith({
        windowMs: 60000,
        maxRequests: 5,
        cleanupInterval: 300000
      });
      expect(commandHandler.rateLimiter).toBe(mockRateLimiter);
      expect(Logger.info).toHaveBeenCalledWith(
        'Rate limiting enabled: 5 requests per 60000ms'
      );
    });
  });

  describe('constructor with rate limiting disabled', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should not initialize rate limiter when disabled', () => {
      const configWithoutRateLimit = {
        ...mockConfig,
        rateLimit: {
          enabled: false
        }
      };

      const handler = new CommandHandler(
        mockPostgresService,
        mockReactionHandler,
        configWithoutRateLimit,
        {}
      );

      expect(RateLimiter).not.toHaveBeenCalled();
      expect(handler.rateLimiter).toBeNull();
      expect(Logger.info).toHaveBeenCalledWith('Rate limiting disabled');
    });
  });

  describe('checkRateLimit', () => {
    it('should return null when rate limiting is disabled', async () => {
      commandHandler.rateLimiter = null;
      
      const result = await commandHandler.checkRateLimit(mockInteraction, 'test');
      
      expect(result).toBeNull();
    });

    it('should allow request when not rate limited', async () => {
      mockRateLimiter.checkLimit.mockReturnValue({
        allowed: true,
        remaining: 4,
        resetTime: Date.now() + 60000,
        retryAfter: 0
      });

      const result = await commandHandler.checkRateLimit(mockInteraction, 'test');
      
      expect(result).toBeNull();
      expect(mockRateLimiter.checkLimit).toHaveBeenCalledWith('987654321', 'test');
    });

    it('should block request when rate limited', async () => {
      mockRateLimiter.checkLimit.mockReturnValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 30000,
        retryAfter: 30
      });
      mockRateLimiter.formatRetryTime.mockReturnValue('30 seconds');

      const result = await commandHandler.checkRateLimit(mockInteraction, 'test');
      
      expect(result).not.toBeNull();
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Rate Limited'),
        flags: 64
      });
      expect(Logger.warning).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded for user testuser')
      );
    });
  });

  describe('handleUnreadCommand with rate limiting', () => {
    it('should proceed when not rate limited', async () => {
      mockRateLimiter.checkLimit.mockReturnValue({
        allowed: true,
        remaining: 4,
        resetTime: Date.now() + 60000,
        retryAfter: 0
      });

      mockPostgresService.getUnreadLinksForUser.mockResolvedValue([]);

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockPostgresService.getUnreadLinksForUser).toHaveBeenCalled();
    });

    it('should stop execution when rate limited', async () => {
      mockRateLimiter.checkLimit.mockReturnValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 30000,
        retryAfter: 30
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockPostgresService.getUnreadLinksForUser).not.toHaveBeenCalled();
    });
  });

  describe('handleCommand generic method', () => {
    it('should apply rate limiting to any command', async () => {
      const mockCommandHandler = jest.fn();
      
      mockRateLimiter.checkLimit.mockReturnValue({
        allowed: true,
        remaining: 4,
        resetTime: Date.now() + 60000,
        retryAfter: 0
      });

      await commandHandler.handleCommand(mockInteraction, 'test', mockCommandHandler);

      expect(mockRateLimiter.checkLimit).toHaveBeenCalledWith('987654321', 'test');
      expect(mockCommandHandler).toHaveBeenCalledWith(mockInteraction);
    });

    it('should not execute command when rate limited', async () => {
      const mockCommandHandler = jest.fn();
      
      mockRateLimiter.checkLimit.mockReturnValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 30000,
        retryAfter: 30
      });

      await commandHandler.handleCommand(mockInteraction, 'test', mockCommandHandler);

      expect(mockCommandHandler).not.toHaveBeenCalled();
    });

    it('should handle command errors gracefully', async () => {
      const mockCommandHandler = jest.fn().mockRejectedValue(new Error('Command error'));
      
      mockRateLimiter.checkLimit.mockReturnValue({
        allowed: true,
        remaining: 4,
        resetTime: Date.now() + 60000,
        retryAfter: 0
      });

      await commandHandler.handleCommand(mockInteraction, 'test', mockCommandHandler);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling test command:',
        expect.any(Error)
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ An error occurred while processing your command. Please try again later.',
        flags: 64
      });
    });
  });

  describe('getRateLimitInfo', () => {
    it('should return disabled status when rate limiting is disabled', () => {
      commandHandler.rateLimiter = null;
      
      const info = commandHandler.getRateLimitInfo('user1', 'test');
      
      expect(info).toEqual({ enabled: false });
    });

    it('should return rate limit info when enabled', () => {
      mockRateLimiter.getLimitInfo.mockReturnValue({
        remaining: 3,
        resetTime: Date.now() + 30000,
        retryAfter: 30
      });

      const info = commandHandler.getRateLimitInfo('user1', 'test');
      
      expect(info).toEqual({
        enabled: true,
        remaining: 3,
        resetTime: expect.any(Number),
        retryAfter: 30,
        maxRequests: 5,
        windowMs: 60000
      });
    });
  });

  describe('resetRateLimit', () => {
    it('should do nothing when rate limiting is disabled', () => {
      commandHandler.rateLimiter = null;
      
      commandHandler.resetRateLimit('user1', 'test');
      
      expect(mockRateLimiter.resetLimit).not.toHaveBeenCalled();
    });

    it('should reset specific command limit', () => {
      commandHandler.resetRateLimit('user1', 'test');
      
      expect(mockRateLimiter.resetLimit).toHaveBeenCalledWith('user1', 'test');
    });

    it('should reset all user limits when no command specified', () => {
      commandHandler.resetRateLimit('user1');
      
      expect(mockRateLimiter.resetUserLimits).toHaveBeenCalledWith('user1');
    });
  });

  describe('getRateLimitStats', () => {
    it('should return disabled status when rate limiting is disabled', () => {
      commandHandler.rateLimiter = null;
      
      const stats = commandHandler.getRateLimitStats();
      
      expect(stats).toEqual({ enabled: false });
    });

    it('should return rate limiter stats when enabled', () => {
      const mockStats = {
        activeUsers: 5,
        totalRequests: 25,
        expiredEntries: 2,
        totalEntries: 7
      };
      
      mockRateLimiter.getStats.mockReturnValue(mockStats);

      const stats = commandHandler.getRateLimitStats();
      
      expect(stats).toEqual({
        enabled: true,
        ...mockStats
      });
    });
  });

  describe('destroy', () => {
    it('should destroy rate limiter when present', () => {
      commandHandler.destroy();
      
      expect(mockRateLimiter.destroy).toHaveBeenCalled();
    });

    it('should handle missing rate limiter gracefully', () => {
      commandHandler.rateLimiter = null;
      
      expect(() => commandHandler.destroy()).not.toThrow();
    });
  });
});
