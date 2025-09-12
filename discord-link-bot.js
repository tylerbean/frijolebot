// Main application entry point
async function main() {
  // Dynamic imports to handle ES module compatibility
  const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, Partials, MessageFlags } = await import('discord.js');
  const fs = require('fs');
  const path = require('path');
  const config = require('./config');
  const PostgreSQLService = require('./services/PostgreSQLService');
  const CacheService = require('./services/CacheService');
  const HealthCheckService = require('./services/HealthCheckService');
  const WhatsAppService = require('./services/WhatsAppService');
  const MessageHandler = require('./handlers/messageHandler');
  const ReactionHandler = require('./handlers/reactionHandler');
  const CommandHandler = require('./handlers/commandHandler');
  const Logger = require('./utils/logger');

Logger.startup('Bot starting...');

  // Run lock handling to detect ungraceful previous shutdowns
  const RUN_LOCK_PATH = path.join(process.cwd(), 'run.lock');
  let previousUncleanShutdown = false;
  let previousRunInfo = null;
  try {
    if (fs.existsSync(RUN_LOCK_PATH)) {
      previousUncleanShutdown = true;
      try {
        const raw = fs.readFileSync(RUN_LOCK_PATH, 'utf-8');
        previousRunInfo = JSON.parse(raw);
      } catch (_) {
        // ignore parse errors
      }
    }
    const currentLock = { pid: process.pid, startedAt: new Date().toISOString() };
    fs.writeFileSync(RUN_LOCK_PATH, JSON.stringify(currentLock));
    Logger.info('Run lock created');
  } catch (e) {
    Logger.warning(`Failed to manage run.lock: ${e.message}`);
  }

// Initialize services
const postgresService = new PostgreSQLService(config.postgres);
let cacheService;

// Initialize database schema
await postgresService.initializeDatabase();

// Load admin settings (discord/whatsapp/rateLimit/caching) before cache init
const settings = { discord: { enabled: false }, whatsapp: { enabled: false, storeMessages: false } };
try {
  const discordRow = await postgresService.pool.query('SELECT value FROM app_settings WHERE key = $1', ['discord']);
  const whatsappRow = await postgresService.pool.query('SELECT value FROM app_settings WHERE key = $1', ['whatsapp']);
  const rateLimitRow = await postgresService.pool.query('SELECT value FROM app_settings WHERE key = $1', ['rateLimit']);
  const cachingRow = await postgresService.pool.query('SELECT value FROM app_settings WHERE key = $1', ['caching']);
  if (discordRow.rows[0]?.value) Object.assign(settings, { discord: { enabled: !!discordRow.rows[0].value.enabled, token: discordRow.rows[0].value.token, guildId: discordRow.rows[0].value.guildId, adminChannelId: discordRow.rows[0].value.adminChannelId } });
  if (whatsappRow.rows[0]?.value) Object.assign(settings, { whatsapp: { enabled: !!whatsappRow.rows[0].value.enabled, storeMessages: !!whatsappRow.rows[0].value.storeMessages } });
  if (rateLimitRow.rows[0]?.value) config.rateLimit = {
    windowMs: ((rateLimitRow.rows[0].value.windowSec || 60) * 1000),
    maxRequests: rateLimitRow.rows[0].value.maxRequests || 5,
    cleanupInterval: ((rateLimitRow.rows[0].value.cleanupIntervalSec || 300) * 1000),
    enabled: rateLimitRow.rows[0].value.enabled !== false
  };
  if (cachingRow.rows[0]?.value) config.caching = cachingRow.rows[0].value;
} catch (_) {}

// Initialize cache using Admin settings (fallback to env)
cacheService = new CacheService(config.caching?.redisUrl || process.env.REDIS_URL);
await cacheService.initialize();

// Create Discord client (will only login when enabled via settings)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

// Initialize handlers (CommandHandler needs client, so it's initialized later)
const reactionHandler = new ReactionHandler(postgresService, config);
const messageHandler = new MessageHandler(postgresService);
let commandHandler; // Will be initialized after client is ready
let healthCheckService; // Will be initialized after client is ready
let whatsappService; // Will be initialized after client is ready



// Define slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('unread')
        .setDescription('Get a list of unread links shared by others')
        .setDMPermission(true),
    new SlashCommandBuilder()
        .setName('whatsapp_auth')
        .setDescription('Request WhatsApp QR code for authentication')
        .setDMPermission(false),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show bot status: DB, WhatsApp, monitored channels/chats')
        .setDMPermission(false)
];

// Register slash commands
async function registerCommands(token) {
    const rest = new REST({ version: '10' }).setToken(token);
    
    try {
        Logger.startup('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, settings.discord.guildId),
            { body: commands }
        );
        
        Logger.success('Successfully reloaded application (/) commands.');
        Logger.info(`Registered ${commands.length} commands:`, commands.map(cmd => cmd.name));
    } catch (error) {
        Logger.error('Error registering commands:', error);
    }
}

// Bot ready event
async function executeReadyLogic() {
    Logger.info('Ready event fired!');
    Logger.success(`Bot logged in as ${client.user.tag}`);

    // Determine channels to monitor from DB before posting status
    let channelsToMonitor = [];
    try {
        const monitored = await postgresService.getActiveMonitoredChannels(settings.discord.guildId);
        channelsToMonitor = monitored.length > 0 ? monitored : config.discord.channelsToMonitor;
    } catch (_) {
        channelsToMonitor = [];
    }
    if (channelsToMonitor.length === 0) {
        Logger.warning('No monitored channels found (DB/env). LinkTracker will be idle until configured.');
    }
    // Send admin startup message and channel summary
    try {
        const adminChannel = client.channels.cache.get(settings.discord.adminChannelId);
        if (adminChannel) {
            await adminChannel.send(`🟢 **FrijoleBot started** on ${new Date().toISOString()}`);
            const lines = channelsToMonitor.map(id => {
                const ch = client.channels.cache.get(id);
                return ch ? `- #${ch.name} (${id})` : `- (unavailable) ${id}`;
            });
            await adminChannel.send(`🧭 **Link monitoring active in the following channels:**\n${lines.join('\n')}`);
            if (previousUncleanShutdown) {
              const info = previousRunInfo?.startedAt ? ` (previous start: ${previousRunInfo.startedAt})` : '';
              await adminChannel.send(`🟠 **Previous run did not shut down cleanly**${info}. Recovery checks performed.`);
            }
        } else {
            Logger.warning('Admin channel not found; startup messages not sent');
        }
    } catch (e) {
        Logger.error('Failed to send startup admin messages:', e);
    }
    
    // Ensure runtime config reflects admin settings for downstream services
    try {
        config.discord = config.discord || {};
        if (settings.discord?.guildId) config.discord.guildId = settings.discord.guildId;
        if (settings.discord?.adminChannelId) config.discord.adminChannelId = settings.discord.adminChannelId;
    } catch (_) {}

    // Initialize CommandHandler with Discord client
    commandHandler = new CommandHandler(postgresService, reactionHandler, config, client);
    
    // Initialize and start health check service
    healthCheckService = new HealthCheckService(client, postgresService, config);
    // expose WhatsApp service to health for chat listing if available later
    healthCheckService.whatsappService = whatsappService;
    healthCheckService.start();
    
    // Initialize WhatsApp service if enabled via admin settings
    Logger.info(`WhatsApp enabled: ${settings.whatsapp?.enabled}`);
    if (settings.whatsapp?.enabled) {
      try {
        Logger.info('Creating WhatsApp service...');
        whatsappService = new WhatsAppService(config, client, postgresService);
        Logger.info('WhatsApp service created, initializing...');
        await whatsappService.initialize();
        Logger.success('WhatsApp service initialized successfully');
      } catch (error) {
        Logger.error('Failed to initialize WhatsApp service:', error);
        Logger.error('Error details:', error.stack);
      }
    } else {
      Logger.info('WhatsApp service disabled');
    }
    
    // After potential WhatsApp init, attach service for health endpoint
    healthCheckService.whatsappService = whatsappService;
    // Register slash commands
    await registerCommands(settings.discord.token);
    
    // Log monitored channels once after we have the final list
    if (channelsToMonitor.length > 0) {
        // Warm cache for monitored channels and subscribe for invalidations
        try {
            await cacheService.set(`monitored:${settings.discord.guildId}`, channelsToMonitor, 60);
            await cacheService.subscribe('monitored.invalidate', async (msg) => {
                if (msg && msg.guildId && String(msg.guildId) === String(settings.discord.guildId)) {
                    const fresh = await postgresService.getActiveMonitoredChannels(settings.discord.guildId);
                    await cacheService.set(`monitored:${settings.discord.guildId}`, fresh, 60);
                    Logger.info(`Monitored channels cache refreshed for guild ${settings.discord.guildId}`);
                }
            });
            // Subscribe for feature flag invalidations
            await cacheService.subscribe('flags.invalidate', async (msg) => {
                try {
                    const keys = Array.isArray(msg?.keys) ? msg.keys : null;
                    postgresService.invalidateFlagCache(keys);
                    Logger.info('Feature flag cache invalidated', keys || 'all');
                } catch (_) {}
            });
        } catch (_) {}
        channelsToMonitor.forEach(channelId => {
            const channel = client.channels.cache.get(channelId);
            if (channel) {
                Logger.startup(`Monitoring channel: #${channel.name} (${channelId})`);
            } else {
                Logger.warning(`Channel ${channelId} not found or not accessible`);
            }
        });
    }
}

  // Set up ready event handler
  Logger.info('Setting up ready event handler...');
  Logger.info(`Client ready status: ${client.isReady()}`);

  if (client.isReady()) {
      Logger.info('Client is already ready, executing ready logic immediately...');
      await executeReadyLogic();
  } else {
      // Use clientReady for Discord.js v14.22.1+ compatibility
      client.once('clientReady', async () => {
          Logger.info('ClientReady event fired!');
          await executeReadyLogic();
      });
  }

// Helper to best-effort send an admin message during shutdown
async function sendShutdownNotice(message) {
    try {
        if (client && client.isReady && client.isReady()) {
            const ch = client.channels.cache.get(settings.discord.adminChannelId);
            if (ch) {
                await ch.send(message);
            }
        }
    } catch (_) {}
}

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'unread') {
        if (!commandHandler) {
            Logger.error('CommandHandler not initialized yet');
            await interaction.reply({
                content: '❌ Bot is still starting up. Please try again in a moment.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        await commandHandler.handleUnreadCommand(interaction);
    } else if (interaction.commandName === 'whatsapp_auth') {
        // Check if user has admin permissions (only in admin channel)
        if (interaction.channelId !== config.discord.adminChannelId) {
            await interaction.reply({
                content: '❌ This command can only be used in the admin channel.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (!whatsappService) {
            await interaction.reply({
                content: '❌ WhatsApp service is not enabled or not initialized.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Request QR code from WhatsApp service
            const qrResult = await whatsappService.requestQRCode();
            
            if (qrResult.success) {
                await interaction.editReply({
                    content: '✅ WhatsApp QR code has been generated and sent to this channel. Please scan it with your phone within 30 seconds.'
                });
            } else {
                await interaction.editReply({
                    content: `❌ Failed to generate QR code: ${qrResult.error}`
                });
            }
        } catch (error) {
            Logger.error('Error handling WhatsApp auth command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while generating the QR code. Please check the logs.'
            });
        }
    }
    else if (interaction.commandName === 'status') {
        // Restrict to admin channel
        const adminChannelId = settings.discord.adminChannelId || config.discord.adminChannelId;
        if (interaction.channelId !== adminChannelId) {
            await interaction.reply({ content: '❌ This command can only be used in the admin channel.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.deferReply({ ephemeral: false });
        try {
            // DB status
            let dbStatus = 'unknown';
            let dbRt = 0;
            try {
                const result = await postgresService.testConnection();
                dbStatus = result?.success ? 'connected' : 'error';
                dbRt = result?.responseTime || 0;
            } catch (_) {
                dbStatus = 'error';
            }

            // WhatsApp status
            const waConnected = !!(whatsappService && whatsappService.isConnected);
            const waInit = !!(whatsappService && whatsappService.isInitialized);

            // Monitored Discord channels (names)
            let monitored = [];
            try { monitored = await postgresService.getActiveMonitoredChannels(settings.discord.guildId); } catch (_) {}
            const channelLines = monitored.map(id => {
                const ch = client.channels.cache.get(id);
                return ch ? `• #${ch.name} (${id})` : `• (unavailable) ${id}`;
            });

            // Monitored WhatsApp chats
            let activeChats = [];
            try { activeChats = await postgresService.getActiveChats(); } catch (_) {}
            const chatLines = [];
            for (const c of activeChats) {
                let discordChannelName = c.discord_channel_id;
                const ch = client.channels.cache.get(c.discord_channel_id);
                if (ch) discordChannelName = `#${ch.name}`;
                chatLines.push(`• ${c.chat_name || c.chat_id} → ${discordChannelName}`);
            }

            const uptimeMs = Math.floor(process.uptime() * 1000);
            const formatUptime = (ms) => {
                const s = Math.floor(ms / 1000);
                const m = Math.floor(s / 60);
                const h = Math.floor(m / 60);
                const d = Math.floor(h / 24);
                if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
                if (h > 0) return `${h}h ${m % 60}m`;
                if (m > 0) return `${m}m ${s % 60}s`;
                return `${s}s`;
            };
            const redisStatus = cacheService && cacheService.enabled ? 'connected' : 'disabled';

            const msg = [
                '📊 **Bot Status**',
                `• Uptime: ${formatUptime(uptimeMs)}`,
                `• PostgreSQL: ${dbStatus} (${dbRt}ms)`,
                `• WhatsApp: ${waConnected ? 'connected' : 'disconnected'}${waInit ? '' : ' (not initialized)'}`,
                `• Redis: ${redisStatus}`,
                '',
                `🧭 **Monitored Discord Channels (${monitored.length})**`,
                channelLines.length ? channelLines.join('\n') : '• none',
                '',
                `📞 **Monitored WhatsApp Chats (${activeChats.length})**`,
                chatLines.length ? chatLines.join('\n') : '• none'
            ].join('\n');

            await interaction.editReply({ content: msg });
        } catch (err) {
            Logger.error('Error handling /status:', err);
            await interaction.editReply({ content: '❌ Failed to fetch status. Check logs.' });
        }
    }
});



















// Message event handler
client.on('messageCreate', async (message) => {
    try {
        // Skip bot messages
        if (message.author.bot) return;
        
        // Only process messages from configured guild
        if (message.guild?.id !== settings.discord.guildId) return;
        
        // Only process messages from monitored channels (cached)
        const cacheKey = `monitored:${settings.discord.guildId}`;
        let dbChannels = await cacheService.get(cacheKey);
        if (!Array.isArray(dbChannels)) {
            dbChannels = await postgresService.getActiveMonitoredChannels(settings.discord.guildId);
            await cacheService.set(cacheKey, dbChannels, 60);
        }
        if (!dbChannels.includes(message.channel.id)) return;
        
        await messageHandler.handleMessage(message);
        
    } catch (error) {
        Logger.error('Error processing message:', error);
    }
});

// Handle reaction events
client.on('messageReactionAdd', async (reaction, user) => {
    await reactionHandler.handleReactionAdd(reaction, user);
});

// Handle reaction removal events
client.on('messageReactionRemove', async (reaction, user) => {
    await reactionHandler.handleReactionRemove(reaction, user);
});

// Error handling
client.on('error', (error) => {
    Logger.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    Logger.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', async () => {
    Logger.startup('Shutting down bot...');
    await sendShutdownNotice('🛑 **FrijoleBot shutting down** (SIGINT)');
    if (healthCheckService) {
        healthCheckService.stop();
    }
    if (commandHandler) {
        commandHandler.destroy();
    }
    if (whatsappService) {
        await whatsappService.destroy();
    }
    client.destroy();
    try { fs.existsSync(RUN_LOCK_PATH) && fs.rmSync(RUN_LOCK_PATH); } catch (_) {}
    process.exit(0);
});

process.on('SIGTERM', async () => {
    Logger.startup('Received SIGTERM, shutting down gracefully...');
    await sendShutdownNotice('🛑 **FrijoleBot shutting down** (SIGTERM)');
    if (healthCheckService) {
        healthCheckService.stop();
    }
    if (commandHandler) {
        commandHandler.destroy();
    }
    if (whatsappService) {
        await whatsappService.destroy();
    }
    client.destroy();
    try { fs.existsSync(RUN_LOCK_PATH) && fs.rmSync(RUN_LOCK_PATH); } catch (_) {}
    process.exit(0);
});

// Cleanup job for expired DM mappings (run every hour)
setInterval(async () => {
    try {
        const cleanupCount = await postgresService.cleanupExpiredDMMappings();
        if (cleanupCount > 0) {
            Logger.info(`Cleanup job: Removed ${cleanupCount} expired DM mappings`);
        }
    } catch (error) {
        Logger.error('Error in cleanup job:', error);
    }
}, 60 * 60 * 1000); // Run every hour

// Start the bot
  // settings already loaded above

  if (!settings.discord.token || !settings.discord.guildId) {
    Logger.info('Discord not configured; UI-only mode.');
    // Start health check server only for UI
    healthCheckService = new HealthCheckService(null, postgresService, config);
    // Patch config with admin rateLimit for HealthCheckService consumers
    if (settings.rateLimit) {
      config.rateLimit = {
        windowMs: (settings.rateLimit.windowSec || 60) * 1000,
        maxRequests: settings.rateLimit.maxRequests || 5,
        cleanupInterval: (settings.rateLimit.cleanupIntervalSec || 300) * 1000,
        enabled: settings.rateLimit.enabled !== false
      };
    }
    healthCheckService.start();
    // Keep process alive
    setInterval(() => {}, 1000);
    return;
  }

  // Map admin rateLimit into config for CommandHandler
  if (settings.rateLimit) {
    config.rateLimit = {
      windowMs: (settings.rateLimit.windowSec || 60) * 1000,
      maxRequests: settings.rateLimit.maxRequests || 5,
      cleanupInterval: (settings.rateLimit.cleanupIntervalSec || 300) * 1000,
      enabled: settings.rateLimit.enabled !== false
    };
  }

  client.login(settings.discord.token).catch(error => {
      Logger.error('Failed to login:', error);
      
      // In test mode, start health check service even if Discord fails
      if (config.app.nodeEnv === 'test') {
          Logger.startup('Test mode: Starting health check service despite Discord auth failure');
          healthCheckService = new HealthCheckService(null, postgresService, config);
          healthCheckService.start();
          
          // Keep the process alive for health checks
          setInterval(() => {
              // Keep alive
          }, 1000);
      } else {
      process.exit(1);
      }
  });
}

// Start the application
main().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
});
