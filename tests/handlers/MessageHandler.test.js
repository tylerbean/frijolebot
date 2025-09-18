// Mock dependencies MUST be declared before requiring the module under test
jest.mock('../../utils/logger');
const Logger = require('../../utils/logger');

const MessageHandler = require('../../handlers/messageHandler');
const { mockDiscordMessage } = require('../fixtures/mockData');
const PostgreSQLService = require('../../services/PostgreSQLService');

describe('MessageHandler', () => {
  let messageHandler;
  let mockPostgresService;
  let mockMessage;

  beforeEach(() => {
    mockPostgresService = {
      storeLink: jest.fn(),
      getFeatureFlagCached: jest.fn().mockResolvedValue(true),
      getActiveMonitoredChannels: jest.fn().mockResolvedValue(['111111111']) // Return the test channel ID
    };

    messageHandler = new MessageHandler(mockPostgresService);
    mockMessage = { ...mockDiscordMessage, react: jest.fn().mockResolvedValue() };
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with PostgreSQLService', () => {
      expect(messageHandler.postgresService).toBe(mockPostgresService);
    });
  });

  describe('handleMessage', () => {
    it('should handle message with URL successfully', async () => {
      mockPostgresService.storeLink.mockResolvedValue({ success: true });

      await messageHandler.handleMessage(mockMessage);

      expect(mockPostgresService.storeLink).toHaveBeenCalledWith(
        mockMessage,
        'https://example.com',
        '123456789'
      );
    });

    it('should handle message with multiple URLs', async () => {
      mockMessage.content = 'Check these links: https://example.com and https://github.com';
      mockPostgresService.storeLink.mockResolvedValue({ success: true });

      await messageHandler.handleMessage(mockMessage);

      expect(mockPostgresService.storeLink).toHaveBeenCalledTimes(2);
      expect(mockPostgresService.storeLink).toHaveBeenCalledWith(
        mockMessage,
        'https://example.com',
        '123456789'
      );
      expect(mockPostgresService.storeLink).toHaveBeenCalledWith(
        mockMessage,
        'https://github.com',
        '123456789'
      );
    });

    it('should handle message without URLs', async () => {
      mockMessage.content = 'This message has no URLs';

      await messageHandler.handleMessage(mockMessage);

      expect(mockPostgresService.storeLink).not.toHaveBeenCalled();
    });

    it('should handle message with invalid URLs', async () => {
      mockMessage.content = 'This has invalid URLs: not-a-url and ftp://invalid';

      await messageHandler.handleMessage(mockMessage);

      expect(mockPostgresService.storeLink).not.toHaveBeenCalled();
    });

    it('should handle various URL formats', async () => {
      mockMessage.content = 'URLs: https://example.com http://test.com https://sub.domain.com/path?query=value#fragment';
      mockPostgresService.storeLink.mockResolvedValue({ success: true });

      await messageHandler.handleMessage(mockMessage);

      expect(mockPostgresService.storeLink).toHaveBeenCalledTimes(3);
    });

    it('should handle BaserowService errors gracefully', async () => {
      mockPostgresService.storeLink.mockRejectedValue(new Error('Storage error'));

      await messageHandler.handleMessage(mockMessage);

      expect(Logger.error).toHaveBeenCalledWith(
        'Error processing message:',
        expect.any(Error)
      );
    });

    it('should handle message without guild', async () => {
      mockMessage.guild = null;

      await messageHandler.handleMessage(mockMessage);

      // When guild is null, accessing message.guild.id will throw an error
      // so storeLink should not be called
      expect(mockPostgresService.storeLink).not.toHaveBeenCalled();
      expect(Logger.error).toHaveBeenCalledWith(
        'Error in link tracking:',
        expect.any(Error)
      );
    });
  });
});
