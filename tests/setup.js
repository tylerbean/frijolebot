// Test setup file for Jest

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
process.env.DISCORD_GUILD_ID = '123456789';
process.env.DISCORD_CHANNELS_TO_MONITOR = '111111111,222222222';
process.env.BASEROW_API_TOKEN = 'test-baserow-token';
process.env.BASEROW_API_URL = 'https://test-baserow.com/api/database/table/';
process.env.BASEROW_LINKS_TABLE_ID = '123';
process.env.BASEROW_DM_MAPPING_TABLE_ID = '43';
process.env.HEALTH_CHECK_PORT = '3001';

// WhatsApp test environment variables
process.env.WHATSAPP_ENABLED = 'true';
// encryption key no longer required
process.env.BASEROW_WHATSAPP_SESSIONS_TABLE_ID = '45';
process.env.BASEROW_WHATSAPP_CHATS_TABLE_ID = '44';
process.env.BASEROW_WHATSAPP_MESSAGES_TABLE_ID = '46';
process.env.WHATSAPP_STORE_MESSAGES = 'false';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to suppress console output during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Global test utilities
global.testUtils = {
  // Mock Discord message data
  createMockMessage: (overrides = {}) => ({
    id: '123456789',
    content: 'Check out this link: https://example.com',
    author: {
      id: '987654321',
      username: 'testuser',
      bot: false
    },
    channel: {
      id: '111111111',
      name: 'test-channel'
    },
    guild: {
      id: '123456789',
      name: 'Test Server'
    },
    createdAt: new Date('2025-01-15T10:30:00.000Z'),
    ...overrides
  }),

  // Mock Discord interaction data
  createMockInteraction: (overrides = {}) => ({
    isChatInputCommand: () => true,
    commandName: 'unread',
    user: {
      id: '987654321',
      username: 'testuser'
    },
    guildId: '123456789',
    guild: {
      id: '123456789',
      name: 'Test Server'
    },
    deferReply: jest.fn(),
    editReply: jest.fn(),
    reply: jest.fn(),
    ...overrides
  }),

  // Mock Discord reaction data
  createMockReaction: (overrides = {}) => ({
    emoji: {
      name: '1️⃣'
    },
    message: {
      id: '123456789',
      guild: {
        id: '123456789'
      },
      channel: {
        id: '111111111'
      },
      author: {
        id: '987654321',
        username: 'testuser'
      }
    },
    partial: false,
    fetch: jest.fn(),
    ...overrides
  }),

  // Mock Baserow API response
  createMockBaserowResponse: (data = []) => ({
    data: {
      results: data,
      count: data.length
    },
    status: 200
  }),

  // Mock Discord client
  createMockDiscordClient: () => ({
    isReady: () => true,
    user: {
      tag: 'TestBot#1234'
    },
    guilds: {
      cache: new Map([
        ['123456789', {
          id: '123456789',
          name: 'Test Server',
          members: {
            fetch: jest.fn().mockResolvedValue({
              id: '987654321',
              user: { username: 'testuser' }
            })
          },
          channels: {
            cache: new Map([
              ['111111111', {
                id: '111111111',
                name: 'test-channel',
                permissionsFor: jest.fn().mockReturnValue({
                  has: jest.fn().mockReturnValue(true)
                })
              }]
            ])
          }
        }]
      ])
    }
  })
};

// Increase timeout for integration tests
// jest.setTimeout(10000);
