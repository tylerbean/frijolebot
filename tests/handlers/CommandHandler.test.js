const CommandHandler = require('../../handlers/commandHandler');
const { mockConfig, mockDiscordInteraction, mockBaserowLinks, mockDiscordClient } = require('../fixtures/mockData');

// Mock dependencies
jest.mock('../../handlers/reactionHandler');
jest.mock('../../utils/logger');

const PostgreSQLService = require('../../services/PostgreSQLService');
const ReactionHandler = require('../../handlers/reactionHandler');
const Logger = require('../../utils/logger');

describe('CommandHandler', () => {
  let commandHandler;
  let mockPostgresService;
  let mockReactionHandler;
  let mockInteraction;

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

    commandHandler = new CommandHandler(
      mockPostgresService,
      mockReactionHandler,
      mockConfig,
      mockDiscordClient
    );

    mockInteraction = { ...mockDiscordInteraction };
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up rate limiter interval to prevent Jest from hanging
    if (commandHandler && typeof commandHandler.destroy === 'function') {
      commandHandler.destroy();
    }
  });

  describe('constructor', () => {
    it('should initialize with correct dependencies', () => {
      expect(commandHandler.postgresService).toBe(mockPostgresService);
      expect(commandHandler.reactionHandler).toBe(mockReactionHandler);
      expect(commandHandler.config).toBe(mockConfig);
      expect(commandHandler.discordClient).toBe(mockDiscordClient);
    });
  });

  describe('handleUnreadCommand', () => {
    it('should handle unread command in server channel successfully', async () => {
      mockPostgresService.getUnreadLinksForUser.mockResolvedValue(mockBaserowLinks);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 }); // MessageFlags.Ephemeral
      expect(mockPostgresService.getUnreadLinksForUser).toHaveBeenCalledWith(
        'testuser',
        '123456789',
        '987654321',
        mockDiscordClient
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("I've sent you a DM"),
        flags: 64
      });
    });

    it('should handle unread command in DM successfully', async () => {
      mockPostgresService.getUnreadLinksForUserAllGuilds.mockResolvedValue(mockBaserowLinks);
      mockInteraction.guildId = null; // DM usage
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockPostgresService.getUnreadLinksForUserAllGuilds).toHaveBeenCalledWith(
        'testuser',
        '987654321',
        mockDiscordClient
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("I've sent you a DM with your unread links from all servers"),
        flags: 64
      });
    });

    it('should handle no unread links in server channel', async () => {
      mockPostgresService.getUnreadLinksForUser.mockResolvedValue([]);
      mockInteraction.guildId = '123456789';

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '🎉 You\'re all caught up! No unread links from others.',
        flags: 64
      });
    });

    it('should handle no unread links in DM', async () => {
      mockPostgresService.getUnreadLinksForUserAllGuilds.mockResolvedValue([]);
      mockInteraction.guildId = null;

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '🎉 You\'re all caught up! No unread links from others in any server.',
        flags: 64
      });
    });

    it('should handle DM creation errors', async () => {
      mockPostgresService.getUnreadLinksForUser.mockResolvedValue(mockBaserowLinks);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockRejectedValue(new Error('DM Error'));

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ I couldn\'t send you a DM. Please check your privacy settings.',
        flags: 64
      });
    });

    it('should create DM mappings for individual reactions', async () => {
      const singleLink = [mockBaserowLinks[0]];
      mockPostgresService.getUnreadLinksForUser.mockResolvedValue(singleLink);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockPostgresService.createDMMapping).toHaveBeenCalledWith(
        'dm-message-id',
        '1️⃣',
        singleLink[0].message_id,
        singleLink[0].guild_id,
        '987654321'
      );
    });

    it('should create bulk DM mapping for checkmark reaction', async () => {
      mockPostgresService.getUnreadLinksForUser.mockResolvedValue(mockBaserowLinks);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockPostgresService.createBulkDMMapping).toHaveBeenCalledWith(
        'dm-message-id',
        mockBaserowLinks.map(link => link.message_id),
        '123456789',
        '987654321'
      );
    });

    it('should handle more than 10 links with additional reactions', async () => {
      const manyLinks = Array.from({ length: 15 }, (_, i) => ({
        ...mockBaserowLinks[0],
        id: i + 1,
        message_id: `message-${i + 1}`
      }));
      
      mockPostgresService.getUnreadLinksForUser.mockResolvedValue(manyLinks);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      // Should create mappings for all 15 links (10 numbered + 5 letter reactions)
      expect(mockPostgresService.createDMMapping).toHaveBeenCalledTimes(15);
      
      // Should create mappings for links 11-15 (letter reactions)
      expect(mockPostgresService.createDMMapping).toHaveBeenCalledWith(
        'dm-message-id',
        '🇦',
        'message-11',
        '123456789',
        '987654321'
      );
    });

    it('should limit to 25 links maximum', async () => {
      const manyLinks = Array.from({ length: 30 }, (_, i) => ({
        ...mockBaserowLinks[0],
        id: i + 1,
        message_id: `message-${i + 1}`
      }));
      
      mockPostgresService.getUnreadLinksForUser.mockResolvedValue(manyLinks);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      // Should only process first 25 links
      expect(mockPostgresService.createDMMapping).toHaveBeenCalledTimes(25);
    });

    it('should handle errors gracefully', async () => {
      mockPostgresService.getUnreadLinksForUser.mockRejectedValue(new Error('Service Error'));
      mockInteraction.guildId = '123456789';

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling unread command:',
        expect.any(Error)
      );
    });
  });
});
