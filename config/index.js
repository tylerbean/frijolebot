require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_GUILD_ID',
    'BASEROW_API_TOKEN',
    'BASEROW_API_URL'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Get all channel IDs from environment variables
const channelIds = Object.keys(process.env)
    .filter(key => key.startsWith('DISCORD_CHANNEL_'))
    .map(key => process.env[key])
    .filter(id => id && id !== 'your_channel_id_here');

if (channelIds.length === 0) {
    throw new Error('No Discord channels configured for monitoring');
}

module.exports = {
    discord: {
        token: process.env.DISCORD_BOT_TOKEN,
        guildId: process.env.DISCORD_GUILD_ID,
        channelsToMonitor: channelIds
    },
    baserow: {
        apiToken: process.env.BASEROW_API_TOKEN,
        apiUrl: process.env.BASEROW_API_URL
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
    }
};
