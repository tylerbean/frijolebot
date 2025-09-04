const CommandHandler = require('../../handlers/commandHandler');
const { mockConfig, mockDiscordInteraction, mockBaserowLinks, mockDiscordClient } = require('../fixtures/mockData');

// Mock dependencies
jest.mock('../../services/BaserowService');
jest.mock('../../handlers/reactionHandler');
jest.mock('../../utils/logger');

const BaserowService = require('../../services/BaserowService');
const ReactionHandler = require('../../handlers/reactionHandler');
const Logger = require('../../utils/logger');

describe('CommandHandler', () => {
  let commandHandler;
  let mockBaserowService;
  let mockReactionHandler;
  let mockInteraction;

  beforeEach(() => {
    mockBaserowService = {
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
      mockBaserowService,
      mockReactionHandler,
      mockConfig,
      mockDiscordClient
    );

    mockInteraction = { ...mockDiscordInteraction };
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct dependencies', () => {
      expect(commandHandler.baserowService).toBe(mockBaserowService);
      expect(commandHandler.reactionHandler).toBe(mockReactionHandler);
      expect(commandHandler.config).toBe(mockConfig);
      expect(commandHandler.discordClient).toBe(mockDiscordClient);
    });
  });

  describe('handleUnreadCommand', () => {
    it('should handle unread command in server channel successfully', async () => {
      mockBaserowService.getUnreadLinksForUser.mockResolvedValue(mockBaserowLinks);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 }); // MessageFlags.Ephemeral
      expect(mockBaserowService.getUnreadLinksForUser).toHaveBeenCalledWith(
        'testuser',
        '123456789',
        '987654321',
        mockDiscordClient
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('I\'ve sent you a DM'),
        flags: 64
      });
    });

    it('should handle unread command in DM successfully', async () => {
      mockBaserowService.getUnreadLinksForUserAllGuilds.mockResolvedValue(mockBaserowLinks);
      mockInteraction.guildId = null; // DM usage
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockBaserowService.getUnreadLinksForUserAllGuilds).toHaveBeenCalledWith(
        'testuser',
        '987654321',
        mockDiscordClient
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('I\'ve sent you a DM with your unread links from all servers'),
        flags: 64
      });
    });

    it('should handle no unread links in server channel', async () => {
      mockBaserowService.getUnreadLinksForUser.mockResolvedValue([]);
      mockInteraction.guildId = '123456789';

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '🎉 You\'re all caught up! No unread links from others.',
        flags: 64
      });
    });

    it('should handle no unread links in DM', async () => {
      mockBaserowService.getUnreadLinksForUserAllGuilds.mockResolvedValue([]);
      mockInteraction.guildId = null;

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '🎉 You\'re all caught up! No unread links from others in any server.',
        flags: 64
      });
    });

    it('should handle DM creation errors', async () => {
      mockBaserowService.getUnreadLinksForUser.mockResolvedValue(mockBaserowLinks);
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
      mockBaserowService.getUnreadLinksForUser.mockResolvedValue(singleLink);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockBaserowService.createDMMapping).toHaveBeenCalledWith(
        'dm-message-id',
        '1️⃣',
        singleLink[0].message_id,
        singleLink[0].guild_id,
        '987654321'
      );
    });

    it('should create bulk DM mapping for checkmark reaction', async () => {
      mockBaserowService.getUnreadLinksForUser.mockResolvedValue(mockBaserowLinks);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(mockBaserowService.createBulkDMMapping).toHaveBeenCalledWith(
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
      
      mockBaserowService.getUnreadLinksForUser.mockResolvedValue(manyLinks);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      // Should create mappings for first 10 links (numbered reactions)
      expect(mockBaserowService.createDMMapping).toHaveBeenCalledTimes(10);
      
      // Should create mappings for links 11-15 (letter reactions)
      expect(mockBaserowService.createDMMapping).toHaveBeenCalledWith(
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
      
      mockBaserowService.getUnreadLinksForUser.mockResolvedValue(manyLinks);
      mockInteraction.guildId = '123456789';
      mockInteraction.user.createDM = jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          id: 'dm-message-id',
          react: jest.fn()
        })
      });

      await commandHandler.handleUnreadCommand(mockInteraction);

      // Should only process first 25 links
      expect(mockBaserowService.createDMMapping).toHaveBeenCalledTimes(25);
    });

    it('should handle errors gracefully', async () => {
      mockBaserowService.getUnreadLinksForUser.mockRejectedValue(new Error('Service Error'));
      mockInteraction.guildId = '123456789';

      await commandHandler.handleUnreadCommand(mockInteraction);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling unread command:',
        expect.any(Error)
      );
    });
  });
});
