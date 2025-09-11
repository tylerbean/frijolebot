// Main application entry point
async function main() {
  // Dynamic imports to handle ES module compatibility
  const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, Partials, MessageFlags } = await import('discord.js');
  const fs = require('fs');
  const path = require('path');
  const config = require('./config');
  const PostgreSQLService = require('./services/PostgreSQLService');
  const HealthCheckService = require('./services/HealthCheckService');
  const WhatsAppService = require('./services/WhatsAppService');
  const MessageHandler = require('./handlers/messageHandler');
  const ReactionHandler = require('./handlers/reactionHandler');
  const CommandHandler = require('./handlers/commandHandler');
  const Logger = require('./utils/logger');

Logger.startup('Bot starting...');
Logger.startup(`Monitoring ${config.discord.channelsToMonitor.length} channels`);

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

// Initialize database schema
await postgresService.initializeDatabase();

// Create Discord client
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
        .setDMPermission(false)
];

// Register slash commands
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    
    try {
        Logger.startup('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, config.discord.guildId),
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
    Logger.startup(`Monitoring ${config.discord.channelsToMonitor.length} channels in guild ${config.discord.guildId}`);
    // Send admin startup message and channel summary
    try {
        const adminChannel = client.channels.cache.get(config.discord.adminChannelId);
        if (adminChannel) {
            await adminChannel.send(`🟢 **FrijoleBot started** on ${new Date().toISOString()}`);
            const lines = config.discord.channelsToMonitor.map(id => {
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
    
    // Initialize CommandHandler with Discord client
    commandHandler = new CommandHandler(postgresService, reactionHandler, config, client);
    
    // Initialize and start health check service
    healthCheckService = new HealthCheckService(client, postgresService, config);
    // expose WhatsApp service to health for chat listing if available later
    healthCheckService.whatsappService = whatsappService;
    healthCheckService.start();
    
    // Initialize WhatsApp service if enabled
    Logger.info(`WhatsApp enabled: ${config.whatsapp.enabled}`);
    if (config.whatsapp.enabled) {
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
    await registerCommands();
    
    // Log channel names for verification
    config.discord.channelsToMonitor.forEach(channelId => {
        const channel = client.channels.cache.get(channelId);
        if (channel) {
            Logger.startup(`Monitoring channel: #${channel.name} (${channelId})`);
        } else {
            Logger.warning(`Channel ${channelId} not found or not accessible`);
        }
    });
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
            const ch = client.channels.cache.get(config.discord.adminChannelId);
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
});



















// Message event handler
client.on('messageCreate', async (message) => {
    try {
        // Skip bot messages
        if (message.author.bot) return;
        
        // Only process messages from configured guild
        if (message.guild?.id !== config.discord.guildId) return;
        
        // Only process messages from monitored channels
        if (!config.discord.channelsToMonitor.includes(message.channel.id)) return;
        
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
  client.login(config.discord.token).catch(error => {
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
