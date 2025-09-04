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
      mockReaction.message.guild = { id: '123456789' };
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
      mockReaction.message.guild = { id: '123456789' };
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
      mockReaction.emoji.name = '🗑️';
      mockReaction.message.guild = { id: '123456789' };
      mockBaserowService.deleteLink.mockResolvedValue(true);

      // Mock admin check
      jest.spyOn(reactionHandler, 'isUserAdmin').mockReturnValue(true);

      await reactionHandler.handleDeletionReaction(mockReaction, mockUser);

      expect(mockBaserowService.deleteLink).toHaveBeenCalledWith(
        '123456789',
        '123456789'
      );
    });

    it('should not handle deletion reaction for non-admin user', async () => {
      mockReaction.emoji.name = '🗑️';
      mockReaction.message.guild = { id: '123456789' };

      // Mock non-admin check
      jest.spyOn(reactionHandler, 'isUserAdmin').mockReturnValue(false);

      await reactionHandler.handleDeletionReaction(mockReaction, mockUser);

      expect(mockBaserowService.deleteLink).not.toHaveBeenCalled();
    });
  });

  describe('isUserAdmin', () => {
    it('should return true for admin user', () => {
      const adminUser = { id: '123456789' };
      const result = reactionHandler.isUserAdmin(adminUser);
      expect(result).toBe(true);
    });

    it('should return false for non-admin user', () => {
      const regularUser = { id: '987654321' };
      const result = reactionHandler.isUserAdmin(regularUser);
      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle BaserowService errors gracefully', async () => {
      mockBaserowService.updateReadStatusFromReaction.mockRejectedValue(new Error('Service error'));

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling reaction:',
        expect.any(Error)
      );
    });

    it('should handle DM reaction errors gracefully', async () => {
      mockReaction.message.guild = null;
      mockBaserowService.findDMMapping.mockRejectedValue(new Error('DM error'));

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling DM reaction:',
        expect.any(Error)
      );
    });
  });
});
