const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, Partials, MessageFlags } = require('discord.js');
const config = require('./config');
const BaserowService = require('./services/BaserowService');
const HealthCheckService = require('./services/HealthCheckService');
const WhatsAppService = require('./services/WhatsAppService');
const MessageHandler = require('./handlers/messageHandler');
const ReactionHandler = require('./handlers/reactionHandler');
const CommandHandler = require('./handlers/commandHandler');
const Logger = require('./utils/logger');

Logger.startup('Bot starting...');
Logger.startup(`Monitoring ${config.discord.channelsToMonitor.length} channels`);

// Initialize services
const baserowService = new BaserowService(
    config.baserow.apiToken, 
    config.baserow.apiUrl, 
    config.baserow.linksTableId, 
    config.baserow.dmMappingTableId,
    config.baserow.whatsappSessionsTableId,
    config.baserow.whatsappChatsTableId,
    config.baserow.whatsappMessagesTableId
);

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
const reactionHandler = new ReactionHandler(baserowService, config);
const messageHandler = new MessageHandler(baserowService);
let commandHandler; // Will be initialized after client is ready
let healthCheckService; // Will be initialized after client is ready
let whatsappService; // Will be initialized after client is ready



// Define slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('unread')
        .setDescription('Get a list of unread links shared by others')
        .setDMPermission(true)
];

// Register slash commands
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    
    try {
        Logger.startup('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        
        Logger.success('Successfully reloaded application (/) commands.');
    } catch (error) {
        Logger.error('Error registering commands:', error);
    }
}

// Bot ready event
Logger.info('Setting up ready event handler...');
client.once('ready', async () => {
    Logger.success(`Bot logged in as ${client.user.tag}`);
    Logger.startup(`Monitoring ${config.discord.channelsToMonitor.length} channels in guild ${config.discord.guildId}`);
    
    // Initialize CommandHandler with Discord client
    commandHandler = new CommandHandler(baserowService, reactionHandler, config, client);
    
    // Initialize and start health check service
    healthCheckService = new HealthCheckService(client, baserowService, config);
    healthCheckService.start();
    
    // Initialize WhatsApp service if enabled
    Logger.info(`WhatsApp enabled: ${config.whatsapp.enabled}`);
    if (config.whatsapp.enabled) {
      try {
        Logger.info('Creating WhatsApp service...');
        whatsappService = new WhatsAppService(config, client);
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
});

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
    process.exit(0);
});

process.on('SIGTERM', async () => {
    Logger.startup('Received SIGTERM, shutting down gracefully...');
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
    process.exit(0);
});

// Cleanup job for expired DM mappings (run every hour)
setInterval(async () => {
    try {
        const cleanupCount = await baserowService.cleanupExpiredDMMappings();
        if (cleanupCount > 0) {
            Logger.info(`Cleanup job: Removed ${cleanupCount} expired DM mappings`);
        }
    } catch (error) {
        Logger.error('Error in cleanup job:', error);
    }
}, 60 * 60 * 1000); // Run every hour

// Start the bot
Logger.info('Attempting Discord login...');
client.login(config.discord.token).catch(error => {
    Logger.error('Failed to login:', error);
    
    // In test mode, start health check service even if Discord fails
    if (config.app.nodeEnv === 'test') {
        Logger.startup('Test mode: Starting health check service despite Discord auth failure');
        healthCheckService = new HealthCheckService(null, baserowService, config);
        healthCheckService.start();
        
        // Keep the process alive for health checks
        setInterval(() => {
            // Keep alive
        }, 1000);
    } else {
    process.exit(1);
    }
});
