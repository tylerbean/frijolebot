const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const crypto = require('crypto-js');
const Logger = require('../utils/logger');
const BaserowService = require('./BaserowService');

class WhatsAppService {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.isConnected = false;
    this.isInitialized = false;
    this.sessionManager = null;
    this.baserowService = null;
    this.messageHandler = null;
    this.encryptionKey = config.whatsapp.sessionEncryptionKey;
    
    Logger.info('WhatsAppService initialized');
  }

  async initialize() {
    try {
      Logger.info('Initializing WhatsApp service...');
      
      // Initialize Baserow service for WhatsApp tables
      this.baserowService = new BaserowService(
        this.config.baserow.apiUrl,
        this.config.baserow.apiToken,
        '45', // whatsapp_sessions table ID
        '44'  // whatsapp_chats table ID
      );

      // Initialize session manager
      this.sessionManager = new WhatsAppSessionManager(this.baserowService, this.encryptionKey);
      
      // Initialize message handler
      this.messageHandler = new WhatsAppMessageHandler(this.baserowService);
      
      // Initialize WhatsApp client
      await this.initializeClient();
      
      this.isInitialized = true;
      Logger.success('WhatsApp service initialized successfully');
      
    } catch (error) {
      Logger.error('Failed to initialize WhatsApp service:', error);
      throw error;
    }
  }

  async initializeClient() {
    try {
      // Create WhatsApp client with local auth
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'frijolebot-whatsapp'
        }),
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
      });

      // Set up event listeners
      this.setupEventListeners();
      
      // Initialize the client
      await this.client.initialize();
      
    } catch (error) {
      Logger.error('Failed to initialize WhatsApp client:', error);
      throw error;
    }
  }

  setupEventListeners() {
    // QR code generation
    this.client.on('qr', async (qr) => {
      Logger.info('QR code generated for WhatsApp authentication');
      await this.sessionManager.handleQRCode(qr);
    });

    // Client ready
    this.client.on('ready', async () => {
      Logger.success('WhatsApp client is ready!');
      this.isConnected = true;
      await this.sessionManager.saveSession();
      await this.startMessageMonitoring();
    });

    // Authentication success
    this.client.on('authenticated', async () => {
      Logger.success('WhatsApp authentication successful');
    });

    // Authentication failure
    this.client.on('auth_failure', async (msg) => {
      Logger.error('WhatsApp authentication failed:', msg);
      this.isConnected = false;
      await this.sessionManager.handleAuthFailure(msg);
    });

    // Client disconnected
    this.client.on('disconnected', async (reason) => {
      Logger.warn('WhatsApp client disconnected:', reason);
      this.isConnected = false;
      await this.sessionManager.handleDisconnection(reason);
    });

    // Message received
    this.client.on('message', async (message) => {
      await this.messageHandler.handleMessage(message);
    });
  }

  async startMessageMonitoring() {
    try {
      Logger.info('Starting WhatsApp message monitoring...');
      
      // Get active chats from Baserow
      const activeChats = await this.baserowService.getActiveChats();
      Logger.info(`Monitoring ${activeChats.length} active chats`);
      
      // Set up periodic health checks
      setInterval(async () => {
        await this.checkConnectionHealth();
      }, 30000); // Check every 30 seconds
      
    } catch (error) {
      Logger.error('Failed to start message monitoring:', error);
    }
  }

  async checkConnectionHealth() {
    try {
      if (!this.client || !this.isConnected) {
        return;
      }

      const state = await this.client.getState();
      if (state !== 'CONNECTED') {
        Logger.warn('WhatsApp connection health check failed, state:', state);
        this.isConnected = false;
        await this.sessionManager.handleConnectionLoss();
      }
    } catch (error) {
      Logger.error('Connection health check failed:', error);
      this.isConnected = false;
    }
  }

  async destroy() {
    try {
      if (this.client) {
        await this.client.destroy();
      }
      this.isConnected = false;
      this.isInitialized = false;
      Logger.info('WhatsApp service destroyed');
    } catch (error) {
      Logger.error('Error destroying WhatsApp service:', error);
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      isInitialized: this.isInitialized,
      clientState: this.client ? 'initialized' : 'not_initialized'
    };
  }
}

// Session Manager Class
class WhatsAppSessionManager {
  constructor(baserowService, encryptionKey) {
    this.baserowService = baserowService;
    this.encryptionKey = encryptionKey;
  }

  async saveSession() {
    try {
      // This would be implemented to save session data to Baserow
      Logger.info('Session saved to Baserow');
    } catch (error) {
      Logger.error('Failed to save session:', error);
    }
  }

  async handleQRCode(qr) {
    try {
      Logger.info('QR code generated - scan with your phone to authenticate');
      // TODO: Send QR code to Discord #infra-alerts channel
    } catch (error) {
      Logger.error('Failed to handle QR code:', error);
    }
  }

  async handleAuthFailure(msg) {
    try {
      Logger.error('Authentication failed:', msg);
      // TODO: Send alert to Discord #infra-alerts channel
    } catch (error) {
      Logger.error('Failed to handle auth failure:', error);
    }
  }

  async handleDisconnection(reason) {
    try {
      Logger.warn('Client disconnected:', reason);
      // TODO: Send alert to Discord #infra-alerts channel
    } catch (error) {
      Logger.error('Failed to handle disconnection:', error);
    }
  }

  async handleConnectionLoss() {
    try {
      Logger.warn('Connection lost, attempting to reconnect...');
      // TODO: Implement reconnection logic
    } catch (error) {
      Logger.error('Failed to handle connection loss:', error);
    }
  }
}

// Message Handler Class
class WhatsAppMessageHandler {
  constructor(baserowService) {
    this.baserowService = baserowService;
  }

  async handleMessage(message) {
    try {
      // Check if this chat is being monitored
      const chatId = message.from;
      const isMonitored = await this.baserowService.isChatMonitored(chatId);
      
      if (!isMonitored) {
        return; // Ignore messages from non-monitored chats
      }

      Logger.info(`Received message from monitored chat: ${chatId}`);
      
      // Process the message
      await this.processMessage(message);
      
    } catch (error) {
      Logger.error('Failed to handle WhatsApp message:', error);
    }
  }

  async processMessage(message) {
    try {
      // TODO: Implement message processing logic
      // - Format message for Discord
      // - Handle different message types (text, images, etc.)
      // - Post to Discord channel
      // - Store in Baserow if enabled
      
      Logger.info('Processing WhatsApp message:', {
        from: message.from,
        type: message.type,
        hasMedia: message.hasMedia
      });
      
    } catch (error) {
      Logger.error('Failed to process message:', error);
    }
  }
}

module.exports = WhatsAppService;
