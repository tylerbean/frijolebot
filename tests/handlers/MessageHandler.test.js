const MessageHandler = require('../../handlers/messageHandler');
const { mockDiscordMessage } = require('../fixtures/mockData');

// Mock dependencies
jest.mock('../../services/BaserowService');
jest.mock('../../utils/logger');

const BaserowService = require('../../services/BaserowService');
const Logger = require('../../utils/logger');

describe('MessageHandler', () => {
  let messageHandler;
  let mockBaserowService;
  let mockMessage;

  beforeEach(() => {
    mockBaserowService = {
      storeLink: jest.fn()
    };

    messageHandler = new MessageHandler(mockBaserowService);
    mockMessage = { ...mockDiscordMessage };
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with BaserowService', () => {
      expect(messageHandler.baserowService).toBe(mockBaserowService);
    });
  });

  describe('handleMessage', () => {
    it('should handle message with URL successfully', async () => {
      mockBaserowService.storeLink.mockResolvedValue({ success: true });

      await messageHandler.handleMessage(mockMessage);

      expect(mockBaserowService.storeLink).toHaveBeenCalledWith(
        mockMessage,
        'https://example.com',
        '123456789'
      );
    });

    it('should handle message with multiple URLs', async () => {
      mockMessage.content = 'Check these links: https://example.com and https://github.com';
      mockBaserowService.storeLink.mockResolvedValue({ success: true });

      await messageHandler.handleMessage(mockMessage);

      expect(mockBaserowService.storeLink).toHaveBeenCalledTimes(2);
      expect(mockBaserowService.storeLink).toHaveBeenCalledWith(
        mockMessage,
        'https://example.com',
        '123456789'
      );
      expect(mockBaserowService.storeLink).toHaveBeenCalledWith(
        mockMessage,
        'https://github.com',
        '123456789'
      );
    });

    it('should handle message without URLs', async () => {
      mockMessage.content = 'This message has no URLs';

      await messageHandler.handleMessage(mockMessage);

      expect(mockBaserowService.storeLink).not.toHaveBeenCalled();
    });

    it('should handle message with invalid URLs', async () => {
      mockMessage.content = 'This has invalid URLs: not-a-url and ftp://invalid';

      await messageHandler.handleMessage(mockMessage);

      expect(mockBaserowService.storeLink).not.toHaveBeenCalled();
    });

    it('should handle various URL formats', async () => {
      mockMessage.content = 'URLs: https://example.com http://test.com https://sub.domain.com/path?query=value#fragment';
      mockBaserowService.storeLink.mockResolvedValue({ success: true });

      await messageHandler.handleMessage(mockMessage);

      expect(mockBaserowService.storeLink).toHaveBeenCalledTimes(3);
    });

    it('should handle BaserowService errors gracefully', async () => {
      mockBaserowService.storeLink.mockRejectedValue(new Error('Storage error'));

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
      expect(mockBaserowService.storeLink).not.toHaveBeenCalled();
      expect(Logger.error).toHaveBeenCalledWith(
        'Error processing message:',
        expect.any(Error)
      );
    });
  });
});
