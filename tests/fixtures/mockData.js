// Mock data for testing

const mockBaserowLink = {
  id: 1,
  url: 'https://example.com',
  content: 'Check out this link: https://example.com',
  channel_id: '111111111',
  channel_name: 'test-channel',
  user: 'testuser',
  user_id: '987654321',
  message_id: '123456789',
  timestamp: '2025-01-15T10:30:00.000Z',
  read: false,
  guild_id: '123456789'
};

const mockBaserowLinks = [
  mockBaserowLink,
  {
    id: 2,
    url: 'https://github.com',
    content: 'Check out this repo: https://github.com',
    channel_id: '111111111',
    channel_name: 'test-channel',
    user: 'otheruser',
    user_id: '111111111',
    message_id: '987654321',
    timestamp: '2025-01-15T11:00:00.000Z',
    read: false,
    guild_id: '123456789'
  },
  {
    id: 3,
    url: 'https://stackoverflow.com',
    content: 'Help needed: https://stackoverflow.com',
    channel_id: '222222222',
    channel_name: 'help-channel',
    user: 'testuser',
    user_id: '987654321',
    message_id: '555555555',
    timestamp: '2025-01-15T12:00:00.000Z',
    read: true,
    guild_id: '123456789'
  }
];

const mockDMMapping = {
  id: 1,
  dm_message_id: '1413205772032020500',
  emoji: '1️⃣',
  original_message_id: '1413199319758012447',
  guild_id: '611026701299875853',
  user_id: '186917645944094720',
  created_at: '2025-01-15T10:30:00.000Z',
  expires_at: '2026-01-16T10:30:00.000Z' // Set to future date to avoid expiration
};

const mockBulkDMMapping = {
  id: 2,
  dm_message_id: '1413205772032020500',
  emoji: '✅',
  original_message_id: '["1413199319758012447", "987654321"]',
  guild_id: 'all_guilds',
  user_id: '186917645944094720',
  created_at: '2025-01-15T10:30:00.000Z',
  expires_at: '2025-01-16T10:30:00.000Z'
};

const mockConfig = {
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
    port: 3001
  },
  rateLimit: {
    enabled: true,
    windowMs: 60000,
    maxRequests: 5,
    cleanupInterval: 300000
  }
};

const mockDiscordMessage = {
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
  createdAt: new Date('2025-01-15T10:30:00.000Z')
};

const mockDiscordInteraction = {
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
  reply: jest.fn()
};

const mockDiscordReaction = {
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
  fetch: jest.fn()
};

const mockDiscordClient = {
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
};

module.exports = {
  mockBaserowLink,
  mockBaserowLinks,
  mockDMMapping,
  mockBulkDMMapping,
  mockConfig,
  mockDiscordMessage,
  mockDiscordInteraction,
  mockDiscordReaction,
  mockDiscordClient
};
