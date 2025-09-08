require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_GUILD_ID',
    'BASEROW_API_TOKEN',
    'BASEROW_API_URL',
    'BASEROW_LINKS_TABLE_ID',
    'BASEROW_DM_MAPPING_TABLE_ID'
];

// WhatsApp environment variables (required if WhatsApp is enabled)
const whatsappEnvVars = [
    'WHATSAPP_SESSION_ENCRYPTION_KEY',
    'BASEROW_WHATSAPP_SESSIONS_TABLE_ID',
    'BASEROW_WHATSAPP_CHATS_TABLE_ID',
    'BASEROW_WHATSAPP_MESSAGES_TABLE_ID'
];

// Check for missing required environment variables
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Check for missing WhatsApp environment variables if WhatsApp is enabled
if (process.env.WHATSAPP_ENABLED === 'true') {
    const missingWhatsappVars = whatsappEnvVars.filter(varName => !process.env[varName]);
    if (missingWhatsappVars.length > 0) {
        throw new Error(`WhatsApp is enabled but missing required environment variables: ${missingWhatsappVars.join(', ')}`);
    }
}

// Get all channel IDs from environment variables
const channelIds = Object.keys(process.env)
    .filter(key => key.startsWith('DISCORD_CHANNEL_'))
    .map(key => process.env[key])
    .filter(id => id && id.trim() !== '' && id !== 'your_channel_id_here');

if (channelIds.length === 0) {
    throw new Error('No Discord channels configured for monitoring');
}

module.exports = {
    discord: {
        token: process.env.DISCORD_BOT_TOKEN,
        guildId: process.env.DISCORD_GUILD_ID,
        channelsToMonitor: channelIds,
        adminChannelId: process.env.DISCORD_ADMIN_CHANNEL
    },
    baserow: {
        apiToken: process.env.BASEROW_API_TOKEN,
        apiUrl: process.env.BASEROW_API_URL,
        linksTableId: process.env.BASEROW_LINKS_TABLE_ID,
        dmMappingTableId: process.env.BASEROW_DM_MAPPING_TABLE_ID,
        whatsappSessionsTableId: process.env.BASEROW_WHATSAPP_SESSIONS_TABLE_ID,
        whatsappChatsTableId: process.env.BASEROW_WHATSAPP_CHATS_TABLE_ID,
        whatsappMessagesTableId: process.env.BASEROW_WHATSAPP_MESSAGES_TABLE_ID
    },
    app: {
        nodeEnv: process.env.NODE_ENV || 'development'
    },
    health: {
        port: process.env.HEALTH_CHECK_PORT || 3000
    },
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 5, // 5 requests per window
        cleanupInterval: parseInt(process.env.RATE_LIMIT_CLEANUP_INTERVAL) || 300000, // 5 minutes
        enabled: process.env.RATE_LIMIT_ENABLED !== 'false' // Default to enabled
    },
    whatsapp: {
        sessionEncryptionKey: process.env.WHATSAPP_SESSION_ENCRYPTION_KEY,
        storeMessages: process.env.WHATSAPP_STORE_MESSAGES === 'true',
        enabled: process.env.WHATSAPP_ENABLED === 'true'
    }
};
