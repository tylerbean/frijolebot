const path = require('path');

// Mock dotenv before requiring config
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

describe('Config', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clear module cache to ensure fresh config load
    jest.resetModules();
  });

  describe('with valid environment variables', () => {
    beforeEach(() => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_TEST1 = '111111111';
      process.env.DISCORD_CHANNEL_TEST2 = '222222222';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';
      process.env.HEALTH_CHECK_PORT = '3001';
      process.env.NODE_ENV = 'test';
    });

    it('should load configuration successfully', () => {
      const config = require('../../config');

      expect(config).toEqual({
        discord: {
          token: 'test-discord-token',
          guildId: '123456789',
          channelsToMonitor: ['111111111', '222222222']
        },
        baserow: {
          apiToken: 'test-baserow-token',
          apiUrl: 'https://test-baserow.com/api/database/table/123/'
        },
        app: {
          nodeEnv: 'test'
        },
        health: {
          port: '3001'
        },
        rateLimit: {
          enabled: true,
          windowMs: 60000,
          maxRequests: 5,
          cleanupInterval: 300000
        }
      });
    });

    it('should parse channel IDs correctly', () => {
      process.env.DISCORD_CHANNEL_TEST1 = '111111111';
      process.env.DISCORD_CHANNEL_TEST2 = '222222222';
      process.env.DISCORD_CHANNEL_TEST3 = '333333333';
      const config = require('../../config');

      expect(config.discord.channelsToMonitor).toEqual(['111111111', '222222222', '333333333']);
    });

    it('should handle single channel ID', () => {
      // Clear all existing channel environment variables
      Object.keys(process.env).forEach(key => {
        if (key.startsWith('DISCORD_CHANNEL_')) {
          delete process.env[key];
        }
      });
      
      process.env.DISCORD_CHANNEL_SINGLE = '111111111';
      const config = require('../../config');

      expect(config.discord.channelsToMonitor).toEqual(['111111111']);
    });

    it('should use default NODE_ENV when not set', () => {
      delete process.env.NODE_ENV;
      const config = require('../../config');

      expect(config.app.nodeEnv).toBe('development');
    });

    it('should use default HEALTH_CHECK_PORT when not set', () => {
      delete process.env.HEALTH_CHECK_PORT;
      const config = require('../../config');

      expect(config.health.port).toBe(3000);
    });
  });

  describe('with missing required environment variables', () => {
    it('should throw error for missing DISCORD_BOT_TOKEN', () => {
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_TEST1 = '111111111';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';
      delete process.env.DISCORD_BOT_TOKEN;

      expect(() => {
        require('../../config');
      }).toThrow('Missing required environment variables: DISCORD_BOT_TOKEN');
    });

    it('should throw error for missing DISCORD_GUILD_ID', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_CHANNEL_TEST1 = '111111111';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';
      delete process.env.DISCORD_GUILD_ID;

      expect(() => {
        require('../../config');
      }).toThrow('Missing required environment variables: DISCORD_GUILD_ID');
    });

    it('should throw error for missing Discord channels', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      expect(() => {
        require('../../config');
      }).toThrow('No Discord channels configured for monitoring');
    });

    it('should throw error for missing BASEROW_API_TOKEN', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_TEST1 = '111111111';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';
      delete process.env.BASEROW_API_TOKEN;

      expect(() => {
        require('../../config');
      }).toThrow('Missing required environment variables: BASEROW_API_TOKEN');
    });

    it('should throw error for missing BASEROW_API_URL', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_TEST1 = '111111111';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      delete process.env.BASEROW_API_URL;

      expect(() => {
        require('../../config');
      }).toThrow('Missing required environment variables: BASEROW_API_URL');
    });
  });

  describe('with empty channel list', () => {
    it('should throw error for empty Discord channels', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_EMPTY = '';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      expect(() => {
        require('../../config');
      }).toThrow('No Discord channels configured for monitoring');
    });

    it('should throw error for whitespace-only Discord channels', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_WHITESPACE = '   ';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      expect(() => {
        require('../../config');
      }).toThrow('No Discord channels configured for monitoring');
    });
  });

  describe('channel ID filtering', () => {
    it('should filter out empty channel IDs', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_VALID1 = '111111111';
      process.env.DISCORD_CHANNEL_EMPTY = '';
      process.env.DISCORD_CHANNEL_VALID2 = '222222222';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      const config = require('../../config');

      expect(config.discord.channelsToMonitor).toEqual(['111111111', '222222222']);
    });

    it('should filter out whitespace-only channel IDs', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNEL_VALID1 = '111111111';
      process.env.DISCORD_CHANNEL_WHITESPACE = '   ';
      process.env.DISCORD_CHANNEL_VALID2 = '222222222';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      const config = require('../../config');

      expect(config.discord.channelsToMonitor).toEqual(['111111111', '222222222']);
    });
  });
});
