const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const crypto = require('crypto-js');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const Logger = require('../utils/logger');
const BaserowService = require('./BaserowService');

class WhatsAppService {
  constructor(config, discordClient = null) {
    this.config = config;
    this.discordClient = discordClient;
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
        this.config.baserow.apiToken,
        this.config.baserow.apiUrl,
        this.config.baserow.linksTableId,
        this.config.baserow.dmMappingTableId,
        this.config.baserow.whatsappSessionsTableId,
        this.config.baserow.whatsappChatsTableId,
        this.config.baserow.whatsappMessagesTableId
      );

      // Initialize session manager
      this.sessionManager = new WhatsAppSessionManager(this.baserowService, this.encryptionKey, this.discordClient, this.config);
      
      // Initialize message handler
      this.messageHandler = new WhatsAppMessageHandler(this.baserowService, this.discordClient, this.config);
      
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
      // Check if we have local session files
      const hasLocalSession = await this.sessionManager.hasLocalSession();
      Logger.info(`Local session check result: ${hasLocalSession}`);
      
      // Check if we have a valid Baserow session
      const baserowSession = await this.sessionManager.getActiveSession();
      Logger.info(`Baserow session check result: ${baserowSession ? 'found' : 'not found'}`);
      
      if (hasLocalSession && baserowSession) {
        Logger.info('Found existing local and Baserow WhatsApp session, attempting to restore...');
        // Set the current session ID to the existing Baserow session
        this.sessionManager.currentSessionId = baserowSession.session_id;
      } else if (hasLocalSession && !baserowSession) {
        Logger.info('Found local session but no valid Baserow session, will create new session record');
      } else if (!hasLocalSession && baserowSession) {
        Logger.warning('Found Baserow session but no local session - local files required for restoration');
        Logger.info('Clearing orphaned Baserow session and requiring fresh authentication');
        // Clear the orphaned Baserow session since we can't restore without local files
        await this.sessionManager.updateSessionStatus('expired');
        this.sessionManager.currentSessionId = null;
      } else {
        Logger.info('No existing sessions found, will require QR code authentication');
      }

        // Create WhatsApp client with local auth
        this.client = new Client({
          authStrategy: new LocalAuth({
            clientId: 'frijolebot-whatsapp'
          }),
          puppeteer: {
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--disable-gpu',
              '--disable-web-security',
              '--disable-features=VizDisplayCompositor',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              '--disable-extensions',
              '--disable-plugins',
              '--disable-default-apps',
              '--disable-sync',
              '--disable-translate',
              '--hide-scrollbars',
              '--mute-audio',
              '--no-default-browser-check',
              '--no-pings',
              '--disable-logging',
              '--disable-permissions-api',
              '--disable-presentation-api',
              '--disable-print-preview',
              '--disable-speech-api',
              '--disable-file-system',
              '--disable-notifications',
              '--disable-geolocation',
              '--disable-media-session-api',
              '--disable-background-networking',
              '--disable-component-extensions-with-background-pages',
              '--disable-client-side-phishing-detection',
              '--disable-hang-monitor',
              '--disable-ipc-flooding-protection',
              '--disable-popup-blocking',
              '--disable-prompt-on-repost',
              '--disable-domain-reliability',
              '--disable-features=TranslateUI,BlinkGenPropertyTrees',
              '--aggressive-cache-discard',
              '--memory-pressure-off'
            ],
            timeout: 30000,
            protocolTimeout: 30000,
            navigationTimeout: 30000
          }
        });

      // Set up event listeners
      this.setupEventListeners();
      
      // Initialize the client with retry logic
      // Note: whatsapp-web.js will always generate QR codes during initialize(),
      // even with valid sessions. This is normal behavior.
      Logger.info('Initializing WhatsApp client...');
      
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          const initPromise = this.client.initialize();
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('WhatsApp client initialization timeout after 30 seconds')), 30000);
          });
          
          await Promise.race([initPromise, timeoutPromise]);
          Logger.info('WhatsApp client initialization completed');
          break; // Success, exit retry loop
          
        } catch (error) {
          retryCount++;
          Logger.warning(`WhatsApp client initialization attempt ${retryCount} failed:`, error.message);
          
          if (retryCount >= maxRetries) {
            Logger.error('WhatsApp client initialization failed after all retry attempts');
            throw error;
          }
          
          Logger.info(`Retrying WhatsApp client initialization in 5 seconds... (${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
    } catch (error) {
      Logger.error('Failed to initialize WhatsApp client:', error);
      throw error;
    }
  }

  setupEventListeners() {
    Logger.info('Setting up WhatsApp client event listeners...');
    
    // QR code generation
    this.client.on('qr', async (qr) => {
      Logger.info('QR code generated for WhatsApp authentication');
      await this.sessionManager.handleQRCode(qr);
    });

    // Client ready
    this.client.on('ready', async () => {
      Logger.success('WhatsApp client is ready!');
      this.isConnected = true;
      this.sessionManager.cancelSessionRestoreTimeout();
      await this.sessionManager.saveSession();
      await this.sessionManager.updateSessionStatus('active');
      await this.startMessageMonitoring();
    });

    // Authentication success
    this.client.on('authenticated', async () => {
      Logger.success('WhatsApp authentication successful');
      this.sessionManager.cancelSessionRestoreTimeout();
      await this.sessionManager.updateSessionStatus('authenticated');
    });

    // Authentication failure
    this.client.on('auth_failure', async (msg) => {
      Logger.error('WhatsApp authentication failed:', msg);
      this.isConnected = false;
      await this.sessionManager.updateSessionStatus('failed');
      await this.sessionManager.handleAuthFailure(msg);
    });

    // Client disconnected
    this.client.on('disconnected', async (reason) => {
      Logger.warning('WhatsApp client disconnected:', reason);
      this.isConnected = false;
      await this.sessionManager.updateSessionStatus('disconnected');
      await this.sessionManager.handleDisconnection(reason);
    });

    // Message received from others
    this.client.on('message', async (message) => {
      await this.messageHandler.handleMessage(message);
    });

    // Message created by this account (including messages sent by us)
    this.client.on('message_create', async (message) => {
      if (message.fromMe) {
        Logger.info('Message sent by this account detected');
        await this.messageHandler.handleMessage(message);
      }
    });

    // Add more event listeners for debugging
    this.client.on('loading_screen', (percent, message) => {
      Logger.info(`WhatsApp loading: ${percent}% - ${message}`);
    });

    this.client.on('change_state', (state) => {
      Logger.info(`WhatsApp state changed to: ${state}`);
    });

    Logger.info('WhatsApp client event listeners set up successfully');
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
        Logger.warning('WhatsApp connection health check failed, state:', state);
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

  async clearSession() {
    try {
      Logger.info('Clearing WhatsApp session...');
      await this.sessionManager.clearLocalSession();
      await this.sessionManager.updateSessionStatus('cleared');
      Logger.success('WhatsApp session cleared');
    } catch (error) {
      Logger.error('Failed to clear WhatsApp session:', error);
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
  constructor(baserowService, encryptionKey, discordClient, config) {
    this.baserowService = baserowService;
    this.encryptionKey = encryptionKey;
    this.discordClient = discordClient;
    this.config = config;
    this.currentSessionId = null;
    this.hasExistingSession = false;
    this.sessionRestoreTimeout = null;
    this.qrCodeSent = false;
  }

  async getActiveSession() {
    try {
      const session = await this.baserowService.getActiveWhatsAppSession();
      if (session) {
        Logger.debug('Found active session in Baserow');
        // Set the current session ID to the found session
        this.currentSessionId = session.session_id;
        return session;
      }
      return null;
    } catch (error) {
      Logger.error('Failed to get active session:', error);
      return null;
    }
  }

  async hasLocalSession() {
    try {
      const sessionPath = path.join(process.cwd(), '.wwebjs_auth', 'session-frijolebot-whatsapp');
      const exists = fs.existsSync(sessionPath);
      Logger.info(`Checking local session at: ${sessionPath}`);
      Logger.info(`Local session exists: ${exists}`);
      this.hasExistingSession = exists;
      return exists;
    } catch (error) {
      Logger.error('Failed to check local session:', error);
      return false;
    }
  }

  async saveSession() {
    try {
      // Check if we already have a current session ID
      if (!this.currentSessionId) {
        // Generate a unique session ID for new sessions
        this.currentSessionId = `frijolebot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        Logger.info(`Creating new session: ${this.currentSessionId}`);
      } else {
        Logger.info(`Updating existing session: ${this.currentSessionId}`);
      }
      
      // Get session data from the client (this would need to be implemented)
      // For now, just mark that we have an active session
      // Note: session_data field in Baserow expects a string, not an object
      const sessionData = JSON.stringify({
        status: 'active',
        last_activity: new Date().toISOString(),
        device_info: 'frijolebot-whatsapp',
        client_ready: true
      });
      
      await this.baserowService.saveWhatsAppSession(this.currentSessionId, sessionData, 'active', 'frijolebot-whatsapp');
      Logger.info(`Session saved to Baserow: ${this.currentSessionId}`);
    } catch (error) {
      Logger.error('Failed to save session:', error);
    }
  }

  async updateSessionStatus(status) {
    try {
      if (this.currentSessionId) {
        await this.baserowService.updateWhatsAppSessionStatus(this.currentSessionId, status);
        Logger.info(`Session status updated to: ${status}`);
      } else {
        Logger.warning('No current session ID available for status update');
      }
    } catch (error) {
      Logger.error('Failed to update session status:', error);
    }
  }

  async handleQRCode(qr) {
    try {
      Logger.info('QR code generated - scan with your phone to authenticate');
      Logger.debug('QR code data type:', typeof qr);
      Logger.debug('QR code length:', qr ? qr.length : 'null');
      Logger.debug('QR code first 100 chars:', qr ? qr.substring(0, 100) : 'null');
      Logger.debug('QR code last 100 chars:', qr ? qr.substring(qr.length - 100) : 'null');
      
      // If we have an existing session, wait a bit to see if it restores successfully
      if (this.hasExistingSession && !this.qrCodeSent) {
        Logger.info('QR code generated but waiting to see if existing session restores...');
        
        // Set a timeout to send QR code if session doesn't restore within 10 seconds
        this.sessionRestoreTimeout = setTimeout(async () => {
          if (!this.qrCodeSent) {
            Logger.warning('Session restoration timeout - sending QR code to Discord');
            await this.sendQRCodeToDiscord(qr);
          }
        }, 10000); // 10 second timeout
        
        return;
      }
      
      // Send QR code to Discord if we don't have an existing session or if we've already sent one
      if (this.discordClient && this.config.discord.adminChannelId) {
        await this.sendQRCodeToDiscord(qr);
      } else {
        Logger.warning('Discord client or admin channel not configured, QR code not sent to Discord');
      }
      
    } catch (error) {
      Logger.error('Failed to handle QR code:', error);
    }
  }

  async sendQRCodeToDiscord(qr) {
    try {
      const adminChannel = this.discordClient.channels.cache.get(this.config.discord.adminChannelId);
      if (adminChannel) {
        // Check if the QR code is already base64 image data
        if (qr.startsWith('data:image/') || qr.startsWith('iVBORw0KGgo')) {
          // It's already base64 image data
          let qrData = qr;
          if (qrData.startsWith('data:image/png;base64,')) {
            qrData = qrData.replace('data:image/png;base64,', '');
          }
          
          const qrBuffer = Buffer.from(qrData, 'base64');
          Logger.debug('Using existing base64 QR buffer size:', qrBuffer.length);
          
          await adminChannel.send({
            content: '🔐 **WhatsApp Authentication Required**\n\nScan this QR code with your phone to connect WhatsApp:\n\n**Instructions:**\n1. Open WhatsApp on your phone\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Scan this QR code',
            files: [{
              attachment: qrBuffer,
              name: 'whatsapp-qr.png'
            }]
          });
        } else {
          // It's a QR code string from whatsapp-web.js, generate image from it
          try {
            const qrBuffer = await QRCode.toBuffer(qr, {
              type: 'png',
              width: 512,
              margin: 2,
              color: {
                dark: '#000000',
                light: '#FFFFFF'
              }
            });
            
            Logger.debug('Generated QR buffer size:', qrBuffer.length);
            
            await adminChannel.send({
              content: '🔐 **WhatsApp Authentication Required**\n\nScan this QR code with your phone to connect WhatsApp:\n\n**Instructions:**\n1. Open WhatsApp on your phone\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Scan this QR code',
              files: [{
                attachment: qrBuffer,
                name: 'whatsapp-qr.png'
              }]
            });
          } catch (qrError) {
            Logger.error('Failed to generate QR image, sending as text:', qrError.message);
            
            // Fallback: Send the QR code as text
            await adminChannel.send({
              content: `🔐 **WhatsApp Authentication Required**\n\n**QR Code Data:**\n\`\`\`\n${qr}\n\`\`\`\n\nCopy this data and use a QR code generator to create a scannable code.`
            });
          }
        }
        
        this.qrCodeSent = true;
        Logger.success('QR code sent to Discord admin channel');
      } else {
        Logger.warning('Admin channel not found, falling back to console');
      }
    } catch (discordError) {
      Logger.error('Failed to send QR code to Discord:', discordError);
    }
  }

  cancelSessionRestoreTimeout() {
    if (this.sessionRestoreTimeout) {
      clearTimeout(this.sessionRestoreTimeout);
      this.sessionRestoreTimeout = null;
      Logger.info('Session restoration timeout cancelled - session restored successfully');
    }
  }

  async handleAuthFailure(msg) {
    try {
      Logger.error('Authentication failed:', msg);
      await this.updateSessionStatus('failed');
      
      // Clear local session files to force fresh authentication
      await this.clearLocalSession();
      
      await this.sendDiscordAlert('❌ **WhatsApp Authentication Failed**', `Authentication failed: ${msg}`);
    } catch (error) {
      Logger.error('Failed to handle auth failure:', error);
    }
  }

  async clearLocalSession() {
    try {
      const sessionPath = path.join(process.cwd(), '.wwebjs_auth', 'session-frijolebot-whatsapp');
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        Logger.info('Cleared local WhatsApp session files');
      }
    } catch (error) {
      Logger.error('Failed to clear local session:', error);
    }
  }

  async handleDisconnection(reason) {
    try {
      Logger.warning('Client disconnected:', reason);
      await this.sendDiscordAlert('⚠️ **WhatsApp Disconnected**', `Client disconnected: ${reason}`);
    } catch (error) {
      Logger.error('Failed to handle disconnection:', error);
    }
  }

  async handleConnectionLoss() {
    try {
      Logger.warning('Connection lost, attempting to reconnect...');
      await this.sendDiscordAlert('🔄 **WhatsApp Connection Lost**', 'Connection lost, attempting to reconnect...');
      // TODO: Implement reconnection logic
    } catch (error) {
      Logger.error('Failed to handle connection loss:', error);
    }
  }

  async sendDiscordAlert(title, message) {
    try {
      if (this.discordClient && this.config.discord.adminChannelId) {
        const adminChannel = this.discordClient.channels.cache.get(this.config.discord.adminChannelId);
        if (adminChannel) {
          await adminChannel.send({
            content: `${title}\n\n${message}`
          });
          Logger.info('Alert sent to Discord admin channel');
        }
      }
    } catch (error) {
      Logger.error('Failed to send Discord alert:', error);
    }
  }
}

// Message Handler Class
class WhatsAppMessageHandler {
  constructor(baserowService, discordClient, config) {
    this.baserowService = baserowService;
    this.discordClient = discordClient;
    this.config = config;
  }

  async handleMessage(message) {
    try {
      // Ignore system notification messages
      if (message.type === 'notification_template') {
        Logger.debug(`Ignoring notification_template message from ${message.from}`);
        return;
      }
      
      // Determine the chat ID to check for monitoring
      // For group messages: use message.to (the group ID)
      // For individual messages: use message.from (the individual chat ID)
      const chatId = message.to && message.to.includes('@g.us') ? message.to : message.from;
      const isFromMe = message.fromMe || false;
      
      // Debug logging for all incoming messages
      Logger.info(`WhatsApp message received from: ${message.from}${isFromMe ? ' (sent by me)' : ''}`, {
        type: message.type,
        hasMedia: message.hasMedia,
        body: message.body ? message.body.substring(0, 100) : 'no body',
        fromMe: isFromMe,
        chatId: chatId,
        isGroup: chatId.includes('@g.us'),
        to: message.to,
        from: message.from,
        id: message.id ? message.id._serialized : 'no-id'
      });
      
      const isMonitored = await this.baserowService.isChatMonitored(chatId);
      
      if (!isMonitored) {
        Logger.debug(`Chat ${chatId} is not monitored, ignoring message`);
        return; // Ignore messages from non-monitored chats
      }

      Logger.info(`✅ Received message from monitored chat: ${chatId}${isFromMe ? ' (sent by me)' : ''}`);
      
      // Process the message
      await this.processMessage(message);
      
    } catch (error) {
      Logger.error('Failed to handle WhatsApp message:', error);
    }
  }

  async processMessage(message) {
    try {
      // Determine the chat ID to use for Discord channel lookup
      // For group messages: use message.to (the group ID)
      // For individual messages: use message.from (the individual chat ID)
      const chatId = message.to && message.to.includes('@g.us') ? message.to : message.from;
      
      Logger.info('Processing WhatsApp message:', {
        from: message.from,
        type: message.type,
        hasMedia: message.hasMedia,
        body: message.body ? message.body.substring(0, 100) : 'no body',
        chatId: chatId
      });
      
      // Get the Discord channel for this WhatsApp chat
      const discordChannelId = await this.baserowService.getDiscordChannelForChat(chatId);
      
      if (!discordChannelId) {
        Logger.warning(`No Discord channel configured for WhatsApp chat: ${chatId}`);
        return;
      }
      
      // Get the Discord channel
      const discordChannel = this.discordClient.channels.cache.get(discordChannelId);
      if (!discordChannel) {
        Logger.error(`Discord channel not found: ${discordChannelId}`);
        return;
      }
      
      // Format the message for Discord
      const isFromMe = message.fromMe || false;
      const senderName = isFromMe ? 'You' : (message._data.notifyName || 'Unknown');
      const timestamp = new Date(message.timestamp * 1000).toLocaleString();
      
      // Handle different message types
      if (message.hasMedia) {
        // Handle media messages
        try {
          Logger.info('Downloading media from WhatsApp message...');
          const media = await message.downloadMedia();
          
          if (media && media.data) {
            Logger.info(`Media downloaded: ${media.mimetype}, size: ${media.data.length} bytes`);
            
            // Convert base64 data to buffer for Discord
            const mediaBuffer = Buffer.from(media.data, 'base64');
            
            const attachment = {
              attachment: mediaBuffer,
              name: media.filename || `media.${media.mimetype.split('/')[1] || 'bin'}`
            };
            
            const discordMessage = `**${senderName}** *(${timestamp})*\n📎 ${media.mimetype} file`;
            
            Logger.info('Sending media message to Discord...');
            const sentMessage = await discordChannel.send({
              content: discordMessage,
              files: [attachment]
            });
            
            Logger.success(`Media message sent to Discord: ${sentMessage.id}`);
            
            // Store in Baserow if enabled
            if (this.config.whatsapp.storeMessages) {
              await this.baserowService.storeWhatsAppMessage(message, sentMessage.id, this.config.discord.guildId);
            }
          } else {
            Logger.warning('Media download failed or returned empty data');
          }
        } catch (mediaError) {
          Logger.error('Failed to process media message:', mediaError);
          
          // Fallback: send a text message indicating media failed
          const fallbackMessage = `**${senderName}** *(${timestamp})*\n📎 [Media message - failed to process]`;
          await discordChannel.send(fallbackMessage);
        }
      } else {
        // Handle text messages
        const messageText = message.body || '[No text content]';
        const discordMessage = `**${senderName}** *(${timestamp})*\n${messageText}`;
        
        const sentMessage = await discordChannel.send(discordMessage);
        
        Logger.success(`Text message sent to Discord: ${sentMessage.id}`);
        
        // Store in Baserow if enabled
        if (this.config.whatsapp.storeMessages) {
          await this.baserowService.storeWhatsAppMessage(message, sentMessage.id, this.config.discord.guildId);
        }
      }
      
    } catch (error) {
      Logger.error('Failed to process message:', error);
    }
  }
  
}

module.exports = WhatsAppService;
