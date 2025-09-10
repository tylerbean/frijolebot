// Baileys will be imported dynamically since it's an ES module
const crypto = require('crypto-js');
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
    this.encryptionKey = config.whatsapp.sessionEncryptionKey;
    this.baileys = null; // Will store dynamically imported Baileys functions
    this.consecutiveAuthFailures = 0; // Track consecutive authentication failures
    this.maxAuthFailures = 3; // Force clear session after 3 consecutive failures
    this.totalRestartAttempts = 0; // Track total restart attempts
    this.maxRestartAttempts = 10; // Maximum total restart attempts before giving up
    this.hourlyReminderInterval = null; // For hourly disconnect notifications
    this.qrRequestedOnDemand = false; // Track if QR was requested via /whatsapp_auth command
    this.startupNotificationSent = false; // Track if startup notification was sent
    this.isShuttingDown = false; // Track if bot is shutting down
    
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

      // Initialize session manager
      this.sessionManager = new WhatsAppSessionManager(this.postgresService, this.encryptionKey, this.discordClient, this.config, this);
      
      // Initialize message handler
      this.messageHandler = new WhatsAppMessageHandler(this.postgresService, this.discordClient, this.config, this);
      
      // Initialize WhatsApp client
      await this.initializeClient();
      
      // Check if we need to notify about missing session
      await this.checkAndNotifySessionStatus();
      
      this.isInitialized = true;
      Logger.success('WhatsApp service initialized successfully');
      
    } catch (error) {
      Logger.error('Failed to initialize WhatsApp service:', error);
      throw error;
    }
  }

  async createSocket() {
    // Initialize Baileys auth state
    const { useMultiFileAuthState, makeWASocket } = this.baileys;
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
        Logger.warning('Found local session but no valid Baserow session - this may be a corrupted session');
        Logger.info('However, this could also be a fresh session from QR scan - attempting to use it first');
        // Don't immediately clear the session - try to use it first
        // If it's truly corrupted, the authentication will fail and we'll clear it then
      } else if (!hasLocalSession && baserowSession) {
        Logger.warning('Found Baserow session but no local session - local files required for restoration');
        Logger.info('Clearing orphaned Baserow session and requiring fresh authentication');
        // Clear the orphaned Baserow session since we can't restore without local files
        await this.sessionManager.updateSessionStatus('expired');
        this.sessionManager.currentSessionId = null;
      } else {
        Logger.info('No existing sessions found, will require QR code authentication');
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
      
      if (qr) {
        Logger.info('QR code generated for WhatsApp authentication');
        Logger.info('Discord client ready:', !!this.discordClient);
        Logger.info('Admin channel ID:', this.config.discord.adminChannelId);
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
        await this.sessionManager.saveSession();
        await this.sessionManager.updateSessionStatus('active');
        // Notify admin once on successful authentication (new or restored)
        try {
          const successMsg = isNewLogin === true
            ? 'Authenticated successfully (new session). WhatsApp is connected and ready.'
            : 'Authenticated successfully (restored session). WhatsApp is connected and ready.';
          await this.sendAdminNotification(successMsg, 'info');
        } catch (notifyError) {
          Logger.error('Failed to send success authentication notification:', notifyError);
        }
        await this.startMessageMonitoring();
      } else if (connection === 'close') {
        Logger.warning('WhatsApp client disconnected');
        Logger.info('Disconnect reason:', lastDisconnect?.error?.output?.statusCode);
        Logger.info('Disconnect error:', lastDisconnect?.error);
        this.isConnected = false;
        await this.sessionManager.updateSessionStatus('disconnected');
        
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
            
            await this.sessionManager.updateSessionStatus('failed');
            
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
              willSendAlert: !!(this.discordClient && this.config.discord.adminChannelId && !this.qrRequestedOnDemand && !this.isShuttingDown)
            });
            
            if (this.discordClient && this.config.discord.adminChannelId && !this.qrRequestedOnDemand && !this.isShuttingDown) {
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
      const activeChats = await this.postgresService.getActiveChats();
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
      // Set shutdown flag to prevent authentication failed messages during shutdown
      this.isShuttingDown = true;
      
      // Clear hourly reminder interval
      if (this.hourlyReminderInterval) {
        clearInterval(this.hourlyReminderInterval);
        this.hourlyReminderInterval = null;
      }
      
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

      // Check if we have a valid session
      const hasValidSession = await this.sessionManager.getActiveSession();
      
      if (!hasValidSession && !this.startupNotificationSent) {
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

      if (!this.isInitialized) {
        return {
          success: false,
          error: 'WhatsApp service is not initialized. Please restart the bot.'
        };
      }

      Logger.info('Manual QR code requested by admin - generating fresh QR code');
      
      // Set flag to indicate QR was requested on-demand
      this.qrRequestedOnDemand = true;
      Logger.error('🔥 [FLAG SET] Main service qrRequestedOnDemand = true');
      
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
  constructor(postgresService, encryptionKey, discordClient, config, whatsappService) {
    this.postgresService = postgresService;
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

  async getActiveSession() {
    try {
      const session = await this.postgresService.getActiveWhatsAppSession();
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
      
      await this.postgresService.saveWhatsAppSession(this.currentSessionId, sessionData, 'active', 'frijolebot-whatsapp');
      Logger.info(`Session saved to Baserow: ${this.currentSessionId}`);
    } catch (error) {
      Logger.error('Failed to save session:', error);
    }
  }

  async updateSessionStatus(status) {
    try {
      if (this.currentSessionId) {
        await this.postgresService.updateWhatsAppSessionStatus(this.currentSessionId, status);
        Logger.info(`Session status updated to: ${status}`);
      } else {
        Logger.warning('No current session ID available for status update');
      }
    } catch (error) {
      Logger.error('Failed to update session status:', error);
    }
  }

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
      
      if (!this.qrRequestedOnDemand && (!this.whatsappService || !this.whatsappService.qrRequestedOnDemand)) {
        Logger.error('🚨 [SESSION MANAGER] SENDING Discord authentication failed message!');
        await this.sendDiscordAlert('❌ **WhatsApp Authentication Failed**', `Authentication failed: ${msg} (attempt ${this.consecutiveAuthFailures}/${this.maxAuthFailures})`);
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
        // Try to clear the session directory with retries for EBUSY errors
        let retries = 5; // Increased retries
        while (retries > 0) {
          try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            Logger.info('Cleared local WhatsApp session files');
            return; // Success, exit the retry loop
          } catch (rmError) {
            if (rmError.code === 'EBUSY' && retries > 1) {
              Logger.warning(`Session directory busy, retrying in 3 seconds... (${retries - 1} retries left)`);
              await new Promise(resolve => setTimeout(resolve, 3000));
              retries--;
            } else {
              Logger.error('Session directory still busy after retries - will be cleared on next restart');
              throw rmError; // Re-throw if not EBUSY or no retries left
            }
          }
        }
      }
    } catch (error) {
      if (error.code === 'EBUSY') {
        Logger.warning('Session directory still busy after retries - will be cleared on next restart');
      } else {
        Logger.error('Failed to clear local session:', error);
      }
    }
  }

  async forceClearSession() {
    try {
      Logger.warning('Force clearing corrupted WhatsApp session...');
      
      // Force garbage collection to release any remaining file handles
      if (global.gc) {
        global.gc();
      }
      
      // First, try to clear the local session with more aggressive retries
      const sessionPath = path.join(process.cwd(), 'auth_info_baileys');
      if (fs.existsSync(sessionPath)) {
        let retries = 15; // More retries for force clear
        while (retries > 0) {
          try {
            // Try to remove individual files first if directory removal fails
            try {
              fs.rmSync(sessionPath, { recursive: true, force: true });
              Logger.info('Force cleared local WhatsApp session files');
              break;
            } catch (dirError) {
              if (dirError.code === 'EBUSY') {
                // Try to remove individual files
                const files = fs.readdirSync(sessionPath);
                for (const file of files) {
                  try {
                    fs.unlinkSync(path.join(sessionPath, file));
                  } catch (fileError) {
                    Logger.warning(`Could not remove file ${file}:`, fileError.message);
                  }
                }
                // Try to remove directory again
                fs.rmSync(sessionPath, { recursive: true, force: true });
                Logger.info('Force cleared local WhatsApp session files (individual file removal)');
                break;
              } else {
                throw dirError;
              }
            }
          } catch (rmError) {
            if (rmError.code === 'EBUSY' && retries > 1) {
              Logger.warning(`Force clear: Session directory busy, retrying in 5 seconds... (${retries - 1} retries left)`);
              await new Promise(resolve => setTimeout(resolve, 5000));
              retries--;
            } else {
              Logger.error('Force clear failed:', rmError);
              break;
            }
          }
        }
      }
      
      // Also clear any Baserow sessions to ensure clean state
      try {
        await this.sessionManager.updateSessionStatus('expired');
        Logger.info('Marked all Baserow sessions as expired');
      } catch (error) {
        Logger.warning('Failed to clear Baserow sessions:', error.message);
      }
      
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
      
      const isMonitored = await this.postgresService.isChatMonitored(chatId);
      
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
          
          // Store in Baserow if enabled
          if (this.config.whatsapp.storeMessages) {
            await this.postgresService.storeWhatsAppMessage(message, sentMessage.id, this.config.discord.guildId);
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
          await this.postgresService.storeWhatsAppMessage(message, sentMessage.id, this.config.discord.guildId);
        }
      }
      
    } catch (error) {
      Logger.error('Failed to process message:', error);
    }
  }
  
}

module.exports = WhatsAppService;
