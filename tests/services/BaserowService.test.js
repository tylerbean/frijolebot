const BaserowService = require('../../services/BaserowService');
const { mockBaserowLink, mockBaserowLinks, mockDMMapping, mockConfig } = require('../fixtures/mockData');

// Mock axios
jest.mock('axios');
const axios = require('axios');

describe('BaserowService', () => {
  let baserowService;
  let mockAxios;

  beforeEach(() => {
    mockAxios = axios;
    baserowService = new BaserowService(
      mockConfig.baserow.apiToken,
      mockConfig.baserow.apiUrl
    );
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(baserowService.apiToken).toBe(mockConfig.baserow.apiToken);
      expect(baserowService.apiUrl).toBe(mockConfig.baserow.apiUrl);
      expect(baserowService.headers).toEqual({
        'Authorization': `Token ${mockConfig.baserow.apiToken}`,
        'Content-Type': 'application/json'
      });
    });
  });

  describe('findLinkByMessageId', () => {
    it('should find a link by message ID and guild ID', async () => {
      mockAxios.get.mockResolvedValue({
        data: { results: [mockBaserowLink] }
      });

      const result = await baserowService.findLinkByMessageId('123456789', '123456789');

      expect(result).toEqual(mockBaserowLink);
      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('message_id'),
        expect.objectContaining({
          headers: { 'Authorization': `Token ${mockConfig.baserow.apiToken}` }
        })
      );
    });

    it('should return null when no link is found', async () => {
      mockAxios.get.mockResolvedValue({
        data: { results: [] }
      });

      const result = await baserowService.findLinkByMessageId('nonexistent', '123456789');

      expect(result).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      mockAxios.get.mockRejectedValue(new Error('API Error'));

      const result = await baserowService.findLinkByMessageId('123456789', '123456789');

      expect(result).toBeNull();
    });
  });

  describe('findLinkByMessageIdAllGuilds', () => {
    it('should find a link by message ID across all guilds', async () => {
      mockAxios.get.mockResolvedValue({
        data: { results: [mockBaserowLink] }
      });

      const result = await baserowService.findLinkByMessageIdAllGuilds('123456789');

      expect(result).toEqual(mockBaserowLink);
      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('message_id'),
        expect.objectContaining({
          headers: { 'Authorization': `Token ${mockConfig.baserow.apiToken}` }
        })
      );
    });

    it('should return null when no link is found', async () => {
      mockAxios.get.mockResolvedValue({
        data: { results: [] }
      });

      const result = await baserowService.findLinkByMessageIdAllGuilds('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('storeLink', () => {
    it('should store a new link successfully', async () => {
      const mockResponse = { data: mockBaserowLink };
      mockAxios.post.mockResolvedValue(mockResponse);

      const result = await baserowService.storeLink(
        {
          content: 'Check out this link: https://example.com',
          author: { username: 'testuser', id: '987654321' },
          channel: { id: '111111111', name: 'test-channel' },
          id: '123456789',
          createdAt: new Date('2025-01-15T10:30:00.000Z')
        },
        'https://example.com',
        '123456789'
      );

      expect(result).toEqual(mockBaserowLink);
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('user_field_names=true'),
        expect.objectContaining({
          url: 'https://example.com',
          user: 'testuser',
          guild_id: '123456789',
          read: false
        }),
        expect.objectContaining({
          headers: baserowService.headers
        })
      );
    });

    it('should handle API errors when storing links', async () => {
      mockAxios.post.mockRejectedValue(new Error('API Error'));

      const result = await baserowService.storeLink(
        { content: 'test', author: { username: 'test', id: '123' }, channel: { id: '123', name: 'test' }, id: '123', createdAt: new Date() },
        'https://example.com',
        '123456789'
      );

      expect(result).toBeNull();
    });
  });

  describe('updateReadStatus', () => {
    it('should update read status successfully', async () => {
      mockAxios.patch.mockResolvedValue({ data: { success: true } });

      const result = await baserowService.updateReadStatus('123456789', '123456789', true);

      expect(result).toBe(true);
      expect(mockAxios.patch).toHaveBeenCalledWith(
        expect.stringContaining('123456789'),
        { read: true },
        expect.objectContaining({
          headers: baserowService.headers
        })
      );
    });

    it('should handle API errors when updating read status', async () => {
      mockAxios.patch.mockRejectedValue(new Error('API Error'));

      const result = await baserowService.updateReadStatus('123456789', '123456789', true);

      expect(result).toBe(false);
    });
  });

  describe('getUnreadLinksForUser', () => {
    it('should return unread links for a user', async () => {
      mockAxios.get.mockResolvedValue({
        data: { results: mockBaserowLinks }
      });

      // Mock the Discord client and guild for channel access check
      const mockDiscordClient = {
        guilds: {
          cache: new Map([
            ['123456789', {
              members: {
                fetch: jest.fn().mockResolvedValue({
                  id: '987654321',
                  user: { username: 'testuser' }
                })
              },
              channels: {
                cache: new Map([
                  ['111111111', {
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

      const result = await baserowService.getUnreadLinksForUser(
        'testuser',
        '123456789',
        '987654321',
        mockDiscordClient
      );

      expect(result).toHaveLength(1); // Only one unread link from other user
      expect(result[0].user).not.toBe('testuser');
      expect(result[0].read).toBe(false);
    });

    it('should handle API errors when fetching unread links', async () => {
      mockAxios.get.mockRejectedValue(new Error('API Error'));

      const result = await baserowService.getUnreadLinksForUser(
        'testuser',
        '123456789',
        '987654321',
        {}
      );

      expect(result).toEqual([]);
    });
  });

  describe('createDMMapping', () => {
    it('should create a DM mapping successfully', async () => {
      mockAxios.post.mockResolvedValue({ data: mockDMMapping });

      const result = await baserowService.createDMMapping(
        '1413205772032020500',
        '1️⃣',
        '1413199319758012447',
        '611026701299875853',
        '186917645944094720'
      );

      expect(result).toEqual(mockDMMapping);
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('user_field_names=true'),
        expect.objectContaining({
          dm_message_id: '1413205772032020500',
          emoji: '1️⃣',
          original_message_id: '1413199319758012447',
          guild_id: '611026701299875853',
          user_id: '186917645944094720'
        }),
        expect.objectContaining({
          headers: baserowService.headers
        })
      );
    });

    it('should handle API errors when creating DM mapping', async () => {
      mockAxios.post.mockRejectedValue(new Error('API Error'));

      const result = await baserowService.createDMMapping(
        '1413205772032020500',
        '1️⃣',
        '1413199319758012447',
        '611026701299875853',
        '186917645944094720'
      );

      expect(result).toBeNull();
    });
  });

  describe('findDMMapping', () => {
    it('should find a DM mapping successfully', async () => {
      mockAxios.get.mockResolvedValue({
        data: { results: [mockDMMapping] }
      });

      const result = await baserowService.findDMMapping('1413205772032020500', '1️⃣');

      expect(result).toEqual(mockDMMapping);
    });

    it('should return null when no mapping is found', async () => {
      mockAxios.get.mockResolvedValue({
        data: { results: [] }
      });

      const result = await baserowService.findDMMapping('nonexistent', '1️⃣');

      expect(result).toBeNull();
    });

    it('should handle expired mappings', async () => {
      const expiredMapping = {
        ...mockDMMapping,
        expires_at: new Date(Date.now() - 1000).toISOString() // Expired 1 second ago
      };
      
      mockAxios.get.mockResolvedValue({
        data: { results: [expiredMapping] }
      });
      mockAxios.delete.mockResolvedValue({ data: { success: true } });

      const result = await baserowService.findDMMapping('1413205772032020500', '1️⃣');

      expect(result).toBeNull();
      expect(mockAxios.delete).toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('should test Baserow API connection successfully', async () => {
      mockAxios.get.mockResolvedValue({
        data: { results: [mockBaserowLink] },
        status: 200
      });

      const result = await baserowService.testConnection();

      expect(result).toEqual({
        success: true,
        responseTime: expect.any(Number),
        status: 200,
        dataCount: 1
      });
    });

    it('should handle connection test failures', async () => {
      mockAxios.get.mockRejectedValue(new Error('Connection failed'));

      await expect(baserowService.testConnection()).rejects.toThrow('Baserow API connection failed');
    });
  });
});
