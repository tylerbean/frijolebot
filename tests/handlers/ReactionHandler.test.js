const ReactionHandler = require('../../handlers/reactionHandler');
const { mockConfig, mockDiscordReaction, mockDMMapping, mockBaserowLink } = require('../fixtures/mockData');

// Mock dependencies
jest.mock('../../utils/logger');

const PostgreSQLService = require('../../services/PostgreSQLService');
const Logger = require('../../utils/logger');

describe('ReactionHandler', () => {
  let reactionHandler;
  let mockPostgresService;
  let mockReaction;
  let mockUser;

  beforeEach(() => {
    mockPostgresService = {
      findDMMapping: jest.fn(),
      updateReadStatus: jest.fn(),
      updateReadStatusFromReaction: jest.fn(),
      deleteLink: jest.fn(),
      findLinkByMessageIdAllGuilds: jest.fn()
    };

    reactionHandler = new ReactionHandler(mockPostgresService, mockConfig);
    mockReaction = { ...mockDiscordReaction };
    mockUser = { id: '987654321', username: 'testuser' };
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with PostgreSQLService and config', () => {
      expect(reactionHandler.postgresService).toBe(mockPostgresService);
      expect(reactionHandler.config).toBe(mockConfig);
    });
  });

  describe('handleReactionAdd', () => {
    it('should handle reaction add in server channel', async () => {
      mockReaction.emoji.name = '✅';
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111'; // This channel is in the monitored channels
      mockPostgresService.updateReadStatusFromReaction.mockResolvedValue(true);

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(mockPostgresService.updateReadStatusFromReaction).toHaveBeenCalledWith(
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
      mockPostgresService.findDMMapping.mockResolvedValue(mockDMMapping);
      mockPostgresService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(mockPostgresService.findDMMapping).toHaveBeenCalledWith(
        '123456789',
        '1️⃣'
      );
      expect(mockPostgresService.updateReadStatus).toHaveBeenCalledWith(
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

      expect(mockPostgresService.updateReadStatusFromReaction).not.toHaveBeenCalled();
    });
  });

  describe('handleReactionRemove', () => {
    it('should handle reaction remove in server channel', async () => {
      mockReaction.emoji.name = '✅';
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111'; // This channel is in the monitored channels
      mockPostgresService.updateReadStatusFromReaction.mockResolvedValue(true);

      await reactionHandler.handleReactionRemove(mockReaction, mockUser);

      expect(mockPostgresService.updateReadStatusFromReaction).toHaveBeenCalledWith(
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
      mockPostgresService.findDMMapping.mockResolvedValue(mockDMMapping);
      mockPostgresService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleReactionRemove(mockReaction, mockUser);

      expect(mockPostgresService.findDMMapping).toHaveBeenCalledWith(
        '123456789',
        '1️⃣'
      );
      expect(mockPostgresService.updateReadStatus).toHaveBeenCalledWith(
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
      mockPostgresService.findDMMapping.mockResolvedValue(mockDMMapping);
      mockPostgresService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleDMReaction(mockReaction, mockUser);

      expect(mockPostgresService.updateReadStatus).toHaveBeenCalledWith(
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
      mockPostgresService.findDMMapping.mockResolvedValue(bulkMapping);
      mockPostgresService.findLinkByMessageIdAllGuilds.mockResolvedValue(mockBaserowLink);
      mockPostgresService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleDMReaction(mockReaction, mockUser);

      expect(mockPostgresService.findLinkByMessageIdAllGuilds).toHaveBeenCalledTimes(2);
      expect(mockPostgresService.updateReadStatus).toHaveBeenCalledTimes(2);
    });

    it('should handle missing DM mapping', async () => {
      mockPostgresService.findDMMapping.mockResolvedValue(null);

      await reactionHandler.handleDMReaction(mockReaction, mockUser);

      expect(mockPostgresService.updateReadStatus).not.toHaveBeenCalled();
    });
  });

  describe('handleDMReactionRemove', () => {
    it('should handle individual DM reaction removal', async () => {
      mockReaction.emoji.name = '1️⃣';
      mockPostgresService.findDMMapping.mockResolvedValue(mockDMMapping);
      mockPostgresService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleDMReactionRemove(mockReaction, mockUser);

      expect(mockPostgresService.updateReadStatus).toHaveBeenCalledWith(
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
      mockPostgresService.findDMMapping.mockResolvedValue(bulkMapping);
      mockPostgresService.findLinkByMessageIdAllGuilds.mockResolvedValue(mockBaserowLink);
      mockPostgresService.updateReadStatus.mockResolvedValue(true);

      await reactionHandler.handleDMReactionRemove(mockReaction, mockUser);

      expect(mockPostgresService.findLinkByMessageIdAllGuilds).toHaveBeenCalledTimes(2);
      expect(mockPostgresService.updateReadStatus).toHaveBeenCalledTimes(2);
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
      mockPostgresService.deleteLink.mockResolvedValue(true);

      // Mock admin check
      jest.spyOn(reactionHandler, 'isUserAdmin').mockResolvedValue(true);

      await reactionHandler.handleDeletionReaction(mockReaction, mockUser);

      expect(mockPostgresService.deleteLink).toHaveBeenCalledWith(
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

      expect(mockPostgresService.deleteLink).not.toHaveBeenCalled();
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
    it('should handle service errors gracefully', async () => {
      mockReaction.emoji.name = '✅';
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111';
      mockPostgresService.updateReadStatusFromReaction.mockRejectedValue(new Error('Service error'));

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling reaction:',
        'Service error'
      );
    });

    it('should handle DM reaction errors gracefully', async () => {
      mockReaction.message.guild = null;
      mockReaction.message.id = '123456789';
      mockPostgresService.findDMMapping.mockRejectedValue(new Error('DM error'));

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling reaction:',
        'DM error'
      );
    });

    it('should handle reaction remove errors gracefully', async () => {
      mockReaction.emoji.name = '✅';
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111';
      mockPostgresService.updateReadStatusFromReaction.mockRejectedValue(new Error('Remove error'));

      await reactionHandler.handleReactionRemove(mockReaction, mockUser);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling reaction removal:',
        'Remove error'
      );
    });

    it('should handle DM reaction remove errors gracefully', async () => {
      mockReaction.message.guild = null;
      mockReaction.message.id = '123456789';
      mockPostgresService.findDMMapping.mockRejectedValue(new Error('DM remove error'));

      await reactionHandler.handleReactionRemove(mockReaction, mockUser);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error handling reaction removal:',
        'DM remove error'
      );
    });

    it('should handle deletion reaction errors gracefully', async () => {
      mockReaction.emoji.name = '🗑️';
      const mockMember = {
        id: '987654321',
        user: { username: 'testuser' },
        permissions: {
          has: jest.fn().mockReturnValue(true) // Make user admin
        },
        roles: {
          cache: {
            map: jest.fn().mockReturnValue(['Admin']),
            some: jest.fn().mockReturnValue(true)
          }
        }
      };
      mockReaction.message.guild = { 
        id: '123456789',
        members: {
          fetch: jest.fn().mockResolvedValue(mockMember)
        }
      };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111';
      mockReaction.message.delete = jest.fn().mockRejectedValue(new Error('Delete error'));
      mockPostgresService.deleteLink.mockResolvedValue(true);

      await reactionHandler.handleDeletionReaction(mockReaction, mockUser);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error deleting message: Delete error'
      );
    });

    it('should handle DM deletion reaction by skipping (no guild)', async () => {
      mockReaction.emoji.name = '🗑️';
      mockReaction.message.guild = null;
      mockReaction.message.id = '123456789';

      // DM deletion reactions should be skipped since there's no guild
      await expect(reactionHandler.handleDeletionReaction(mockReaction, mockUser)).rejects.toThrow();
    });
  });

  describe('additional edge cases', () => {
    it('should handle reaction with no emoji name', async () => {
      mockReaction.emoji.name = null;
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111';

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);
      expect(mockPostgresService.updateReadStatusFromReaction).not.toHaveBeenCalled();
    });

    it('should handle reaction with undefined emoji name', async () => {
      mockReaction.emoji.name = undefined;
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111';

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);
      expect(mockPostgresService.updateReadStatusFromReaction).not.toHaveBeenCalled();
    });

    it('should handle reaction with empty emoji name', async () => {
      mockReaction.emoji.name = '';
      mockReaction.message.guild = { id: '123456789' };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111';

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);
      expect(mockPostgresService.updateReadStatusFromReaction).not.toHaveBeenCalled();
    });

    it('should handle reaction with no message guild and no DM mapping', async () => {
      mockReaction.emoji.name = '✅';
      mockReaction.message.guild = null;
      mockReaction.message.id = '123456789';
      mockPostgresService.findDMMapping.mockResolvedValue(null);

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);
      expect(mockPostgresService.updateReadStatusFromReaction).not.toHaveBeenCalled();
    });

    it('should handle reaction with no message guild and expired DM mapping', async () => {
      mockReaction.emoji.name = '✅';
      mockReaction.message.guild = null;
      mockReaction.message.id = '123456789';
      const expiredMapping = {
        ...mockDMMapping,
        expires_at: new Date(Date.now() - 1000).toISOString() // Expired 1 second ago
      };
      mockPostgresService.findDMMapping.mockResolvedValue(expiredMapping);

      await reactionHandler.handleReactionAdd(mockReaction, mockUser);
      expect(mockPostgresService.updateReadStatusFromReaction).not.toHaveBeenCalled();
    });

    it('should handle deletion reaction with no link found', async () => {
      mockReaction.emoji.name = '🗑️';
      mockReaction.message.guild = { 
        id: '123456789',
        members: {
          fetch: jest.fn().mockResolvedValue(mockUser)
        }
      };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111';
      mockPostgresService.findLinkByMessageIdAllGuilds.mockResolvedValue(null);

      await reactionHandler.handleDeletionReaction(mockReaction, mockUser);
      expect(mockPostgresService.deleteLink).not.toHaveBeenCalled();
    });

    it('should handle deletion reaction with deleteLink error', async () => {
      mockReaction.emoji.name = '🗑️';
      mockReaction.message.guild = { 
        id: '123456789',
        members: {
          fetch: jest.fn().mockResolvedValue(mockUser)
        }
      };
      mockReaction.message.id = '123456789';
      mockReaction.message.channel.id = '111111111';
      mockPostgresService.findLinkByMessageIdAllGuilds.mockResolvedValue(mockBaserowLink);
      mockPostgresService.deleteLink.mockRejectedValue(new Error('Delete failed'));

      await expect(reactionHandler.handleDeletionReaction(mockReaction, mockUser)).resolves.not.toThrow();
      expect(Logger.error).toHaveBeenCalled();
    });

    it('should handle DM deletion reaction with no link found by skipping (no guild)', async () => {
      mockReaction.emoji.name = '🗑️';
      mockReaction.message.guild = null;
      mockReaction.message.id = '123456789';
      mockPostgresService.findDMMapping.mockResolvedValue(mockDMMapping);
      mockPostgresService.findLinkByMessageIdAllGuilds.mockResolvedValue(null);

      // DM deletion reactions should be skipped since there's no guild
      await expect(reactionHandler.handleDeletionReaction(mockReaction, mockUser)).rejects.toThrow();
    });
  });
});
