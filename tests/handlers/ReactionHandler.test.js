const ReactionHandler = require('../../handlers/reactionHandler');
const { mockConfig, mockDiscordReaction, mockDMMapping, mockBaserowLink } = require('../fixtures/mockData');

// Mock dependencies
jest.mock('../../services/BaserowService');
jest.mock('../../utils/logger');

const BaserowService = require('../../services/BaserowService');
const Logger = require('../../utils/logger');

describe('ReactionHandler', () => {
  let reactionHandler;
  let mockBaserowService;
  let mockReaction;
  let mockUser;

  beforeEach(() => {
    mockBaserowService = {
      findDMMapping: jest.fn(),
      updateReadStatus: jest.fn(),
      updateReadStatusFromReaction: jest.fn(),
      deleteLink: jest.fn(),
      findLinkByMessageIdAllGuilds: jest.fn()
    };

    reactionHandler = new ReactionHandler(mockBaserowService, mockConfig);
    mockReaction = { ...mockDiscordReaction };
    mockUser = { id: '987654321', username: 'testuser' };
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with BaserowService and config', () => {
      expect(reactionHandler.baserowService).toBe(mockBaserowService);
      expect(reactionHandler.config).toBe(mockConfig);
    });
  });

  describe('handleReactionAdd', () => {
    it('should handle reaction add in server channel', async () => {
      mockReaction.emoji.name = '✅';
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111'; // This channel is in the monitored channels
      mockBaserowService.updateReadStatusFromReaction.mockResolvedValue(true);

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(mockBaserowService.updateReadStatusFromReaction).toHaveBeenCalledWith(
        '123456789',
        '123456789',
        'testuser',
        true
      );
    });

    it('should handle reaction add in DM', async () => {
      mockReaction.message.guild = null;
      mockReaction.message.id = '123456789';
      mockReaction.emoji.name = '1️⃣'; // Ensure correct emoji name
      mockBaserowService.findDMMapping.mockResolvedValue(mockDMMapping);
      mockBaserowService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(mockBaserowService.findDMMapping).toHaveBeenCalledWith(
        '123456789',
        '1️⃣'
      );
      expect(mockBaserowService.updateReadStatus).toHaveBeenCalledWith(
        '1413199319758012447',
        '611026701299875853',
        true
      );
    });

    it('should handle partial reactions', async () => {
      mockReaction.partial = true;
      mockReaction.fetch = jest.fn().mockResolvedValue(mockReaction);

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(mockReaction.fetch).toHaveBeenCalled();
    });

    it('should handle bot reactions', async () => {
      mockUser.bot = true;

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(mockBaserowService.updateReadStatusFromReaction).not.toHaveBeenCalled();
    });
  });

  describe('handleReactionRemove', () => {
    it('should handle reaction remove in server channel', async () => {
      mockReaction.emoji.name = '✅';
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111'; // This channel is in the monitored channels
      mockBaserowService.updateReadStatusFromReaction.mockResolvedValue(true);

      await reactionHandler.handleReactionRemove(mockReaction, mockUser);

      expect(mockBaserowService.updateReadStatusFromReaction).toHaveBeenCalledWith(
        '123456789',
        '123456789',
        'testuser',
        false
      );
    });

    it('should handle reaction remove in DM', async () => {
      mockReaction.message.guild = null;
      mockReaction.message.id = '123456789';
      mockReaction.emoji.name = '1️⃣'; // Ensure correct emoji name
      mockBaserowService.findDMMapping.mockResolvedValue(mockDMMapping);
      mockBaserowService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleReactionRemove(mockReaction, mockUser);

      expect(mockBaserowService.findDMMapping).toHaveBeenCalledWith(
        '123456789',
        '1️⃣'
      );
      expect(mockBaserowService.updateReadStatus).toHaveBeenCalledWith(
        '1413199319758012447',
        '611026701299875853',
        false
      );
    });

    it('should handle partial reactions', async () => {
      mockReaction.partial = true;
      mockReaction.fetch = jest.fn().mockResolvedValue(mockReaction);

      await reactionHandler.handleReactionRemove(mockReaction, mockUser);

      expect(mockReaction.fetch).toHaveBeenCalled();
    });
  });

  describe('handleDMReaction', () => {
    it('should handle individual DM reaction', async () => {
      mockReaction.emoji.name = '1️⃣'; // Ensure correct emoji name
      mockBaserowService.findDMMapping.mockResolvedValue(mockDMMapping);
      mockBaserowService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleDMReaction(mockReaction, mockUser);

      expect(mockBaserowService.updateReadStatus).toHaveBeenCalledWith(
        '1413199319758012447',
        '611026701299875853',
        true
      );
    });

    it('should handle bulk DM reaction (checkmark)', async () => {
      const bulkMapping = {
        ...mockDMMapping,
        emoji: '✅',
        original_message_id: '["1413199319758012447", "987654321"]'
      };
      mockReaction.emoji.name = '✅';
      mockBaserowService.findDMMapping.mockResolvedValue(bulkMapping);
      mockBaserowService.findLinkByMessageIdAllGuilds.mockResolvedValue(mockBaserowLink);
      mockBaserowService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleDMReaction(mockReaction, mockUser);

      expect(mockBaserowService.findLinkByMessageIdAllGuilds).toHaveBeenCalledTimes(2);
      expect(mockBaserowService.updateReadStatus).toHaveBeenCalledTimes(2);
    });

    it('should handle missing DM mapping', async () => {
      mockBaserowService.findDMMapping.mockResolvedValue(null);

      await reactionHandler.handleDMReaction(mockReaction, mockUser);

      expect(mockBaserowService.updateReadStatus).not.toHaveBeenCalled();
    });
  });

  describe('handleDMReactionRemove', () => {
    it('should handle individual DM reaction removal', async () => {
      mockReaction.emoji.name = '1️⃣';
      mockBaserowService.findDMMapping.mockResolvedValue(mockDMMapping);
      mockBaserowService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleDMReactionRemove(mockReaction, mockUser);

      expect(mockBaserowService.updateReadStatus).toHaveBeenCalledWith(
        '1413199319758012447',
        '611026701299875853',
        false
      );
    });

    it('should handle bulk DM reaction removal (checkmark)', async () => {
      const bulkMapping = {
        ...mockDMMapping,
        emoji: '✅',
        original_message_id: '["1413199319758012447", "987654321"]'
      };
      mockReaction.emoji.name = '✅';
      mockBaserowService.findDMMapping.mockResolvedValue(bulkMapping);
      mockBaserowService.findLinkByMessageIdAllGuilds.mockResolvedValue(mockBaserowLink);
      mockBaserowService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleDMReactionRemove(mockReaction, mockUser);

      expect(mockBaserowService.findLinkByMessageIdAllGuilds).toHaveBeenCalledTimes(2);
      expect(mockBaserowService.updateReadStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleDeletionReaction', () => {
    it('should handle deletion reaction for admin user', async () => {
      mockReaction.emoji.name = '❌';
      mockReaction.message.guild = { 
        id: '123456789',
        members: {
          fetch: jest.fn().mockResolvedValue({ id: '987654321' })
        }
      };
      mockReaction.message.id = 'message-123';
      mockBaserowService.deleteLink.mockResolvedValue(true);

      // Mock admin check
      jest.spyOn(reactionHandler, 'isUserAdmin').mockResolvedValue(true);

      await reactionHandler.handleDeletionReaction(mockReaction, mockUser);

      expect(mockBaserowService.deleteLink).toHaveBeenCalledWith(
        'message-123',
        '123456789'
      );
    });

    it('should not handle deletion reaction for non-admin user', async () => {
      mockReaction.emoji.name = '❌';
      mockReaction.message.guild = { 
        id: '123456789',
        members: {
          fetch: jest.fn().mockResolvedValue({ id: '987654321' })
        }
      };
      mockReaction.message.author.id = '999999999'; // Different from user.id to ensure not original poster

      // Mock non-admin check
      jest.spyOn(reactionHandler, 'isUserAdmin').mockResolvedValue(false);

      await reactionHandler.handleDeletionReaction(mockReaction, mockUser);

      expect(mockBaserowService.deleteLink).not.toHaveBeenCalled();
    });
  });

  describe('isUserAdmin', () => {
    it('should return true for admin user', async () => {
      const adminUser = { 
        id: '123456789',
        user: { username: 'admin' },
        permissions: {
          has: jest.fn().mockReturnValue(true)
        },
        roles: {
          cache: {
            map: jest.fn().mockReturnValue(['Admin', 'Moderator']),
            some: jest.fn().mockReturnValue(true)
          }
        }
      };
      const result = await reactionHandler.isUserAdmin(adminUser);
      expect(result).toBe(true);
    });

    it('should return false for non-admin user', async () => {
      const regularUser = { 
        id: '987654321',
        user: { username: 'user' },
        permissions: {
          has: jest.fn().mockReturnValue(false)
        },
        roles: {
          cache: {
            map: jest.fn().mockReturnValue(['Member']),
            some: jest.fn().mockReturnValue(false)
          }
        }
      };
      const result = await reactionHandler.isUserAdmin(regularUser);
      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle BaserowService errors gracefully', async () => {
      mockReaction.emoji.name = '✅';
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111';
      mockBaserowService.updateReadStatusFromReaction.mockRejectedValue(new Error('Service error'));

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling reaction:',
        'Service error'
      );
    });

    it('should handle DM reaction errors gracefully', async () => {
      mockReaction.message.guild = null;
      mockReaction.message.id = '123456789';
      mockBaserowService.findDMMapping.mockRejectedValue(new Error('DM error'));

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling reaction:',
        'DM error'
      );
    });
  });
});
