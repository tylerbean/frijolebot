// Baileys will be imported dynamically since it's an ES module
// encryption removed; no crypto at-rest for session files
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const Logger = require('../utils/logger');
// BaserowService no longer needed - using PostgreSQL

class WhatsAppService {
  constructor(config, discordClient = null, postgresService = null) {
    this.config = config;
    this.discordClient = discordClient;
    this.sock = null;
    this.isConnected = false;
    this.isInitialized = false;
    this.sessionManager = null;
    this.postgresService = postgresService;
    this.messageHandler = null;
    this.encryptionKey = undefined;
    this.baileys = null; // Will store dynamically imported Baileys functions
    this.store = null; // In-memory store for listing chats
    this.consecutiveAuthFailures = 0; // Track consecutive authentication failures
    this.maxAuthFailures = 3; // Force clear session after 3 consecutive failures
    this.totalRestartAttempts = 0; // Track total restart attempts
    this.maxRestartAttempts = 10; // Maximum total restart attempts before giving up
    this.hourlyReminderInterval = null; // For hourly disconnect notifications
    this.qrRequestedOnDemand = false; // Track if QR was requested via /whatsapp_auth command
    this.startupNotificationSent = false; // Track if startup notification was sent
    this.isShuttingDown = false; // Track if bot is shutting down
    this.qrSuppressAlertsUntil = 0; // Timestamp until which auth-failed alerts are suppressed
    this.adminAlertCooldownMs = 60000; // Cooldown for duplicate admin alerts
    this.lastAdminAlert = { key: null, at: 0 }; // Track last admin alert to de-duplicate
    this.lastIsNewLogin = null; // Cache of isNewLogin from connection updates
    this.contactNameCache = new Map(); // Cache resolved contact names by JID
    this.startupConnectivityTimer = null; // Timer to notify if not connected shortly after startup
    this.lastKeepAlive = null; // Track last keepalive timestamp for presence updates

    Logger.info('WhatsAppService initialized');
  }

  async loadBaileys() {
    if (!this.baileys) {
      Logger.info('Loading Baileys library...');
      this.baileys = await import('@whiskeysockets/baileys');
      Logger.info('Baileys library loaded successfully');
    }
    return this.baileys;
  }

  async initialize() {
    try {
      Logger.info('Initializing WhatsApp service...');
      
      // Load Baileys library first
      await this.loadBaileys();
      
      // PostgreSQL service is already set in constructor

      // Initialize session manager (local-only; no DB session storage)
      this.sessionManager = new WhatsAppSessionManager(undefined, this.discordClient, this.config, this);
      
      // Initialize message handler
      this.messageHandler = new WhatsAppMessageHandler(this.postgresService, this.discordClient, this.config, this);
      
      // Initialize WhatsApp client
      await this.initializeClient();
      
      // Check if we need to notify about missing session
      await this.checkAndNotifySessionStatus();

      // Fallback: if not connected within 20s of init, ping admin once
      if (this.startupConnectivityTimer) {
        clearTimeout(this.startupConnectivityTimer);
      }
      this.startupConnectivityTimer = setTimeout(async () => {
        try {
          if (!this.isConnected && Date.now() > this.qrSuppressAlertsUntil) {
            await this.sendAdminNotification(
              'Not connected after startup. If this persists, use `/whatsapp_auth` to re-link the device.',
              'warning'
            );
            this.setupHourlyReminder();
          }
        } catch (_) {}
      }, 20000);
      
      this.isInitialized = true;
      Logger.success('WhatsApp service initialized successfully');
      
    } catch (error) {
      Logger.error('Failed to initialize WhatsApp service:', error);
      throw error;
    }
  }

  async createSocket() {
    // Initialize Baileys auth state
    const { useMultiFileAuthState, makeWASocket, makeInMemoryStore, makeCacheableSignalKeyStore } = this.baileys;
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    // Create WhatsApp socket with Baileys
    Logger.info('Creating Baileys socket with auth state...');
    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, {
          level: 'silent',
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          fatal: () => {},
          child: () => ({
            level: 'silent',
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            fatal: () => {}
          })
        })
      },
      printQRInTerminal: false,
      // Keepalive configuration to prevent session disconnects
      keepAliveIntervalMs: 30000, // Send ping every 30 seconds
      connectTimeoutMs: 60000, // 60 second connection timeout
      defaultQueryTimeoutMs: 60000, // 60 second query timeout
      // Enhanced connection settings for stability
      retryRequestDelayMs: 250,
      maxMsgRetryCount: 5,
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

    // Initialize in-memory store for chat listing
    try {
      if (!this.store && typeof makeInMemoryStore === 'function') {
        // Create a silent logger stub for the store
        const silent = { level: 'silent', trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, child: () => silent };
        this.store = makeInMemoryStore({ logger: silent });
        if (this.sock && this.sock.ev) {
          this.store.bind(this.sock.ev);
          Logger.info('In-memory store initialized and bound to socket events');
        }
      }
    } catch (e) {
      Logger.warning(`Failed to initialize in-memory store: ${e.message}`);
    }

    // Set up event listeners
    this.setupEventListeners();
    
    // Handle credential updates
    this.sock.ev.on('creds.update', saveCreds);
  }

  /**
   * Resolve a human-friendly sender name from a message using contacts/group metadata
   */
  async getSenderDisplayName(message) {
    try {
      const isGroup = typeof message.key.remoteJid === 'string' && message.key.remoteJid.endsWith('@g.us');
      const jid = message.key.fromMe
        ? (this.sock && this.sock.user ? this.sock.user.id : message.key.remoteJid)
        : (isGroup ? (message.key.participant || message.key.remoteJid) : message.key.remoteJid);

      if (!jid) return message.pushName || 'Unknown';

      const cached = this.contactNameCache.get(jid);
      if (cached) return cached;

      let name = null;
      try {
        const contacts = this.store && this.store.contacts;
        if (contacts) {
          let c = null;
          if (typeof contacts.get === 'function') {
            c = contacts.get(jid) || null;
          } else if (contacts[jid]) {
            c = contacts[jid];
          } else if (typeof contacts.all === 'function') {
            const all = contacts.all();
            c = Array.isArray(all) ? all.find(x => x && (x.id === jid || x.jid === jid)) : null;
          }
          if (c) {
            name = c.name || c.notify || c.vname || c.verifiedName || null;
          }
        }
      } catch (_) {}

      if (!name && message.pushName) name = message.pushName;

      if (!name && isGroup && this.sock && typeof this.sock.groupMetadata === 'function') {
        try {
          const meta = await this.sock.groupMetadata(message.key.remoteJid);
          if (meta && Array.isArray(meta.participants)) {
            const p = meta.participants.find(p => p && p.id === jid);
            if (p) {
              name = p.name || p.notify || null;
            }
          }
        } catch (_) {}
      }

      if (!name) name = String(jid).split('@')[0];

      this.contactNameCache.set(jid, name);
      return name;
    } catch (_) {
      return message.pushName || 'Unknown';
    }
  }

  async reconnectWithExistingSession() {
    try {
      Logger.info('Reconnecting with existing session (not clearing session files)...');
      
      // Just recreate the socket with existing session files
      await this.createSocket();
      
      Logger.info('Reconnected with existing session');
    } catch (error) {
      Logger.error('Failed to reconnect with existing session:', error);
      // If reconnection fails, fall back to full initialization
      Logger.info('Falling back to full initialization...');
      await this.initializeClient();
    }
  }

  async initializeClient() {
    try {
      // Reset QR code sent flag for fresh authentication
      this.sessionManager.qrCodeSent = false;
      
      // Check if we have local session files
      const hasLocalSession = await this.sessionManager.hasLocalSession();
      Logger.info(`Local session check result: ${hasLocalSession}`);
      
      // Decide behavior purely based on local session presence
      if (!hasLocalSession) {
        Logger.info('No existing local session found, will require QR code authentication');
      }

      // Create the socket
      await this.createSocket();
      
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
        const { connection, lastDisconnect, qr, isNewLogin } = update;
        Logger.info('WhatsApp connection update:', { 
          connection, 
          hasQR: !!qr, 
          lastDisconnect: lastDisconnect?.error?.output?.statusCode,
          lastDisconnectError: lastDisconnect?.error?.message,
          fullUpdate: JSON.stringify(update, null, 2)
        });
        // Cache isNewLogin for later use when connection opens
        if (typeof isNewLogin === 'boolean') {
          this.lastIsNewLogin = isNewLogin;
        }
      
      if (qr) {
        Logger.info('QR code generated for WhatsApp authentication');
        Logger.info('Discord client ready:', !!this.discordClient);
        try {
          Logger.info('Admin channel ID:', this.config && this.config.discord ? this.config.discord.adminChannelId : null);
        } catch (_) {}
        Logger.info('QR code length:', qr.length);
        Logger.info('QR code first 50 chars:', qr.substring(0, 50));
        Logger.info('⏳ Waiting for QR code scan - do not disconnect!');
        await this.sessionManager.handleQRCode(qr, this.qrRequestedOnDemand);
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
        this.consecutiveAuthFailures = 0; // Reset failure counter on successful connection
        this.totalRestartAttempts = 0; // Reset restart counter on successful connection
        this.sessionManager.qrCodeSent = false; // Reset QR code sent flag on successful connection
        this.qrRequestedOnDemand = false; // Reset on-demand QR flag on successful connection
        this.startupNotificationSent = false; // Reset startup notification flag on successful connection
        this.sessionManager.cancelSessionRestoreTimeout();
        // Notify admin once on successful authentication (new or restored)
        try {
          const successMsg = (this.lastIsNewLogin === true)
            ? 'Authenticated successfully (new session). WhatsApp is connected and ready.'
            : 'Authenticated successfully (restored session). WhatsApp is connected and ready.';
          await this.sendAdminNotification(successMsg, 'info');
          this.lastIsNewLogin = null; // reset after reporting
        } catch (notifyError) {
          Logger.error('Failed to send success authentication notification:', notifyError);
        }
        await this.startMessageMonitoring();
      } else if (connection === 'close') {
        Logger.warning('WhatsApp client disconnected');
        Logger.info('Disconnect reason:', lastDisconnect?.error?.output?.statusCode);
        Logger.info('Disconnect error:', lastDisconnect?.error);
        this.isConnected = false;
        
        const { DisconnectReason } = this.baileys;
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
          // Implement dynamic session recovery directly in event handler
          try {
            this.consecutiveAuthFailures++;
            
            // Only log as error if QR was not requested on-demand and not shutting down
            if (!this.qrRequestedOnDemand && !this.isShuttingDown) {
              Logger.error(`Authentication failed (attempt ${this.consecutiveAuthFailures}/${this.maxAuthFailures}): Logged out`);
            } else if (this.qrRequestedOnDemand) {
              Logger.info(`Authentication reset for fresh QR generation (attempt ${this.consecutiveAuthFailures}/${this.maxAuthFailures}): Logged out`);
            } else if (this.isShuttingDown) {
              Logger.info(`Authentication logout during shutdown (attempt ${this.consecutiveAuthFailures}/${this.maxAuthFailures}): Logged out`);
            }
            
            // no DB session status updates – local-only session management
            
            // Properly destroy the socket first to release file handles
            if (this.sock) {
              try {
                Logger.info('Destroying WhatsApp socket to release file handles...');
                if (typeof this.sock.end === 'function') {
                  this.sock.end();
                } else if (typeof this.sock.logout === 'function') {
                  await this.sock.logout();
                }
                this.sock = null;
              } catch (logoutError) {
                Logger.warning('Error during socket shutdown:', logoutError.message);
              }
            }
            
            // Wait longer for file handles to be released and force garbage collection
            await new Promise(resolve => setTimeout(resolve, 3000));
            if (global.gc) {
              global.gc();
            }
            
            // If we've had too many consecutive failures, force clear the session
            if (this.consecutiveAuthFailures >= this.maxAuthFailures) {
              Logger.warning(`Too many consecutive authentication failures (${this.consecutiveAuthFailures}), forcing session clear...`);
              await this.sessionManager.forceClearSession();
              this.consecutiveAuthFailures = 0; // Reset counter after force clear
            } else {
              // Clear local session files to force fresh authentication
              await this.sessionManager.clearLocalSession();
            }
            
            // Send Discord alert if available (but not if QR was requested on-demand or shutting down)
            Logger.debug('🔍 [MAIN SERVICE] Discord alert check:', {
              hasDiscordClient: !!this.discordClient,
              hasAdminChannel: !!this.config.discord.adminChannelId,
              qrRequestedOnDemand: this.qrRequestedOnDemand,
              isShuttingDown: this.isShuttingDown,
              suppressUntil: this.qrSuppressAlertsUntil,
              now: Date.now(),
              willSendAlert: !!(this.discordClient && this.config.discord.adminChannelId && !this.qrRequestedOnDemand && !this.isShuttingDown && Date.now() > this.qrSuppressAlertsUntil)
            });
            
            const alertKey = 'auth_failed:logged_out';
            const canAlert = (!this.qrRequestedOnDemand && !this.isShuttingDown && Date.now() > this.qrSuppressAlertsUntil && (typeof this.canSendAdminAlert !== 'function' || this.canSendAdminAlert(alertKey)));
            if (this.discordClient && this.config.discord.adminChannelId && canAlert) {
              Logger.error('🚨 [MAIN SERVICE] SENDING Discord authentication failed message!');
              try {
                const channel = this.discordClient.channels.cache.get(this.config.discord.adminChannelId);
                if (channel) {
                  await channel.send(`❌ **WhatsApp Authentication Failed**\nAuthentication failed: Logged out (attempt ${this.consecutiveAuthFailures}/${this.maxAuthFailures})`);
                  Logger.error('🚨 [MAIN SERVICE] Discord message SENT!');
                }
              } catch (discordError) {
                Logger.error('Failed to send Discord alert:', discordError);
              }
            } else if (this.qrRequestedOnDemand) {
              Logger.info('✅ [MAIN SERVICE] Skipping authentication failed message - QR was requested on-demand');
            } else if (Date.now() <= this.qrSuppressAlertsUntil) {
              Logger.info('✅ [MAIN SERVICE] Skipping authentication failed message - within QR cooldown window');
            } else if (this.isShuttingDown) {
              Logger.info('✅ [MAIN SERVICE] Skipping authentication failed message - shutting down');
            } else {
              Logger.info('✅ [MAIN SERVICE] Skipping authentication failed message - Discord not available');
            }
          } catch (error) {
            Logger.error('Error in dynamic session recovery:', error);
            // Fallback to sessionManager
            await this.sessionManager.handleAuthFailure('Logged out');
          }
          // Restart the authentication process with longer delay to allow cleanup
          setTimeout(() => {
            this.totalRestartAttempts++;
            if (this.totalRestartAttempts > this.maxRestartAttempts) {
              Logger.error(`Maximum restart attempts (${this.maxRestartAttempts}) reached. Stopping authentication attempts.`);
              Logger.error('WhatsApp authentication has failed too many times. Manual intervention may be required.');
              return;
            }
            Logger.info(`Restarting WhatsApp authentication... (attempt ${this.totalRestartAttempts}/${this.maxRestartAttempts})`);
            this.initializeClient();
          }, 5000); // Wait 5 seconds before restarting to allow session cleanup
        } else if (isStreamError) {
          Logger.warning('Stream error detected (likely during QR scan) - attempting to reconnect...');
          Logger.info('This is expected behavior - WhatsApp may force disconnect to present authentication credentials');
          // For stream errors, we need to actively reconnect to complete authentication
          // Don't call initializeClient() as it will try to clear the session
          // Instead, just recreate the socket with existing session
          setTimeout(() => {
            Logger.info('Reconnecting after stream error to complete authentication...');
            this.reconnectWithExistingSession();
          }, 3000); // Wait 3 seconds before reconnecting
        } else {
          Logger.info('Connection closed but not logged out - waiting for reconnection...');
          // Don't immediately restart, let Baileys handle reconnection
          try {
            const alertKey = 'wa_connection_closed';
            const withinQrCooldown = Date.now() <= this.qrSuppressAlertsUntil;
            const suppress = this.qrRequestedOnDemand || withinQrCooldown || this.isShuttingDown;
            if (!suppress && this.discordClient && this.config.discord.adminChannelId && (!this.canSendAdminAlert || this.canSendAdminAlert(alertKey))) {
              await this.sendAdminNotification('Disconnected from WhatsApp (temporary). Will attempt to reconnect automatically.', 'warning');
            } else if (suppress) {
              Logger.info('Skipping temporary disconnect alert due to QR flow or shutdown');
            }
          } catch (_) {}
        }
      }
    });

    // Message handling: only forward messages with conversational content
    this.sock.ev.on('messages.upsert', async (m) => {
      const message = m.messages?.[0];
      if (!message) return;
      const msg = message.message || {};
      const hasText = !!(msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption);
      const hasMedia = !!(msg.imageMessage || msg.videoMessage || msg.audioMessage || msg.documentMessage);
      const isNotify = m.type === 'notify';
      // Only handle if there's text or media
      if ((hasText || hasMedia) && (isNotify || message.key.fromMe)) {
        await this.messageHandler.handleMessage(message);
      }
    });

    Logger.info('WhatsApp client event listeners set up successfully');
  }

  async startMessageMonitoring() {
    try {
      Logger.info('Starting WhatsApp message monitoring...');
      
      // Get active chats from PostgreSQL if available
      let activeChats = [];
      if (this.postgresService && typeof this.postgresService.getActiveChats === 'function') {
        activeChats = await this.postgresService.getActiveChats();
      }
      Logger.info(`Monitoring ${activeChats.length} active chats`);
      
      // Send summary of monitored chats to admin channel
      if (activeChats.length > 0) {
        await this.sendChatMonitoringSummary(activeChats);
      }
      
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

      // Check if socket is still connected
      if (!this.sock.user) {
        Logger.warning('WhatsApp connection health check failed - no user data');
        this.isConnected = false;
        await this.sessionManager.handleConnectionLoss();
        return;
      }

      // Perform a lightweight keepalive operation every 5 minutes
      const now = Date.now();
      if (!this.lastKeepAlive || (now - this.lastKeepAlive) > 300000) { // 5 minutes
        try {
          // Send a minimal presence update to maintain session activity
          await this.sock.sendPresenceUpdate('available');
          this.lastKeepAlive = now;
          Logger.debug('WhatsApp keepalive presence update sent');
        } catch (presenceError) {
          Logger.warning('WhatsApp presence keepalive failed:', presenceError.message);
          // Don't mark as disconnected for presence failures alone
        }
      }

    } catch (error) {
      Logger.error('Connection health check failed:', error);
      this.isConnected = false;
    }
  }

  /**
   * Send a text message to a WhatsApp chat
   * @param {string} chatId - WhatsApp chat ID (e.g., "1234567890@s.whatsapp.net")
   * @param {string} text - Message text to send
   * @returns {Promise<Object|null>} Sent message object or null on failure
   */
  async sendTextMessage(chatId, text) {
    try {
      if (!this.sock || !this.isConnected) {
        Logger.error('WhatsApp not connected, cannot send message');
        return null;
      }

      Logger.info(`Sending text message to ${chatId}: ${text.substring(0, 100)}...`);

      const sentMessage = await this.sock.sendMessage(chatId, { text });
      Logger.success('Text message sent successfully');

      return sentMessage;
    } catch (error) {
      Logger.error('Failed to send text message:', error);
      return null;
    }
  }

  /**
   * Send a media message to a WhatsApp chat
   * @param {string} chatId - WhatsApp chat ID
   * @param {Buffer} mediaBuffer - Media file buffer
   * @param {string} mediaType - Media type ('image', 'video', 'document')
   * @param {string} caption - Optional caption text
   * @param {string} fileName - Original filename for documents
   * @returns {Promise<Object|null>} Sent message object or null on failure
   */
  async sendMediaMessage(chatId, mediaBuffer, mediaType, caption = '', fileName = null) {
    try {
      if (!this.sock || !this.isConnected) {
        Logger.error('WhatsApp not connected, cannot send media');
        return null;
      }

      Logger.info(`Sending ${mediaType} message to ${chatId} (${mediaBuffer.length} bytes)`);

      let messageContent = {};

      if (mediaType === 'image') {
        messageContent = {
          image: mediaBuffer,
          caption
        };
      } else if (mediaType === 'video') {
        messageContent = {
          video: mediaBuffer,
          caption
        };
      } else if (mediaType === 'document') {
        messageContent = {
          document: mediaBuffer,
          fileName: fileName || 'document',
          caption
        };
      } else {
        Logger.error(`Unsupported media type: ${mediaType}`);
        return null;
      }

      const sentMessage = await this.sock.sendMessage(chatId, messageContent);
      Logger.success(`${mediaType} message sent successfully`);

      return sentMessage;
    } catch (error) {
      Logger.error(`Failed to send ${mediaType} message:`, error);
      return null;
    }
  }

  async destroy() {
    try {
      // Set shutdown flag to prevent authentication failed messages during shutdown
      this.isShuttingDown = true;
      
      // Clear hourly reminder interval
      if (this.hourlyReminderInterval) {
        clearInterval(this.hourlyReminderInterval);
        this.hourlyReminderInterval = null;
      }
      
      if (this.sock) {
        // Prefer ending the connection gracefully; fallback to logout if end is unavailable
        if (typeof this.sock.end === 'function') {
          this.sock.end();
        } else if (typeof this.sock.logout === 'function') {
          await this.sock.logout();
        }
      }
      this.isConnected = false;
      this.isInitialized = false;
      Logger.info('WhatsApp service destroyed (connection ended, device remains linked)');
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

  /**
   * Check session status and notify admin if authentication is needed
   */
  async checkAndNotifySessionStatus() {
    try {
      if (this.isConnected) {
        // Already connected, send success notification and clear reminders
        if (!this.startupNotificationSent) {
          await this.sendAdminNotification(
            'Connected and ready for message forwarding.',
            'info'
          );
          this.startupNotificationSent = true;
        }
        
        // Clear hourly reminder since we're connected
        if (this.hourlyReminderInterval) {
          clearInterval(this.hourlyReminderInterval);
          this.hourlyReminderInterval = null;
        }
        return;
      }

      // If not connected and no local session, notify admin once
      const hasLocal = await this.sessionManager.hasLocalSession();
      if (!hasLocal && !this.startupNotificationSent) {
        // No valid session found - notify admin (only once on startup)
        await this.sendAdminNotification(
          'Not authenticated. Use `/whatsapp_auth` command to generate a QR code for authentication.',
          'warning'
        );
        this.startupNotificationSent = true;
        
        // Set up hourly reminder if still not connected
        this.setupHourlyReminder();
      }
    } catch (error) {
      Logger.error('Error checking session status:', error);
      if (!this.startupNotificationSent) {
        await this.sendAdminNotification(
          'Error checking authentication status. Please check logs.',
          'error'
        );
        this.startupNotificationSent = true;
      }
    }
  }

  /**
   * Set up hourly reminder for disconnected WhatsApp
   */
  setupHourlyReminder() {
    // Clear any existing reminder
    if (this.hourlyReminderInterval) {
      clearInterval(this.hourlyReminderInterval);
    }

    // Set up new reminder every hour
    this.hourlyReminderInterval = setInterval(async () => {
      if (!this.isConnected) {
        await this.sendAdminNotification(
          'Still not authenticated. Use `/whatsapp_auth` command to generate a QR code.',
          'warning'
        );
      } else {
        // Connected, clear the reminder
        clearInterval(this.hourlyReminderInterval);
        this.hourlyReminderInterval = null;
      }
    }, 60 * 60 * 1000); // 1 hour in milliseconds
  }

  /**
   * Send notification to admin channel about WhatsApp status
   * @param {string} message - Message to send
   * @param {string} type - Type of notification (info, warning, error)
   */
  async sendAdminNotification(message, type = 'info') {
    try {
      if (!this.discordClient || !this.discordClient.isReady()) {
        Logger.warning('Discord client not ready, cannot send admin notification');
        return;
      }

      const adminChannelId = this.config.discord.adminChannelId;
      if (!adminChannelId) {
        Logger.warning('No admin channel configured, cannot send notification');
        return;
      }

      const adminChannel = this.discordClient.channels.cache.get(adminChannelId);
      if (!adminChannel) {
        Logger.warning(`Admin channel ${adminChannelId} not found`);
        return;
      }

      const emoji = type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️';
      const fullMessage = `${emoji} **WhatsApp Status**: ${message}`;
      
      await adminChannel.send(fullMessage);
      Logger.info(`Admin notification sent: ${message}`);
    } catch (error) {
      Logger.error('Failed to send admin notification:', error);
    }
  }

  canSendAdminAlert(key) {
    try {
      const now = Date.now();
      const last = this.lastAdminAlert || { key: null, at: 0 };
      if (last.key === key && now - last.at < this.adminAlertCooldownMs) {
        Logger.debug(`Suppressing duplicate admin alert for key: ${key}`);
        return false;
      }
      this.lastAdminAlert = { key, at: now };
      return true;
    } catch (_) {
      return true;
    }
  }

  /**
   * Get display name for a WhatsApp chat (name if available, otherwise ID)
   * @param {string} chatId - WhatsApp chat ID
   * @returns {Promise<string>} Display name for the chat
   */
  async getChatDisplayName(chatId) {
    try {
      if (this.postgresService && typeof this.postgresService.getChatById === 'function') {
        const chatDetails = await this.postgresService.getChatById(chatId);
        if (chatDetails && chatDetails.chat_name) {
          return chatDetails.chat_name;
        }
      }
    } catch (error) {
      Logger.error('Error getting chat display name:', error);
    }
    
    // Fallback to chat ID if name not found
    return chatId;
  }

  /**
   * Send summary of monitored WhatsApp chats to admin channel
   * @param {Array} activeChats - Array of active chat configurations
   */
  async sendChatMonitoringSummary(activeChats) {
    try {
      if (!this.discordClient || !this.discordClient.isReady()) {
        Logger.warning('Discord client not ready, cannot send chat summary');
        return;
      }

      const adminChannelId = this.config.discord.adminChannelId;
      if (!adminChannelId) {
        Logger.warning('No admin channel configured, cannot send chat summary');
        return;
      }

      const adminChannel = this.discordClient.channels.cache.get(adminChannelId);
      if (!adminChannel) {
        Logger.warning(`Admin channel ${adminChannelId} not found`);
        return;
      }

      // Build summary message
      let summaryMessage = '📞 **WhatsApp Chat Monitoring Summary**\n\n';
      
      if (activeChats.length === 0) {
        summaryMessage += 'No WhatsApp chats are currently being monitored.';
      } else {
        summaryMessage += `Monitoring **${activeChats.length}** WhatsApp chat(s):\n\n`;
        
        for (const chat of activeChats) {
          // Get Discord channel name if possible
          let discordChannelName = `Channel ${chat.discord_channel_id}`;
          try {
            const discordChannel = this.discordClient.channels.cache.get(chat.discord_channel_id);
            if (discordChannel) {
              discordChannelName = `#${discordChannel.name}`;
            }
          } catch (error) {
            // Use fallback name if channel lookup fails
          }
          
          summaryMessage += `• **${chat.chat_name}**\n`;
          summaryMessage += `  └ WhatsApp: \`${chat.chat_id}\`\n`;
          summaryMessage += `  └ Discord: ${discordChannelName}\n\n`;
        }
      }

      await adminChannel.send(summaryMessage);
      Logger.info(`Chat monitoring summary sent: ${activeChats.length} chats`);
    } catch (error) {
      Logger.error('Failed to send chat monitoring summary:', error);
    }
  }

  /**
   * Request a new QR code for authentication (on-demand)
   * @returns {Promise<Object>} Result object with success status
   */
  async requestQRCode() {
    try {
      if (this.isConnected) {
        return {
          success: false,
          error: 'WhatsApp is already connected. No QR code needed.'
        };
      }

      // If service isn't initialized yet, try to initialize on-demand
      if (!this.isInitialized) {
        try {
          await this.initialize();
        } catch (initErr) {
          return { success: false, error: `Initialization failed: ${initErr?.message || initErr}` };
        }
      }

      Logger.info('Manual QR code requested by admin - generating fresh QR code');
      
      // Set flag to indicate QR was requested on-demand
      this.qrRequestedOnDemand = true;
      Logger.error('🔥 [FLAG SET] Main service qrRequestedOnDemand = true');
      // Suppress auth-failed alerts for a short window to avoid noise during intentional logout
      this.qrSuppressAlertsUntil = Date.now() + 25_000; // 25s window
      
      // IMPORTANT: Set the flag in session manager too, before logout
      if (this.sessionManager) {
        this.sessionManager.qrRequestedOnDemand = true;
        Logger.error('🔥 [FLAG SET] Session manager qrRequestedOnDemand = true');
      } else {
        Logger.error('🔥 [FLAG SET] WARNING: No session manager available!');
      }
      
      // Always generate a fresh QR code to ensure it's not expired
      // Clear any existing session to force QR generation
      await this.sessionManager.clearLocalSession();
      
      // Destroy current socket to ensure clean state
      if (this.sock) {
        try {
          await this.sock.logout();
        } catch (logoutError) {
          Logger.debug('Error during logout (expected):', logoutError.message);
        }
        this.sock = null;
      }
      
      // Reinitialize the client to generate a fresh QR code
      await this.initializeClient();
      
      // The flag should still be true after reinitialization
      Logger.debug('After reinitialization, qrRequestedOnDemand flag:', this.qrRequestedOnDemand);
      
      return {
        success: true,
        message: 'Fresh QR code generation initiated. Check the admin channel.'
      };
    } catch (error) {
      Logger.error('Error generating QR code on demand:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Session Manager Class
class WhatsAppSessionManager {
  constructor(encryptionKey, discordClient, config, whatsappService) {
    this.encryptionKey = encryptionKey;
    this.discordClient = discordClient;
    this.config = config;
    this.whatsappService = whatsappService; // Reference to main WhatsApp service
    this.currentSessionId = null;
    this.hasExistingSession = false;
    this.sessionRestoreTimeout = null;
    this.qrCodeSent = false;
    this.currentQRCode = null; // Store QR code for on-demand sending
    this.qrRequestedOnDemand = false; // Track if QR was requested via /whatsapp_auth command
  }

  // No DB-backed session lookup; rely solely on local Baileys auth files

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

  // No-op: Session persistence is handled by local files only
  async saveSession() {}

  // No-op: No DB session status updates
  async updateSessionStatus(_) {}

  async handleQRCode(qr, qrRequestedOnDemand = false) {
    try {
      Logger.info('QR code generated - scan with your phone to authenticate');
      Logger.debug('QR code data type:', typeof qr);
      Logger.debug('QR code length:', qr ? qr.length : 'null');
      Logger.debug('QR code first 100 chars:', qr ? qr.substring(0, 100) : 'null');
      Logger.debug('QR code last 100 chars:', qr ? qr.substring(qr.length - 100) : 'null');
      
      // Store the QR code for on-demand sending, but don't send it automatically
      this.currentQRCode = qr;
      
      // If QR was requested on-demand, send it immediately
      Logger.debug('Checking qrRequestedOnDemand flag:', qrRequestedOnDemand);
      if (qrRequestedOnDemand) {
        Logger.info('QR code requested on-demand - sending immediately to Discord');
        await this.sendQRCodeToDiscord(qr);
        // Reset flag in main service
        if (this.whatsappService) {
          this.whatsappService.qrRequestedOnDemand = false;
        }
        return;
      }
      
      Logger.info('QR code stored for on-demand sending. Use `/whatsapp_auth` command to request it.');
      
      // If we have an existing session, wait a bit to see if it restores successfully
      if (this.hasExistingSession && !this.qrCodeSent) {
        Logger.info('QR code generated but waiting to see if existing session restores...');
        
        // Set a timeout to notify admin if session doesn't restore within 10 seconds
        this.sessionRestoreTimeout = setTimeout(async () => {
          if (!this.qrCodeSent) {
            Logger.warning('Session restoration timeout - notifying admin to use /whatsapp_auth command');
            // Send notification instead of QR code
            if (this.discordClient && this.config.discord.adminChannelId) {
              await this.whatsappService.sendAdminNotification(
                'Session restoration failed. Use `/whatsapp_auth` command to generate a QR code for authentication.',
                'warning'
              );
            }
          }
        }, 10000); // 10 second timeout
        
        return;
      }
      
      // Don't send any QR-related notifications automatically - only when requested via /whatsapp_auth
      if (this.qrCodeSent) {
        Logger.info('QR code already sent to Discord, skipping duplicate');
      } else if (qrRequestedOnDemand) {
        Logger.info('QR code was sent on-demand, skipping status notification');
      } else {
        Logger.info('QR code stored for on-demand sending - no automatic notifications sent');
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
      this.consecutiveAuthFailures++;
      Logger.error(`Authentication failed (attempt ${this.consecutiveAuthFailures}/${this.maxAuthFailures}):`, msg);
      
      await this.updateSessionStatus('failed');
      
      // Properly destroy the socket first to release file handles
      if (this.sock) {
        try {
          Logger.info('Destroying WhatsApp socket to release file handles...');
          await this.sock.logout();
          this.sock = null;
        } catch (logoutError) {
          Logger.warning('Error during socket logout:', logoutError.message);
        }
      }
      
      // Wait a moment for file handles to be released
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // If we've had too many consecutive failures, force clear the session
      if (this.consecutiveAuthFailures >= this.maxAuthFailures) {
        Logger.warning(`Too many consecutive authentication failures (${this.consecutiveAuthFailures}), forcing session clear...`);
        await this.sessionManager.forceClearSession();
        this.consecutiveAuthFailures = 0; // Reset counter after force clear
      } else {
        // Clear local session files to force fresh authentication
        await this.sessionManager.clearLocalSession();
      }
      
      // Only send Discord alert if QR was not requested on-demand (check both local and main service flags)
      Logger.debug('🔍 [SESSION MANAGER] Discord alert check:', {
        localQrFlag: this.qrRequestedOnDemand,
        hasMainService: !!this.whatsappService,
        mainQrFlag: this.whatsappService ? this.whatsappService.qrRequestedOnDemand : 'N/A',
        willSendAlert: !this.qrRequestedOnDemand && (!this.whatsappService || !this.whatsappService.qrRequestedOnDemand)
      });
      
      const alertKey = `auth_failed:${msg}`;
      if (!this.qrRequestedOnDemand && (!this.whatsappService || !this.whatsappService.qrRequestedOnDemand) && (!this.whatsappService || (typeof this.whatsappService.canSendAdminAlert !== 'function') || this.whatsappService.canSendAdminAlert(alertKey))) {
        Logger.error('🚨 [SESSION MANAGER] SENDING Discord authentication failed message!');
        await this.sendDiscordAlert('❌ **WhatsApp Authentication Failed**', `Authentication failed: ${msg} (attempt ${this.consecutiveAuthFailures}/${this.maxAuthFailures})`, alertKey);
        Logger.error('🚨 [SESSION MANAGER] Discord message SENT!');
      } else {
        Logger.info('✅ [SESSION MANAGER] Skipping authentication failed Discord alert - QR was requested on-demand');
      }
    } catch (error) {
      Logger.error('Failed to handle auth failure:', error);
    }
  }

  async clearLocalSession() {
    try {
      const sessionPath = path.join(process.cwd(), 'auth_info_baileys');
      if (fs.existsSync(sessionPath)) {
        // Remove only contents, not the directory itself
        const entries = fs.readdirSync(sessionPath);
        for (const entry of entries) {
          const fullPath = path.join(sessionPath, entry);
          try {
            const stat = fs.lstatSync(fullPath);
            if (stat.isDirectory()) {
              fs.rmSync(fullPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(fullPath);
            }
          } catch (entryErr) {
            if (entryErr.code === 'EBUSY') {
              Logger.warning(`Could not remove busy entry: ${entry}`);
            } else {
              Logger.warning(`Could not remove entry ${entry}: ${entryErr.message}`);
            }
          }
        }
        Logger.info('Cleared local WhatsApp session contents (directory preserved)');
      }
    } catch (error) {
      Logger.error('Failed to clear local session contents:', error);
    }
  }

  async forceClearSession() {
    try {
      Logger.warning('Force clearing corrupted WhatsApp session...');
      
      // Force garbage collection to release any remaining file handles
      if (global.gc) {
        global.gc();
      }
      
      // First, clear the local session contents (preserve directory)
      const sessionPath = path.join(process.cwd(), 'auth_info_baileys');
      if (fs.existsSync(sessionPath)) {
        const files = fs.readdirSync(sessionPath);
        for (const file of files) {
          try {
            const p = path.join(sessionPath, file);
            const st = fs.lstatSync(p);
            if (st.isDirectory()) {
              fs.rmSync(p, { recursive: true, force: true });
            } else {
              fs.unlinkSync(p);
            }
          } catch (fileError) {
            Logger.warning(`Force clear: could not remove ${file}: ${fileError.message}`);
          }
        }
        Logger.info('Force cleared local WhatsApp session contents (directory preserved)');
      }
      
      // No DB session clearing required; sessions are managed locally only
      
      // Reset session manager state
      this.sessionManager.currentSessionId = null;
      
      Logger.info('Force clear completed - next authentication will be fresh');
      
    } catch (error) {
      Logger.error('Failed to force clear session:', error);
    }
  }

  async handleDisconnection(reason) {
    try {
      Logger.warning('Client disconnected:', reason);
      await this.sendDiscordAlert('⚠️ **WhatsApp Disconnected**', `Client disconnected: ${reason}`, 'disconnected');
    } catch (error) {
      Logger.error('Failed to handle disconnection:', error);
    }
  }

  async handleConnectionLoss() {
    try {
      Logger.warning('Connection lost, attempting to reconnect...');
      await this.sendDiscordAlert('🔄 **WhatsApp Connection Lost**', 'Connection lost, attempting to reconnect...', 'connection_lost');
      // TODO: Implement reconnection logic
    } catch (error) {
      Logger.error('Failed to handle connection loss:', error);
    }
  }

  async sendDiscordAlert(title, message, key) {
    try {
      if (this.discordClient && this.config.discord.adminChannelId) {
        if (key && typeof this.canSendAdminAlert === 'function' && !this.canSendAdminAlert(key)) {
          return;
        }
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
  constructor(postgresService, discordClient, config, whatsappService) {
    this.postgresService = postgresService;
    this.discordClient = discordClient;
    this.config = config;
    this.whatsappService = whatsappService;
  }

  async handleMessage(message) {
    try {
      // Ignore system notification messages
      if (message.message?.protocolMessage?.type === 'REVOKE' || 
          message.message?.protocolMessage?.type === 'EPHEMERAL_SETTING') {
        const chatDisplayName = this.whatsappService && typeof this.whatsappService.getChatDisplayName === 'function'
          ? await this.whatsappService.getChatDisplayName(message.key.remoteJid)
          : message.key.remoteJid;
        Logger.debug(`Ignoring system message from ${chatDisplayName}`);
        return;
      }
      
      // Ignore sender key distribution messages (encryption setup) quietly by default
      if (message.message?.senderKeyDistributionMessage) {
        return;
      }
      
      // Determine the chat ID to check for monitoring
      // For group messages: use message.key.remoteJid (the group ID)
      // For individual messages: use message.key.remoteJid (the individual chat ID)
      const chatId = message.key.remoteJid;
      const isFromMe = message.key.fromMe || false;
      
      // Get message content
      const messageContent = message.message;
      // Handle reactions as a special case
      if (messageContent?.reactionMessage) {
        const chatIdForChannel = message.key.remoteJid;
        const discordChannelId = await this.postgresService.getDiscordChannelForChat(chatIdForChannel);
        if (!discordChannelId) return;
        const discordChannel = this.discordClient.channels.cache.get(discordChannelId);
        if (!discordChannel) return;

        const isFromMeReaction = message.key.fromMe || false;
        const reactorName = isFromMeReaction
          ? 'You'
          : (this.whatsappService && typeof this.whatsappService.getSenderDisplayName === 'function'
              ? await this.whatsappService.getSenderDisplayName(message)
              : 'Unknown');

        const emoji = messageContent.reactionMessage.text || messageContent.reactionMessage.emoji || '';
        const referencedKey = messageContent.reactionMessage.key || {};
        const originalId = referencedKey.id || '';

        let originalSender = 'Unknown';
        let originalContent = '[content unavailable]';
        try {
          if (originalId && typeof this.postgresService.getWhatsAppMessageById === 'function') {
            const original = await this.postgresService.getWhatsAppMessageById(originalId);
            if (original) {
              originalSender = original.sender || original.chat_id || 'Unknown';
              originalContent = original.content || '[content unavailable]';
            }
          }
        } catch (_) {}

        const text = `**${reactorName}** reacted with ${emoji} to:\n\n${originalSender}\n${originalContent}`;
        await discordChannel.send(text);
        return;
      }
      const hasMedia = !!(messageContent?.imageMessage || messageContent?.videoMessage || 
                         messageContent?.audioMessage || messageContent?.documentMessage);
      const body = messageContent?.conversation || 
                   messageContent?.extendedTextMessage?.text || 
                   messageContent?.imageMessage?.caption ||
                   messageContent?.videoMessage?.caption ||
                   '';

      // If there is no text and no media, do not proxy this message
      if (!hasMedia && !body) {
        Logger.debug('Skipping WhatsApp message with no conversational content');
        return;
      }
      
      // Get chat display name for logging
      const chatDisplayName = this.whatsappService && typeof this.whatsappService.getChatDisplayName === 'function'
        ? await this.whatsappService.getChatDisplayName(chatId)
        : chatId;
      
      // Debug logging for all incoming messages
      Logger.info(`WhatsApp message received from: ${chatDisplayName}${isFromMe ? ' (sent by me)' : ''}`, {
        type: Object.keys(messageContent || {})[0] || 'unknown',
        hasMedia: hasMedia,
        body: body ? body.substring(0, 100) : 'no body',
        fromMe: isFromMe,
        chatId: chatId,
        chatName: chatDisplayName,
        isGroup: chatId.includes('@g.us'),
        id: message.key.id
      });
      
      const isMonitored = await this.postgresService.isChatMonitored(chatId);
      
      if (!isMonitored) {
        Logger.debug(`Chat ${chatDisplayName} is not monitored, ignoring message`);
        return; // Ignore messages from non-monitored chats
      }

      Logger.info(`✅ Received message from monitored chat: ${chatDisplayName}${isFromMe ? ' (sent by me)' : ''}`);
      
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
      const discordChannelId = await this.postgresService.getDiscordChannelForChat(chatId);
      
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
      const senderName = isFromMe
        ? 'You'
        : (this.whatsappService && typeof this.whatsappService.getSenderDisplayName === 'function'
            ? await this.whatsappService.getSenderDisplayName(message)
            : 'Unknown');
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
          
          let mediaBuffer;
          let filename = 'media';
          let mimetype = 'application/octet-stream';
          
          // Ensure Baileys is loaded and get message type
          await this.whatsappService.loadBaileys();
          const { getContentType } = this.whatsappService.baileys;
          const messageType = getContentType(message.message);
          
          // Set filename and mimetype based on message type
          if (messageType === 'imageMessage') {
            filename = 'image.jpg';
            mimetype = 'image/jpeg';
          } else if (messageType === 'videoMessage') {
            filename = 'video.mp4';
            mimetype = 'video/mp4';
          } else if (messageType === 'audioMessage') {
            filename = 'audio.ogg';
            mimetype = 'audio/ogg';
          } else if (messageType === 'documentMessage') {
            const docMessage = message.message.documentMessage;
            filename = docMessage.fileName || 'document';
            mimetype = docMessage.mimetype || 'application/octet-stream';
          }
          
          try {
            // Ensure Baileys is loaded and use downloadMediaMessage with proper error handling
            await this.whatsappService.loadBaileys();
            const { downloadMediaMessage } = this.whatsappService.baileys;
            const downloadOptions = {
              logger: Logger
            };
            
            // Add reupload request if the method exists
            if (this.whatsappService.sock && typeof this.whatsappService.sock.updateMediaMessage === 'function') {
              downloadOptions.reuploadRequest = this.whatsappService.sock.updateMediaMessage;
            }
            
            const stream = await downloadMediaMessage(
              message,
              'stream',
              {},
              downloadOptions
            );
            
            const chunks = [];
            for await (const chunk of stream) {
              chunks.push(chunk);
            }
            mediaBuffer = Buffer.concat(chunks);
          } catch (downloadError) {
            Logger.warning(`Failed to download media: ${downloadError.message}`);
            
            // If media download fails, try to request reupload (if supported)
            try {
              if (this.whatsappService.sock && typeof this.whatsappService.sock.updateMediaMessage === 'function') {
                Logger.info('Attempting to request media reupload...');
                await this.whatsappService.sock.updateMediaMessage(message);
                
                // Wait a moment and try download again
                await new Promise(resolve => setTimeout(resolve, 2000));
                await this.whatsappService.loadBaileys();
                const { downloadMediaMessage: retryDownloadMediaMessage } = this.whatsappService.baileys;
                const retryStream = await retryDownloadMediaMessage(
                  message,
                  'stream',
                  {},
                  downloadOptions
                );
                
                const retryChunks = [];
                for await (const chunk of retryStream) {
                  retryChunks.push(chunk);
                }
                mediaBuffer = Buffer.concat(retryChunks);
                Logger.success('Media reupload successful');
              } else {
                Logger.warning('Media reupload not supported by this Baileys version');
                throw new Error('Media reupload not supported');
              }
            } catch (reuploadError) {
              Logger.error(`Media reupload failed: ${reuploadError.message}`);
              throw new Error(`Media download failed: ${downloadError.message}`);
            }
          }
          
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
          
          // Store in DB if enabled (DB-backed flag)
          try {
            const storeMessagesFlag = await this.postgresService.getFeatureFlagCached('WHATSAPP_STORE_MESSAGES');
            if (storeMessagesFlag) {
              const normalized = {
                id: { _serialized: message.key?.id || '' },
                from: message.key?.remoteJid,
                _data: { notifyName: message.pushName || '' },
                body,
                type: Object.keys(messageContent || {})[0] || 'unknown'
              };
              await this.postgresService.storeWhatsAppMessage(normalized, sentMessage.id, this.config.discord.guildId);
            }
          } catch (_) {}
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
        
        // Store in DB if enabled (DB-backed flag)
        try {
          const storeMessagesFlag = await this.postgresService.getFeatureFlagCached('WHATSAPP_STORE_MESSAGES');
          if (storeMessagesFlag) {
            const normalized = {
              id: { _serialized: message.key?.id || '' },
              from: message.key?.remoteJid,
              _data: { notifyName: message.pushName || '' },
              body: messageText,
              type: 'chat'
            };
            await this.postgresService.storeWhatsAppMessage(normalized, sentMessage.id, this.config.discord.guildId);
          }
        } catch (_) {}
      }
      
    } catch (error) {
      Logger.error('Failed to process message:', error);
    }
  }
  
}

module.exports = WhatsAppService;
