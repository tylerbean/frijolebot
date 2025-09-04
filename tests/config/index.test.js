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
      process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111,222222222';
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
        }
      });
    });

    it('should parse channel IDs correctly', () => {
      process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111,222222222,333333333';
      const config = require('../../config');

      expect(config.discord.channelsToMonitor).toEqual(['111111111', '222222222', '333333333']);
    });

    it('should handle single channel ID', () => {
      process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111';
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
      process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      expect(() => {
        require('../../config');
      }).toThrow('DISCORD_BOT_TOKEN is required');
    });

    it('should throw error for missing DISCORD_GUILD_ID', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      expect(() => {
        require('../../config');
      }).toThrow('DISCORD_GUILD_ID is required');
    });

    it('should throw error for missing DISCORD_CHANNELS_TO_MONITOR', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      expect(() => {
        require('../../config');
      }).toThrow('DISCORD_CHANNELS_TO_MONITOR is required');
    });

    it('should throw error for missing BASEROW_API_TOKEN', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      expect(() => {
        require('../../config');
      }).toThrow('BASEROW_API_TOKEN is required');
    });

    it('should throw error for missing BASEROW_API_URL', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';

      expect(() => {
        require('../../config');
      }).toThrow('BASEROW_API_URL is required');
    });
  });

  describe('with empty channel list', () => {
    it('should throw error for empty DISCORD_CHANNELS_TO_MONITOR', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNELS_TO_MONITOR = '';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      expect(() => {
        require('../../config');
      }).toThrow('No Discord channels configured for monitoring');
    });

    it('should throw error for whitespace-only DISCORD_CHANNELS_TO_MONITOR', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNELS_TO_MONITOR = '   ,  ,  ';
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
      process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111,,222222222,';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      const config = require('../../config');

      expect(config.discord.channelsToMonitor).toEqual(['111111111', '222222222']);
    });

    it('should filter out whitespace-only channel IDs', () => {
      process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
      process.env.DISCORD_GUILD_ID = '123456789';
      process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111,   ,222222222,  ';
      process.env.BASEROW_API_TOKEN = 'test-baserow-token';
      process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/123/';

      const config = require('../../config');

      expect(config.discord.channelsToMonitor).toEqual(['111111111', '222222222']);
    });
  });
});
