const WhatsAppService = require('../../services/WhatsAppService');
const PostgreSQLService = require('../../services/PostgreSQLService');
const Logger = require('../../utils/logger');

// Mock external dependencies
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

jest.mock('crypto-js', () => ({
    AES: {
        encrypt: jest.fn().mockReturnValue('encrypted_data'),
        decrypt: jest.fn().mockReturnValue('decrypted_data')
    }
}));

jest.mock('qrcode', () => ({
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-qr-code'))
}));

jest.mock('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    rmSync: jest.fn()
}));

jest.mock('path', () => ({
    join: jest.fn().mockReturnValue('/mock/path/session-frijolebot-whatsapp')
}));

describe('WhatsApp Integration Tests', () => {
    let whatsappService;
    let mockDiscordClient;
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
                storeMessages: true,
                enabled: true
            },
            discord: {
                guildId: '611026701299875853',
                adminChannelId: '1414626380578029588'
            }
        };

        mockDiscordClient = {
            channels: {
                cache: {
                    get: jest.fn().mockReturnValue({
                        send: jest.fn().mockResolvedValue({ id: 'discord-message-id' })
                    })
                }
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

    describe('Service Initialization', () => {
        test('should initialize WhatsApp service with correct configuration', () => {
            whatsappService = new WhatsAppService(mockConfig, mockDiscordClient);
            
            expect(whatsappService.config).toEqual(mockConfig);
            expect(whatsappService.discordClient).toBe(mockDiscordClient);
            expect(whatsappService.isConnected).toBe(false);
            expect(whatsappService.isInitialized).toBe(false);
        });

        test('should initialize message handler and session manager', () => {
            whatsappService = new WhatsAppService(mockConfig, mockDiscordClient);
            
            expect(whatsappService.messageHandler).toBeDefined();
            expect(whatsappService.sessionManager).toBeDefined();
            // No baserowService anymore
        });
    });

    describe('Configuration Validation', () => {
        test('should validate WhatsApp configuration', () => {
            whatsappService = new WhatsAppService(mockConfig, mockDiscordClient);
            
            expect(whatsappService.config.whatsapp.enabled).toBe(true);
            expect(whatsappService.config.whatsapp.sessionEncryptionKey).toBe('test-encryption-key-32-characters');
            expect(whatsappService.config.whatsapp.storeMessages).toBe(true);
        });

        test('should validate Discord configuration', () => {
            whatsappService = new WhatsAppService(mockConfig, mockDiscordClient);
            
            expect(whatsappService.config.discord.guildId).toBe('611026701299875853');
            expect(whatsappService.config.discord.adminChannelId).toBe('1414626380578029588');
        });

        test('should validate Baserow configuration', () => {
            whatsappService = new WhatsAppService(mockConfig, mockDiscordClient);
            
            expect(whatsappService.config.baserow.whatsappSessionsTableId).toBe('45');
            expect(whatsappService.config.baserow.whatsappChatsTableId).toBe('44');
            expect(whatsappService.config.baserow.whatsappMessagesTableId).toBe('46');
        });
    });
});
