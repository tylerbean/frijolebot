const WhatsAppService = require('../../services/WhatsAppService');
const Logger = require('../../utils/logger');

// Mock the @whiskeysockets/baileys module
jest.mock('@whiskeysockets/baileys', () => ({
    default: jest.fn().mockImplementation(() => ({
        ev: {
            on: jest.fn()
        },
        user: { id: 'test-user' },
        logout: jest.fn().mockResolvedValue()
    })),
    DisconnectReason: {
        loggedOut: 515
    },
    useMultiFileAuthState: jest.fn().mockResolvedValue({
        state: { creds: { me: { id: 'test-user' } } },
        saveCreds: jest.fn()
    }),
    downloadContentFromMessage: jest.fn().mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('mock-media-data');
        }
    })
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
    join: jest.fn().mockReturnValue('/mock/path/auth_info_baileys')
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
            expect(whatsappService.sock).toBeNull();
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
            whatsappService.sock = {
                user: { id: 'test-user' }
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
            whatsappService.sock = {
                logout: jest.fn().mockResolvedValue()
            };
            whatsappService.isConnected = true;
            whatsappService.isInitialized = true;
            
            await whatsappService.destroy();
            
            expect(whatsappService.isConnected).toBe(false);
            expect(whatsappService.isInitialized).toBe(false);
            expect(whatsappService.sock.logout).toHaveBeenCalled();
        });

        test('should handle destroy when sock is null', async () => {
            whatsappService = new WhatsAppService(mockConfig);
            whatsappService.sock = null;
            
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
