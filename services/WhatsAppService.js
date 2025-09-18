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
    this.lastProactiveActivity = null; // Track last proactive keepalive activity
    this.reconnectAttempts = 0; // Track reconnection attempts
    this.maxReconnectAttempts = 5; // Maximum reconnection attempts
    this.reconnectDelay = 5000; // Initial reconnection delay in ms
    this.reconnectTimer = null; // Timer for scheduled reconnections
    this.timezoneCache = { value: null, lastUpdated: 0 }; // Cache timezone for 5 minutes

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
      keepAliveIntervalMs: 15000, // Send ping every 15 seconds (more aggressive)
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
   * Get the timezone setting from database with caching
   * @returns {Promise<string>} Timezone string (e.g., 'America/New_York')
   */
  async getTimezone() {
    const now = Date.now();
    const cacheTimeout = 5 * 60 * 1000; // 5 minutes

    // Return cached value if still valid
    if (this.timezoneCache.value && (now - this.timezoneCache.lastUpdated) < cacheTimeout) {
      return this.timezoneCache.value;
    }

    let timezone = 'UTC';
    try {
      const timezoneConfig = await this.postgresService.getSetting('timezone');
      if (timezoneConfig && typeof timezoneConfig === 'object' && timezoneConfig.tz) {
        timezone = timezoneConfig.tz;
        Logger.debug(`Using timezone from database: ${timezone}`);
      } else if (process.env.TIMEZONE) {
        timezone = process.env.TIMEZONE;
        Logger.debug(`Using timezone from environment: ${timezone}`);
      } else {
        Logger.debug('Using default timezone: UTC');
      }
    } catch (error) {
      Logger.warning('Failed to get timezone setting, using default UTC:', error.message);
      timezone = process.env.TIMEZONE || 'UTC';
    }

    // Cache the result
    this.timezoneCache = { value: timezone, lastUpdated: now };
    return timezone;
  }

  /**
   * Invalidate the timezone cache (call when settings are updated)
   */
  invalidateTimezoneCache() {
    this.timezoneCache = { value: null, lastUpdated: 0 };
    Logger.debug('Timezone cache invalidated');
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

      Logger.debug(`getSenderDisplayName: isGroup=${isGroup}, jid=${jid}, pushName="${message.pushName || 'none'}", participant=${message.key.participant || 'none'}`);

      if (!jid) return message.pushName || 'Unknown';

      // Check cache first
      const cached = this.contactNameCache.get(jid);
      if (cached) return cached;

      let name = null;

      // Try pushName from message first (most reliable for display names)
      if (message.pushName && message.pushName.trim()) {
        name = message.pushName.trim();
        Logger.debug(`getSenderDisplayName: Found pushName: "${name}"`);
      } else {
        Logger.debug(`getSenderDisplayName: No pushName available (pushName="${message.pushName || 'undefined'}")`);
      }

      // Try PostgreSQL lookup if no pushName and we have a sender ID
      if (!name && this.postgresService) {
        try {
          const senderId = message.key.participant || message.key.remoteJid;
          const chatId = message.key.remoteJid;

          if (senderId) {
            const storedName = await this.postgresService.getWhatsAppDisplayName(senderId, chatId);
            if (storedName) {
              name = storedName;
              Logger.debug(`getSenderDisplayName: Found stored display name: "${name}" for ${senderId}`);
            }
          }
        } catch (error) {
          Logger.debug(`getSenderDisplayName: Error fetching stored display name:`, error.message);
        }
      }

      // Try to get name from Baileys store if still no name
      if (!name) {
        try {
          const contacts = this.store && this.store.contacts;
          Logger.debug(`getSenderDisplayName: Checking Baileys store, contacts available: ${!!contacts}`);
          if (contacts) {
            let c = null;
            if (typeof contacts.get === 'function') {
              c = contacts.get(jid) || null;
              Logger.debug(`getSenderDisplayName: contacts.get(${jid}) result:`, c);
            } else if (contacts[jid]) {
              c = contacts[jid];
              Logger.debug(`getSenderDisplayName: Direct contacts[${jid}] result:`, c);
            } else if (typeof contacts.all === 'function') {
              const all = contacts.all();
              c = Array.isArray(all) ? all.find(x => x && (x.id === jid || x.jid === jid)) : null;
              Logger.debug(`getSenderDisplayName: contacts.all() search result:`, c);
            }
            if (c) {
              name = c.name || c.notify || c.vname || c.verifiedName || null;
              Logger.debug(`getSenderDisplayName: Extracted name from store contact: "${name}"`);
            }
          }
        } catch (err) {
          Logger.debug(`getSenderDisplayName: Error accessing Baileys store:`, err.message);
        }
      }

      // For group messages, fetch live group metadata
      if (!name && isGroup) {
        const participantJid = message.key.participant || jid;
        Logger.debug(`getSenderDisplayName: Fetching live group metadata for ${message.key.remoteJid}`);
        if (this.sock && typeof this.sock.groupMetadata === 'function') {
          try {
            const meta = await this.sock.groupMetadata(message.key.remoteJid);
            if (meta && Array.isArray(meta.participants)) {
              const p = meta.participants.find(p => p && p.id === participantJid);
              if (p) {
                Logger.debug(`getSenderDisplayName: Participant object structure:`, JSON.stringify(p, null, 2));
                name = p.name || p.notify || p.vname || p.verifiedName || null;
                Logger.debug(`getSenderDisplayName: Found name from live metadata: "${name}" for ${participantJid}`);
              }
            }
          } catch (err) {
            Logger.debug(`getSenderDisplayName: Error fetching live group metadata:`, err.message);
          }
        }
      }

      // Try to fetch contact info directly from WhatsApp if we still don't have a name
      if (!name && this.sock && typeof this.sock.onWhatsApp === 'function') {
        try {
          Logger.debug(`getSenderDisplayName: Trying onWhatsApp query for ${jid}`);
          const [onWaResult] = await this.sock.onWhatsApp(jid);
          Logger.debug(`getSenderDisplayName: onWhatsApp result:`, onWaResult);
          if (onWaResult && onWaResult.exists) {
            name = onWaResult.name || null;
            Logger.debug(`getSenderDisplayName: Extracted name from onWhatsApp: "${name}"`);
          }
        } catch (err) {
          Logger.debug(`getSenderDisplayName: Error with onWhatsApp query:`, err.message);
        }
      }

      // Fallback: use the phone number part before @
      if (!name) {
        Logger.debug(`getSenderDisplayName: Using fallback to phone number for ${jid}`);
        const phoneNumber = String(jid).split('@')[0];
        // Format phone numbers nicely (add + if it looks like a phone number)
        if (/^\d+$/.test(phoneNumber) && phoneNumber.length > 8) {
          name = `+${phoneNumber}`;
        } else {
          name = phoneNumber;
        }
        Logger.debug(`getSenderDisplayName: Fallback name: "${name}"`);
      }

      // Cache the resolved name (cache for 30 minutes to allow for updates)
      this.contactNameCache.set(jid, name);

      // Set a timeout to clear this cache entry after 30 minutes
      setTimeout(() => {
        this.contactNameCache.delete(jid);
      }, 30 * 60 * 1000);

      Logger.debug(`getSenderDisplayName resolved: "${name}" for jid: ${jid}`);
      return name;
    } catch (error) {
      Logger.warning('Error resolving sender display name:', error.message);
      return message.pushName || 'Unknown';
    }
  }

  /**
   * Get sender display name specifically for reactions using the reaction key
   * @param {Object} reactionKey - The reaction key from WhatsApp
   */
  async getReactionSenderName(reactionKey) {
    try {
      const isGroup = typeof reactionKey.remoteJid === 'string' && reactionKey.remoteJid.endsWith('@g.us');
      const jid = reactionKey.fromMe
        ? (this.sock && this.sock.user ? this.sock.user.id : reactionKey.remoteJid)
        : (isGroup ? (reactionKey.participant || reactionKey.remoteJid) : reactionKey.remoteJid);

      Logger.debug(`getReactionSenderName: isGroup=${isGroup}, jid=${jid}, fromMe=${reactionKey.fromMe}`);

      if (!jid) return 'Unknown';

      // Check cache first
      const cached = this.contactNameCache.get(jid);
      if (cached) return cached;

      let name = null;

      // Try to get name from Baileys store
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

      // Try PostgreSQL lookup if no name from Baileys store
      if (!name && this.postgresService) {
        try {
          const senderId = jid;
          const chatId = reactionKey.remoteJid;

          if (senderId) {
            const storedName = await this.postgresService.getWhatsAppDisplayName(senderId, chatId);
            if (storedName) {
              name = storedName;
              Logger.debug(`getReactionSenderName: Found stored display name: "${name}" for ${senderId}`);
            }
          }
        } catch (error) {
          Logger.debug(`getReactionSenderName: Error fetching stored display name:`, error.message);
        }
      }

      // For group messages, fetch live group metadata
      if (!name && isGroup) {
        const participantJid = reactionKey.participant || jid;
        Logger.debug(`getReactionSenderName: Fetching live group metadata for ${reactionKey.remoteJid}`);
        if (this.sock && typeof this.sock.groupMetadata === 'function') {
          try {
            const meta = await this.sock.groupMetadata(reactionKey.remoteJid);
            if (meta && Array.isArray(meta.participants)) {
              const p = meta.participants.find(p => p && p.id === participantJid);
              if (p) {
                Logger.debug(`getReactionSenderName: Participant object structure:`, JSON.stringify(p, null, 2));
                name = p.name || p.notify || p.vname || p.verifiedName || null;
                Logger.debug(`getReactionSenderName: Found name from live metadata: "${name}" for ${participantJid}`);
              }
            }
          } catch (err) {
            Logger.debug(`getReactionSenderName: Error fetching live group metadata:`, err.message);
          }
        }
      }

      // Try to fetch contact info directly from WhatsApp if we still don't have a name
      if (!name && this.sock && typeof this.sock.onWhatsApp === 'function') {
        try {
          Logger.debug(`getSenderDisplayName: Trying onWhatsApp query for ${jid}`);
          const [onWaResult] = await this.sock.onWhatsApp(jid);
          Logger.debug(`getSenderDisplayName: onWhatsApp result:`, onWaResult);
          if (onWaResult && onWaResult.exists) {
            name = onWaResult.name || null;
            Logger.debug(`getSenderDisplayName: Extracted name from onWhatsApp: "${name}"`);
          }
        } catch (err) {
          Logger.debug(`getSenderDisplayName: Error with onWhatsApp query:`, err.message);
        }
      }

      // Fallback: use the phone number part before @
      if (!name) {
        Logger.debug(`getSenderDisplayName: Using fallback to phone number for ${jid}`);
        const phoneNumber = String(jid).split('@')[0];
        // Format phone numbers nicely (add + if it looks like a phone number)
        if (/^\d+$/.test(phoneNumber) && phoneNumber.length > 8) {
          name = `+${phoneNumber}`;
        } else {
          name = phoneNumber;
        }
        Logger.debug(`getSenderDisplayName: Fallback name: "${name}"`);
      }

      // Cache the resolved name
      this.contactNameCache.set(jid, name);

      // Set a timeout to clear this cache entry after 30 minutes
      setTimeout(() => {
        this.contactNameCache.delete(jid);
      }, 30 * 60 * 1000);

      Logger.debug(`getReactionSenderName resolved: "${name}" for jid: ${jid}`);
      return name;
    } catch (error) {
      Logger.warning('Error resolving reaction sender display name:', error.message);
      return 'Unknown';
    }
  }

  /**
   * Initialize group metadata caching system
   */
  async initializeGroupMetadataCache() {
    if (!this.isConnected || !this.sock) {
      Logger.debug('Cannot initialize group metadata cache - not connected');
      return;
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

        // Initialize group metadata cache after successful connection
        setTimeout(() => {
          this.initializeGroupMetadataCache().catch(error => {
            Logger.warning('Failed to initialize group metadata cache:', error);
          });
        }, 2000); // Wait 2 seconds for connection to stabilize
        this.reconnectAttempts = 0; // Reset reconnection attempts on successful connection
        this.sessionManager.qrCodeSent = false; // Reset QR code sent flag on successful connection
        this.qrRequestedOnDemand = false; // Reset on-demand QR flag on successful connection
        this.startupNotificationSent = false; // Reset startup notification flag on successful connection
        this.sessionManager.cancelSessionRestoreTimeout();
        // Clear any pending reconnection timers
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
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
          Logger.info('Connection closed but not logged out - initiating automatic reconnection...');
          // Implement actual reconnection logic instead of just waiting
          try {
            const alertKey = 'wa_connection_closed';
            const withinQrCooldown = Date.now() <= this.qrSuppressAlertsUntil;
            const suppress = this.qrRequestedOnDemand || withinQrCooldown || this.isShuttingDown;
            if (!suppress && this.discordClient && this.config.discord.adminChannelId && (!this.canSendAdminAlert || this.canSendAdminAlert(alertKey))) {
              await this.sendAdminNotification('Disconnected from WhatsApp (temporary). Attempting to reconnect automatically...', 'warning');
            } else if (suppress) {
              Logger.info('Skipping temporary disconnect alert due to QR flow or shutdown');
            }

            // Start automatic reconnection process
            this.scheduleReconnection();
          } catch (_) {}
        }
      }
    });

    // Message handling: forward messages with conversational content and reactions
    this.sock.ev.on('messages.upsert', async (m) => {
      const message = m.messages?.[0];
      if (!message) return;

      // Verbose debug logging for incoming messages
      Logger.debug('=== INCOMING MESSAGE DEBUG ===');
      Logger.debug('Message type:', m.type);
      Logger.debug('Full message object:', JSON.stringify(message, null, 2));
      Logger.debug('pushName:', message.pushName);
      Logger.debug('message.key:', JSON.stringify(message.key, null, 2));
      Logger.debug('message.key.participant:', message.key.participant);
      Logger.debug('message.key.remoteJid:', message.key.remoteJid);
      Logger.debug('message.key.fromMe:', message.key.fromMe);
      Logger.debug('=== END MESSAGE DEBUG ===');

      const msg = message.message || {};
      const hasText = !!(msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption);
      const hasMedia = !!(msg.imageMessage || msg.videoMessage || msg.audioMessage || msg.documentMessage);
      const hasReaction = !!(msg.reactionMessage);
      const isNotify = m.type === 'notify';

      // Debug hasText evaluation
      Logger.debug('🔍 hasText evaluation debug:', {
        'msg.conversation': msg.conversation,
        'msg.extendedTextMessage?.text': msg.extendedTextMessage?.text,
        'msg.imageMessage?.caption': msg.imageMessage?.caption,
        'msg.videoMessage?.caption': msg.videoMessage?.caption,
        'hasText computed': hasText
      });

      // Upsert pushName mapping to PostgreSQL database when we receive a message
      Logger.debug('=== PUSHNAME UPSERT DEBUG ===');
      Logger.debug('message.pushName exists:', !!message.pushName);
      Logger.debug('message.pushName value:', message.pushName);
      Logger.debug('message.pushName trimmed:', message.pushName?.trim());
      Logger.debug('postgresService exists:', !!this.postgresService);

      if (message.pushName && message.pushName.trim() && this.postgresService) {
        try {
          const senderId = message.key.participant || message.key.remoteJid;
          const chatId = message.key.remoteJid;

          Logger.debug('Calculated senderId:', senderId);
          Logger.debug('Calculated chatId:', chatId);
          Logger.debug('About to upsert with values:', {
            senderId,
            displayName: message.pushName.trim(),
            chatId
          });

          if (senderId && chatId) {
            await this.postgresService.upsertWhatsAppDisplayName(
              senderId,
              message.pushName.trim(),
              chatId
            );
            Logger.debug(`✅ Upserted pushName mapping: ${senderId} -> "${message.pushName.trim()}" in chat ${chatId}`);
          } else {
            Logger.debug('❌ Skipping upsert - missing senderId or chatId');
          }
        } catch (error) {
          Logger.error('❌ Failed to upsert pushName mapping:', error);
        }
      } else {
        Logger.debug('❌ Skipping upsert - pushName missing/empty or no postgresService');
      }
      Logger.debug('=== END PUSHNAME UPSERT DEBUG ===');

      // Check message filtering criteria
      const willForward = (hasText || hasMedia || hasReaction) && (isNotify || message.key.fromMe);
      Logger.debug('📋 Message filtering criteria:', {
        hasText,
        hasMedia,
        hasReaction,
        isNotify,
        fromMe: message.key.fromMe,
        willForward,
        messageKey: message.key
      });

      // Handle messages with content or reactions
      if (willForward) {
        Logger.debug('✅ Forwarding message to Discord via handleMessage()');
        await this.messageHandler.handleMessage(message);
      } else {
        Logger.debug('❌ Message filtered out, not forwarding to Discord');
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

      // Perform more frequent keepalive operations
      const now = Date.now();

      // Send presence updates every 2 minutes (more aggressive than 5 minutes)
      if (!this.lastKeepAlive || (now - this.lastKeepAlive) > 120000) { // 2 minutes
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

      // Perform proactive activity simulation every 10 minutes
      if (!this.lastProactiveActivity || (now - this.lastProactiveActivity) > 600000) { // 10 minutes
        try {
          await this.performProactiveKeepalive();
          this.lastProactiveActivity = now;
        } catch (proactiveError) {
          Logger.warning('Proactive keepalive failed:', proactiveError.message);
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

  /**
   * Send a reaction to a WhatsApp message (for reverse reaction flow from Discord)
   * @param {string} chatId - The WhatsApp chat ID
   * @param {Object} messageKey - The WhatsApp message key to react to
   * @param {string} emoji - The emoji to react with (empty string to remove reaction)
   * @returns {Promise<Object|null>} The sent reaction message or null if failed
   */
  async sendReaction(chatId, messageKey, emoji) {
    try {
      if (!this.sock || !this.isConnected) {
        Logger.warning('WhatsApp not connected, cannot send reaction');
        return null;
      }

      if (!chatId || !messageKey) {
        Logger.error('Missing chatId or messageKey for reaction');
        return null;
      }

      Logger.debug(`Sending reaction to WhatsApp: ${emoji || '(remove)'} on message in chat ${chatId}`);

      const reactionMessage = {
        react: {
          text: emoji || '', // Empty string removes the reaction
          key: messageKey
        }
      };

      const sentReaction = await this.sock.sendMessage(chatId, reactionMessage);

      if (emoji) {
        Logger.success(`Reaction ${emoji} sent successfully to WhatsApp message`);
      } else {
        Logger.success('Reaction removed successfully from WhatsApp message');
      }

      return sentReaction;
    } catch (error) {
      Logger.error('Failed to send reaction to WhatsApp:', error);
      return null;
    }
  }

  /**
   * Perform proactive keepalive activity to simulate real usage
   */
  async performProactiveKeepalive() {
    try {
      if (!this.sock || !this.isConnected) return;

      // Send typing indicator to self (doesn't create actual messages)
      const userJid = this.sock.user.id;
      await this.sock.sendPresenceUpdate('composing', userJid);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.sock.sendPresenceUpdate('available', userJid);

      Logger.debug('Proactive keepalive activity sent (typing simulation)');
    } catch (error) {
      Logger.warning('Proactive keepalive failed:', error.message);
    }
  }

  /**
   * Schedule automatic reconnection with exponential backoff
   */
  scheduleReconnection() {
    try {
      // Don't reconnect if already attempting or if shutting down
      if (this.reconnectTimer || this.isShuttingDown) {
        Logger.debug('Reconnection already scheduled or shutting down');
        return;
      }

      // Check if we've exceeded max attempts
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        Logger.error(`Maximum reconnection attempts (${this.maxReconnectAttempts}) reached. Manual intervention may be required.`);
        this.sendAdminNotification(
          `Failed to reconnect after ${this.maxReconnectAttempts} attempts. Please check the connection manually.`,
          'error'
        );
        return;
      }

      this.reconnectAttempts++;
      // Exponential backoff: 5s, 10s, 20s, 40s, 80s
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      Logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

      this.reconnectTimer = setTimeout(async () => {
        this.reconnectTimer = null;
        try {
          Logger.info(`Attempting automatic reconnection (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          await this.reconnectWithExistingSession();
        } catch (error) {
          Logger.error('Automatic reconnection failed:', error);
          // Schedule next attempt if we haven't exceeded max attempts
          this.scheduleReconnection();
        }
      }, delay);
    } catch (error) {
      Logger.error('Error scheduling reconnection:', error);
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

      // Clear any pending reconnection timers
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
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
      Logger.warning('Connection lost, initiating automatic reconnection...');
      await this.sendDiscordAlert('🔄 **WhatsApp Connection Lost**', 'Connection lost, attempting to reconnect automatically...', 'connection_lost');

      // Start automatic reconnection process through main service
      if (this.whatsappService && typeof this.whatsappService.scheduleReconnection === 'function') {
        this.whatsappService.scheduleReconnection();
      } else {
        Logger.warning('Cannot schedule reconnection: main WhatsApp service not available');
      }
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
        await this.handleReaction(message);
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

      // Check if this message is a reply to another message
      let isReply = false;
      let replyToMessageId = null;
      let replyToDiscordMessageId = null;
      let quotedMessageInfo = null;

      // Check for quoted/reply message in different message types
      const contextInfo = messageContent?.extendedTextMessage?.contextInfo ||
                         messageContent?.imageMessage?.contextInfo ||
                         messageContent?.videoMessage?.contextInfo ||
                         messageContent?.audioMessage?.contextInfo ||
                         messageContent?.documentMessage?.contextInfo;

      if (contextInfo && contextInfo.quotedMessage && contextInfo.stanzaId) {
        isReply = true;
        replyToMessageId = contextInfo.stanzaId;

        // Try to get the Discord message ID for the quoted message
        replyToDiscordMessageId = await this.postgresService.getDiscordMessageIdByWhatsAppId(replyToMessageId);

        // Get quoted message info for display
        const quotedMsg = contextInfo.quotedMessage;
        const quotedText = quotedMsg.conversation ||
                          quotedMsg.extendedTextMessage?.text ||
                          quotedMsg.imageMessage?.caption ||
                          quotedMsg.videoMessage?.caption ||
                          (quotedMsg.imageMessage ? '[Image]' : '') ||
                          (quotedMsg.videoMessage ? '[Video]' : '') ||
                          (quotedMsg.audioMessage ? '[Audio]' : '') ||
                          (quotedMsg.documentMessage ? '[Document]' : '') ||
                          '[Media]';

        // Get sender name for the quoted message
        let quotedSenderName = 'Unknown';
        if (contextInfo.participant) {
          try {
            // Create a pseudo-message object to get the sender name
            const quotedSenderMessage = {
              key: {
                participant: contextInfo.participant,
                remoteJid: chatId,
                fromMe: contextInfo.participant === (this.sock?.user?.id)
              },
              pushName: contextInfo.participant.split('@')[0] // fallback
            };
            quotedSenderName = await this.whatsappService.getSenderDisplayName(quotedSenderMessage);
          } catch (e) {
            Logger.debug('Could not resolve quoted message sender name:', e.message);
            quotedSenderName = contextInfo.participant.split('@')[0];
          }
        }

        quotedMessageInfo = {
          text: quotedText.length > 800 ? quotedText.substring(0, 800) + '...' : quotedText,
          participant: contextInfo.participant || 'Unknown',
          senderName: quotedSenderName
        };

        Logger.info('Detected reply message:', {
          replyToId: replyToMessageId,
          hasDiscordMapping: !!replyToDiscordMessageId,
          quotedText: quotedMessageInfo.text,
          quotedSender: quotedSenderName
        });
      }
      
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
        : await this.whatsappService.getSenderDisplayName(message);
      Logger.debug(`Resolved sender name: "${senderName}" for message from ${message.key.fromMe ? 'me' : message.key.participant || message.key.remoteJid}`);
      // Get timezone from database settings with caching
      const timezone = await this.whatsappService.getTimezone();

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
          
          let discordMessage = `**${senderName}** *(${timestamp})*\n📎 ${mimetype} file`;

          // Add reply formatting if this is a reply
          if (isReply && quotedMessageInfo) {
            discordMessage = `**${senderName}** *(${timestamp})* replying to **${quotedMessageInfo.senderName}**:\n> ${quotedMessageInfo.text}\n\n📎 ${mimetype} file`;

            // Ensure Discord message doesn't exceed 2000 character limit
            if (discordMessage.length > 2000) {
              const baseMessage = `**${senderName}** *(${timestamp})* replying to **${quotedMessageInfo.senderName}**:\n> \n\n📎 ${mimetype} file`;
              const maxQuotedLength = 2000 - baseMessage.length - 3; // -3 for "..."
              const truncatedQuoted = quotedMessageInfo.text.substring(0, maxQuotedLength) + '...';
              discordMessage = `**${senderName}** *(${timestamp})* replying to **${quotedMessageInfo.senderName}**:\n> ${truncatedQuoted}\n\n📎 ${mimetype} file`;
            }
          }

          Logger.info('Sending media message to Discord...');

          // Prepare Discord message options
          const messageOptions = {
            content: discordMessage,
            files: [attachment]
          };

          // If we have a Discord message ID to reply to, use Discord's reply feature
          if (isReply && replyToDiscordMessageId) {
            try {
              const replyToMessage = await discordChannel.messages.fetch(replyToDiscordMessageId);
              if (replyToMessage) {
                messageOptions.reply = { messageReference: replyToMessage };
                Logger.info(`Replying to Discord message: ${replyToDiscordMessageId}`);
              }
            } catch (fetchError) {
              Logger.warning(`Could not fetch Discord message ${replyToDiscordMessageId} for reply:`, fetchError.message);
              // Continue without Discord reply feature, but keep the visual reply formatting
            }
          }

          const sentMessage = await discordChannel.send(messageOptions);
          
          Logger.success(`Media message sent to Discord: ${sentMessage.id}`);
          
          // Store in DB (always enabled)
          try {
            Logger.debug(`Storing WhatsApp message: ${message.key?.id} -> Discord: ${sentMessage.id}`);
            const normalized = {
              id: { _serialized: message.key?.id || '' },
              from: message.key?.remoteJid,
              _data: { notifyName: message.pushName || '' },
              body,
              type: Object.keys(messageContent || {})[0] || 'unknown',
              key: message.key
            };
            await this.postgresService.storeWhatsAppMessage(
              normalized,
              sentMessage.id,
              this.config.discord.guildId,
              replyToMessageId,
              replyToDiscordMessageId
            );
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
        let discordMessage = `**${senderName}** *(${timestamp})*\n${messageText}`;

        // Add reply formatting if this is a reply
        if (isReply && quotedMessageInfo) {
          discordMessage = `**${senderName}** *(${timestamp})* replying to **${quotedMessageInfo.senderName}**:\n> ${quotedMessageInfo.text}\n\n${messageText}`;

          // Ensure Discord message doesn't exceed 2000 character limit
          if (discordMessage.length > 2000) {
            const baseMessage = `**${senderName}** *(${timestamp})* replying to **${quotedMessageInfo.senderName}**:\n> \n\n${messageText}`;
            const maxQuotedLength = 2000 - baseMessage.length - 3; // -3 for "..."
            if (maxQuotedLength > 0) {
              const truncatedQuoted = quotedMessageInfo.text.substring(0, maxQuotedLength) + '...';
              discordMessage = `**${senderName}** *(${timestamp})* replying to **${quotedMessageInfo.senderName}**:\n> ${truncatedQuoted}\n\n${messageText}`;
            } else {
              // If even the base message is too long, truncate the new message instead
              const availableLength = 2000 - `**${senderName}** *(${timestamp})* replying to **${quotedMessageInfo.senderName}**:\n> [Quote too long]\n\n`.length - 3;
              const truncatedMessage = messageText.substring(0, availableLength) + '...';
              discordMessage = `**${senderName}** *(${timestamp})* replying to **${quotedMessageInfo.senderName}**:\n> [Quote too long]\n\n${truncatedMessage}`;
            }
          }
        }

        // Prepare Discord message options
        const messageOptions = { content: discordMessage };

        // If we have a Discord message ID to reply to, use Discord's reply feature
        if (isReply && replyToDiscordMessageId) {
          try {
            const replyToMessage = await discordChannel.messages.fetch(replyToDiscordMessageId);
            if (replyToMessage) {
              messageOptions.reply = { messageReference: replyToMessage };
              Logger.info(`Replying to Discord message: ${replyToDiscordMessageId}`);
            }
          } catch (fetchError) {
            Logger.warning(`Could not fetch Discord message ${replyToDiscordMessageId} for reply:`, fetchError.message);
            // Continue without Discord reply feature, but keep the visual reply formatting
          }
        }

        const sentMessage = await discordChannel.send(messageOptions);
        
        Logger.success(`Text message sent to Discord: ${sentMessage.id}`);
        
        // Store in DB (always enabled)
        try {
          Logger.debug(`Storing WhatsApp message: ${message.key?.id} -> Discord: ${sentMessage.id}`);
          const normalized = {
            id: { _serialized: message.key?.id || '' },
            from: message.key?.remoteJid,
            _data: { notifyName: message.pushName || '' },
            body: messageText,
            type: 'chat',
            key: message.key
          };
          await this.postgresService.storeWhatsAppMessage(
            normalized,
            sentMessage.id,
            this.config.discord.guildId,
            replyToMessageId,
            replyToDiscordMessageId
          );
        } catch (_) {}
      }
      
    } catch (error) {
      Logger.error('Failed to process message:', error);
    }
  }

  /**
   * Handle WhatsApp reactions and map them to Discord reactions
   * @param {Object} message - WhatsApp reaction message
   */
  async handleReaction(message) {
    try {
      // Skip reactions that came from us (sent from Discord → WhatsApp)
      if (message.key.fromMe) {
        Logger.debug('Skipping reaction from self (sent from Discord → WhatsApp)');
        return;
      }

      const messageContent = message.message;
      const reactionMessage = messageContent.reactionMessage;

      if (!reactionMessage) {
        Logger.warning('Reaction message content is missing');
        return;
      }

      const chatId = message.key.remoteJid;
      const discordChannelId = await this.postgresService.getDiscordChannelForChat(chatId);
      if (!discordChannelId) {
        Logger.warning(`No Discord channel found for WhatsApp chat: ${chatId}`);
        return;
      }

      const discordChannel = this.discordClient.channels.cache.get(discordChannelId);
      if (!discordChannel) {
        Logger.error(`Discord channel not found: ${discordChannelId}`);
        return;
      }

      const emoji = reactionMessage.text || reactionMessage.emoji || '';
      const referencedKey = reactionMessage.key || {};
      const originalWhatsAppMessageId = referencedKey.id || '';

      // Debug logging for reaction message ID lookup
      Logger.debug('WhatsApp reaction processing:', {
        emoji,
        referencedKey,
        originalWhatsAppMessageId,
        reactionMessageKey: message.key,
        fullReactionMessage: reactionMessage
      });

      if (!originalWhatsAppMessageId) {
        Logger.warning('Original WhatsApp message ID not found in reaction');
        return;
      }

      // Get the Discord message ID for the original WhatsApp message
      const originalDiscordMessageId = await this.postgresService.getDiscordMessageIdByWhatsAppId(originalWhatsAppMessageId);

      if (!originalDiscordMessageId) {
        Logger.warning(`No Discord message found for WhatsApp message ID: ${originalWhatsAppMessageId}`);

        // Fallback: send a text message about the reaction
        const isFromMeReaction = message.key.fromMe || false;
        const reactorName = isFromMeReaction
          ? 'You'
          : await this.whatsappService.getReactionSenderName(message.key);

        const fallbackText = `**${reactorName}** reacted with ${emoji} to a message (original message not found in Discord)`;
        await discordChannel.send(fallbackText);
        return;
      }

      try {
        // Fetch the original Discord message
        const originalDiscordMessage = await discordChannel.messages.fetch(originalDiscordMessageId);

        if (!originalDiscordMessage) {
          Logger.warning(`Could not fetch Discord message: ${originalDiscordMessageId}`);
          return;
        }

        // Map WhatsApp emoji to Discord-compatible emoji
        const discordEmoji = this.mapWhatsAppEmojiToDiscord(emoji);

        // Check if this is a reaction removal (empty emoji)
        if (!emoji || emoji.trim() === '') {
          // For reaction removal, reply to the original message with sender info
          const isFromMeReaction = message.key.fromMe || false;
          const reactorName = isFromMeReaction
            ? 'You'
            : await this.whatsappService.getReactionSenderName(message.key);

          const removalText = `**${reactorName}** removed their reaction`;
          await originalDiscordMessage.reply(removalText);
          Logger.info(`Reaction removal for message ${originalDiscordMessageId} - sent reply notification`);
          return;
        }

        // Instead of native Discord reactions, send a text message with sender info
        const isFromMeReaction = message.key.fromMe || false;
        const reactorName = isFromMeReaction
          ? 'You'
          : await this.whatsappService.getReactionSenderName(message.key);

        const reactionText = `**${reactorName}** reacted with ${emoji}`;
        await originalDiscordMessage.reply(reactionText);

        Logger.success(`Sent reaction message for ${reactorName} with ${emoji} on Discord message ${originalDiscordMessageId}`);

      } catch (reactionError) {
        Logger.error(`Failed to add reaction to Discord message ${originalDiscordMessageId}:`, reactionError.message);

        // Fallback: send a text message about the reaction
        const isFromMeReaction = message.key.fromMe || false;
        const reactorName = isFromMeReaction
          ? 'You'
          : await this.whatsappService.getReactionSenderName(message.key);

        const fallbackText = `**${reactorName}** reacted with ${emoji} to a message`;
        await discordChannel.send(fallbackText);
      }

    } catch (error) {
      Logger.error('Failed to handle WhatsApp reaction:', error);
    }
  }

  /**
   * Map WhatsApp emoji to Discord-compatible emoji
   * @param {string} whatsappEmoji - WhatsApp emoji
   * @returns {string} Discord-compatible emoji
   */
  mapWhatsAppEmojiToDiscord(whatsappEmoji) {
    // Common emoji mappings
    const emojiMap = {
      '👍': '👍',
      '👎': '👎',
      '❤️': '❤️',
      '😂': '😂',
      '😮': '😮',
      '😢': '😢',
      '😡': '😡',
      '🔥': '🔥',
      '💯': '💯',
      '🎉': '🎉',
      '💔': '💔',
      '😍': '😍',
      '🤔': '🤔',
      '👏': '👏',
      '🙏': '🙏',
      '✅': '✅',
      '❌': '❌',
      '⭐': '⭐',
      '💖': '💖',
      '🤣': '🤣',
      '😊': '😊',
      '😘': '😘',
      '🥰': '🥰',
      '😭': '😭',
      '🤮': '🤮',
      '🤯': '🤯',
      '🙄': '🙄',
      '😴': '😴',
      '🤩': '🤩',
      '🤪': '🤪'
    };

    // Return mapped emoji or original if no mapping found
    return emojiMap[whatsappEmoji] || whatsappEmoji;
  }

}

module.exports = WhatsAppService;
