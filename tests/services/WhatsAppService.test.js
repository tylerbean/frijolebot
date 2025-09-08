const WhatsAppService = require('../../services/WhatsAppService');
const Logger = require('../../utils/logger');

// Mock the whatsapp-web.js module
jest.mock('whatsapp-web.js', () => ({
    Client: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(),
        on: jest.fn(),
        getState: jest.fn().mockResolvedValue('CONNECTED'),
        destroy: jest.fn().mockResolvedValue()
    })),
    LocalAuth: jest.fn().mockImplementation(() => ({})),
    MessageMedia: jest.fn()
}));

// Mock crypto-js
jest.mock('crypto-js', () => ({
    AES: {
        encrypt: jest.fn().mockReturnValue('encrypted_data'),
        decrypt: jest.fn().mockReturnValue('decrypted_data')
    }
}));

// Mock BaserowService
jest.mock('../../services/BaserowService', () => {
    return jest.fn().mockImplementation(() => ({
        getActiveChats: jest.fn().mockResolvedValue([]),
        isChatMonitored: jest.fn().mockResolvedValue(false),
        getDiscordChannelForChat: jest.fn().mockResolvedValue(null),
        storeWhatsAppMessage: jest.fn().mockResolvedValue({}),
        saveWhatsAppSession: jest.fn().mockResolvedValue({}),
        updateWhatsAppSessionStatus: jest.fn().mockResolvedValue(true),
        getActiveWhatsAppSession: jest.fn().mockResolvedValue(null)
    }));
});

describe('WhatsAppService', () => {
    let whatsappService;
    let mockConfig;

    beforeEach(() => {
        mockConfig = {
            baserow: {
                apiUrl: 'https://api.baserow.frijole.lol/api/database/rows/table/',
                apiToken: 'test-token',
                whatsappSessionsTableId: '45',
                whatsappChatsTableId: '44',
                whatsappMessagesTableId: '46'
            },
            whatsapp: {
                sessionEncryptionKey: 'test-encryption-key-32-characters',
                storeMessages: false,
                enabled: true
            }
        };

        // Clear all mocks
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (whatsappService) {
            whatsappService.destroy();
        }
    });

    describe('constructor', () => {
        test('should initialize with provided encryption key', () => {
            whatsappService = new WhatsAppService(mockConfig);
            
            expect(whatsappService.config).toBe(mockConfig);
            expect(whatsappService.client).toBeNull();
            expect(whatsappService.isConnected).toBe(false);
            expect(whatsappService.isInitialized).toBe(false);
            expect(whatsappService.encryptionKey).toBe('test-encryption-key-32-characters');
        });

        test('should initialize with custom encryption key from config', () => {
            const customConfig = {
                ...mockConfig,
                whatsapp: {
                    ...mockConfig.whatsapp,
                    sessionEncryptionKey: 'custom-encryption-key'
                }
            };
            
            whatsappService = new WhatsAppService(customConfig);
            
            expect(whatsappService.encryptionKey).toBe('custom-encryption-key');
        });
    });

    describe('getConnectionStatus', () => {
        test('should return connection status when not initialized', () => {
            whatsappService = new WhatsAppService(mockConfig);
            
            const status = whatsappService.getConnectionStatus();
            
            expect(status).toEqual({
                isConnected: false,
                isInitialized: false,
                clientState: 'not_initialized'
            });
        });

        test('should return connection status when initialized but not connected', () => {
            whatsappService = new WhatsAppService(mockConfig);
            whatsappService.isInitialized = true;
            whatsappService.client = {
                getState: jest.fn().mockResolvedValue('DISCONNECTED')
            };
            
            const status = whatsappService.getConnectionStatus();
            
            expect(status).toEqual({
                isConnected: false,
                isInitialized: true,
                clientState: 'initialized'
            });
        });
    });

    describe('destroy', () => {
        test('should destroy service cleanly', async () => {
            whatsappService = new WhatsAppService(mockConfig);
            whatsappService.client = {
                destroy: jest.fn().mockResolvedValue()
            };
            whatsappService.isConnected = true;
            whatsappService.isInitialized = true;
            
            await whatsappService.destroy();
            
            expect(whatsappService.isConnected).toBe(false);
            expect(whatsappService.isInitialized).toBe(false);
            expect(whatsappService.client.destroy).toHaveBeenCalled();
        });

        test('should handle destroy when client is null', async () => {
            whatsappService = new WhatsAppService(mockConfig);
            whatsappService.client = null;
            
            await expect(whatsappService.destroy()).resolves.not.toThrow();
        });
    });
});
