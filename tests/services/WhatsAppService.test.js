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

// Mock qrcode
jest.mock('qrcode', () => ({
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-qr-code'))
}));

// Mock fs and path
jest.mock('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    rmSync: jest.fn()
}));

jest.mock('path', () => ({
    join: jest.fn().mockReturnValue('/mock/path/session-frijolebot-whatsapp')
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

    describe('message handling', () => {
        test('should initialize message handler after initialization', async () => {
            whatsappService = new WhatsAppService(mockConfig);
            
            // Initially null until initialize() is called
            expect(whatsappService.messageHandler).toBeNull();
            
            // After initialization, it should be defined
            await whatsappService.initialize();
            expect(whatsappService.messageHandler).toBeDefined();
        });

        test('should initialize session manager after initialization', async () => {
            whatsappService = new WhatsAppService(mockConfig);
            
            // Initially null until initialize() is called
            expect(whatsappService.sessionManager).toBeNull();
            
            // After initialization, it should be defined
            await whatsappService.initialize();
            expect(whatsappService.sessionManager).toBeDefined();
        });
    });

    describe('session management', () => {
        test('should initialize session manager with correct properties after initialization', async () => {
            whatsappService = new WhatsAppService(mockConfig);
            
            // Initially null
            expect(whatsappService.sessionManager).toBeNull();
            
            // After initialization
            await whatsappService.initialize();
            expect(whatsappService.sessionManager).toBeDefined();
            expect(whatsappService.sessionManager).toHaveProperty('currentSessionId');
            expect(whatsappService.sessionManager).toHaveProperty('hasExistingSession');
            expect(whatsappService.sessionManager).toHaveProperty('sessionRestoreTimeout');
            expect(whatsappService.sessionManager).toHaveProperty('qrCodeSent');
        });

        test('should have session manager methods after initialization', async () => {
            whatsappService = new WhatsAppService(mockConfig);
            
            // Initially null
            expect(whatsappService.sessionManager).toBeNull();
            
            // After initialization
            await whatsappService.initialize();
            expect(typeof whatsappService.sessionManager.hasLocalSession).toBe('function');
            expect(typeof whatsappService.sessionManager.getActiveSession).toBe('function');
            expect(typeof whatsappService.sessionManager.saveSession).toBe('function');
            expect(typeof whatsappService.sessionManager.updateSessionStatus).toBe('function');
        });
    });

    describe('QR code handling', () => {
        test('should have QR code handling methods after initialization', async () => {
            whatsappService = new WhatsAppService(mockConfig);
            
            // Initially null
            expect(whatsappService.sessionManager).toBeNull();
            
            // After initialization
            await whatsappService.initialize();
            expect(whatsappService.sessionManager).toHaveProperty('sendQRCodeToDiscord');
            expect(whatsappService.sessionManager).toHaveProperty('cancelSessionRestoreTimeout');
            expect(typeof whatsappService.sessionManager.sendQRCodeToDiscord).toBe('function');
            expect(typeof whatsappService.sessionManager.cancelSessionRestoreTimeout).toBe('function');
        });
    });
});
