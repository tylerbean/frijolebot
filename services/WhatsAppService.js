const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadContentFromMessage } = require('@whiskeysockets/baileys');
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
    this.sock = null;
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
      let baserowSession = null;
      try {
        baserowSession = await this.sessionManager.getActiveSession();
        Logger.info(`Baserow session check result: ${baserowSession ? 'found' : 'not found'}`);
      } catch (error) {
        Logger.warning('Failed to check Baserow session (network issue), proceeding with local session only:', error.message);
        baserowSession = null;
      }
      
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

      // Initialize Baileys auth state
      const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
      
      // Create WhatsApp socket with Baileys
      Logger.info('Creating Baileys socket with auth state...');
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: {
          level: 'silent',
          child: () => ({ 
            level: 'silent',
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            fatal: () => {}
          }),
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          fatal: () => {}
        }
      });
      Logger.info('Baileys socket created successfully');

      // Set up event listeners
      this.setupEventListeners();
      
      // Handle credential updates
      this.sock.ev.on('creds.update', saveCreds);
      
      Logger.info('WhatsApp client initialization completed');
      
    } catch (error) {
      Logger.error('Failed to initialize WhatsApp client:', error);
      throw error;
    }
  }

  setupEventListeners() {
    Logger.info('Setting up WhatsApp client event listeners...');
    Logger.info('Socket exists:', !!this.sock);
    
      // Connection updates (includes QR, ready, disconnected states)
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        Logger.info('WhatsApp connection update:', { 
          connection, 
          hasQR: !!qr, 
          lastDisconnect: lastDisconnect?.error?.output?.statusCode,
          lastDisconnectError: lastDisconnect?.error?.message,
          fullUpdate: JSON.stringify(update, null, 2)
        });
      
      if (qr) {
        Logger.info('QR code generated for WhatsApp authentication');
        Logger.info('Discord client ready:', !!this.discordClient);
        Logger.info('Admin channel ID:', this.config.discord.adminChannelId);
        Logger.info('QR code length:', qr.length);
        Logger.info('QR code first 50 chars:', qr.substring(0, 50));
        Logger.info('⏳ Waiting for QR code scan - do not disconnect!');
        await this.sessionManager.handleQRCode(qr);
      }
      
      if (connection === 'connecting') {
        Logger.info('WhatsApp client connecting...');
        Logger.info('This may happen after QR scan - waiting for authentication to complete');
      }
      
      if (connection === 'open') {
        Logger.success('WhatsApp client is ready!');
        Logger.info('WhatsApp user info:', this.sock.user);
        Logger.info('Authentication completed successfully - device should now appear in WhatsApp');
        this.isConnected = true;
        this.sessionManager.cancelSessionRestoreTimeout();
        await this.sessionManager.saveSession();
        await this.sessionManager.updateSessionStatus('active');
        await this.startMessageMonitoring();
      } else if (connection === 'close') {
        Logger.warning('WhatsApp client disconnected');
        Logger.info('Disconnect reason:', lastDisconnect?.error?.output?.statusCode);
        Logger.info('Disconnect error:', lastDisconnect?.error);
        this.isConnected = false;
        await this.sessionManager.updateSessionStatus('disconnected');
        
        const disconnectCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = disconnectCode === DisconnectReason.loggedOut;
        const isConnectionClosed = disconnectCode === DisconnectReason.connectionClosed;
        const isConnectionLost = disconnectCode === DisconnectReason.connectionLost;
        const isStreamError = disconnectCode === 515; // Stream Errored (restart required)
        
        Logger.info('Disconnect analysis:', { 
          disconnectCode, 
          isLoggedOut, 
          isConnectionClosed, 
          isConnectionLost,
          isStreamError
        });
        
        // Handle different disconnect scenarios
        if (isLoggedOut) {
          Logger.error('Logged out, restarting authentication process...');
          await this.sessionManager.handleAuthFailure('Logged out');
          // Restart the authentication process
          setTimeout(() => {
            Logger.info('Restarting WhatsApp authentication...');
            this.initializeClient();
          }, 2000); // Wait 2 seconds before restarting
        } else if (isStreamError) {
          Logger.warning('Stream error detected (likely during QR scan) - attempting to reconnect...');
          Logger.info('This is expected behavior - WhatsApp may force disconnect to present authentication credentials');
          // For stream errors, we need to actively reconnect to complete authentication
          setTimeout(() => {
            Logger.info('Reconnecting after stream error to complete authentication...');
            this.initializeClient();
          }, 3000); // Wait 3 seconds before reconnecting
        } else {
          Logger.info('Connection closed but not logged out - waiting for reconnection...');
          // Don't immediately restart, let Baileys handle reconnection
        }
      }
    });

    // Message handling
    this.sock.ev.on('messages.upsert', async (m) => {
      const message = m.messages[0];
      if (!message.key.fromMe && m.type === 'notify') {
        // Incoming message from others
        await this.messageHandler.handleMessage(message);
      } else if (message.key.fromMe) {
        // Message sent by this account
        Logger.info('Message sent by this account detected');
        await this.messageHandler.handleMessage(message);
      }
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
      if (!this.sock || !this.isConnected) {
        return;
      }

      // Baileys doesn't have a direct getState() method, 
      // but we can check if the socket is still connected
      if (!this.sock.user) {
        Logger.warning('WhatsApp connection health check failed - no user data');
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
      if (this.sock) {
        await this.sock.logout();
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
      clientState: this.sock ? 'initialized' : 'not_initialized'
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
      const sessionPath = path.join(process.cwd(), 'auth_info_baileys');
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
      Logger.info('Attempting to send QR code to Discord...');
      Logger.info('Discord client available:', !!this.discordClient);
      Logger.info('Admin channel ID available:', !!this.config.discord.adminChannelId);
      
      if (this.discordClient && this.config.discord.adminChannelId) {
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
      } else {
        Logger.warning('Discord client or admin channel not configured, QR code not sent to Discord');
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
      const sessionPath = path.join(process.cwd(), 'auth_info_baileys');
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
      if (message.message?.protocolMessage?.type === 'REVOKE' || 
          message.message?.protocolMessage?.type === 'EPHEMERAL_SETTING') {
        Logger.debug(`Ignoring system message from ${message.key.remoteJid}`);
        return;
      }
      
      // Ignore sender key distribution messages (encryption setup)
      if (message.message?.senderKeyDistributionMessage) {
        Logger.debug(`Ignoring sender key distribution message from ${message.key.remoteJid}`);
        return;
      }
      
      // Determine the chat ID to check for monitoring
      // For group messages: use message.key.remoteJid (the group ID)
      // For individual messages: use message.key.remoteJid (the individual chat ID)
      const chatId = message.key.remoteJid;
      const isFromMe = message.key.fromMe || false;
      
      // Get message content
      const messageContent = message.message;
      const hasMedia = !!(messageContent?.imageMessage || messageContent?.videoMessage || 
                         messageContent?.audioMessage || messageContent?.documentMessage);
      const body = messageContent?.conversation || 
                   messageContent?.extendedTextMessage?.text || 
                   messageContent?.imageMessage?.caption ||
                   messageContent?.videoMessage?.caption ||
                   '';
      
      // Debug logging for all incoming messages
      Logger.info(`WhatsApp message received from: ${message.key.remoteJid}${isFromMe ? ' (sent by me)' : ''}`, {
        type: Object.keys(messageContent || {})[0] || 'unknown',
        hasMedia: hasMedia,
        body: body ? body.substring(0, 100) : 'no body',
        fromMe: isFromMe,
        chatId: chatId,
        isGroup: chatId.includes('@g.us'),
        id: message.key.id
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
      const chatId = message.key.remoteJid;
      
      // Get message content
      const messageContent = message.message;
      const hasMedia = !!(messageContent?.imageMessage || messageContent?.videoMessage || 
                         messageContent?.audioMessage || messageContent?.documentMessage);
      const body = messageContent?.conversation || 
                   messageContent?.extendedTextMessage?.text || 
                   messageContent?.imageMessage?.caption ||
                   messageContent?.videoMessage?.caption ||
                   '';
      
      Logger.info('Processing WhatsApp message:', {
        from: message.key.remoteJid,
        type: Object.keys(messageContent || {})[0] || 'unknown',
        hasMedia: hasMedia,
        body: body ? body.substring(0, 100) : 'no body',
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
      const isFromMe = message.key.fromMe || false;
      const senderName = isFromMe ? 'You' : (message.pushName || 'Unknown');
      const timezone = process.env.TIMEZONE || 'UTC';
      const timestamp = new Date(message.messageTimestamp * 1000).toLocaleString('en-US', { 
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      
      // Handle different message types
      if (hasMedia) {
        // Handle media messages
        try {
          Logger.info('Downloading media from WhatsApp message...');
          
          let mediaType = 'image';
          let mediaBuffer;
          let filename = 'media';
          let mimetype = 'application/octet-stream';
          
          if (messageContent.imageMessage) {
            mediaType = 'image';
            filename = 'image.jpg';
            mimetype = 'image/jpeg';
          } else if (messageContent.videoMessage) {
            mediaType = 'video';
            filename = 'video.mp4';
            mimetype = 'video/mp4';
          } else if (messageContent.audioMessage) {
            mediaType = 'audio';
            filename = 'audio.ogg';
            mimetype = 'audio/ogg';
          } else if (messageContent.documentMessage) {
            mediaType = 'document';
            filename = messageContent.documentMessage.fileName || 'document';
            mimetype = messageContent.documentMessage.mimetype || 'application/octet-stream';
          }
          
          const stream = await downloadContentFromMessage(message, mediaType);
          const chunks = [];
          for await (const chunk of stream) {
            chunks.push(chunk);
          }
          mediaBuffer = Buffer.concat(chunks);
          
          Logger.info(`Media downloaded: ${mimetype}, size: ${mediaBuffer.length} bytes`);
          
          const attachment = {
            attachment: mediaBuffer,
            name: filename
          };
          
          const discordMessage = `**${senderName}** *(${timestamp})*\n📎 ${mimetype} file`;
          
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
        } catch (mediaError) {
          Logger.error('Failed to process media message:', mediaError);
          
          // Fallback: send a text message indicating media failed
          const fallbackMessage = `**${senderName}** *(${timestamp})*\n📎 [Media message - failed to process]`;
          await discordChannel.send(fallbackMessage);
        }
      } else {
        // Handle text messages
        const messageText = body || '[No text content]';
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
