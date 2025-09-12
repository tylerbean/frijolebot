require('dotenv').config();

// Validate required environment variables (runtime settings from DB; only DB/health/admin token remain env-driven)
const requiredEnvVars = [
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DATABASE'
];

// WhatsApp environment variables (no required vars at this time)
const whatsappEnvVars = [];

// Check for missing required environment variables
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// No required WhatsApp vars enforced

// Collect channel IDs from environment variables (for tests and legacy support)
const channelIds = Object.keys(process.env)
    .filter((key) => key.startsWith('DISCORD_CHANNEL_'))
    .filter((key) => key !== 'DISCORD_ADMIN_CHANNEL')
    .map((key) => String(process.env[key]).trim())
    .filter((val) => Boolean(val));

module.exports = {
    discord: {
        token: process.env.DISCORD_BOT_TOKEN,
        guildId: process.env.DISCORD_GUILD_ID,
        channelsToMonitor: channelIds,
        adminChannelId: undefined
    },
    postgres: {
        host: process.env.POSTGRES_HOST,
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DATABASE,
        ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
    },
    app: {
        nodeEnv: process.env.NODE_ENV || 'development'
    },
    health: {
        port: process.env.HEALTH_CHECK_PORT || 3000,
        adminToken: process.env.ADMIN_NOTIFY_TOKEN
    },
    rateLimit: {
        windowMs: 60000,
        maxRequests: 5,
        cleanupInterval: 300000,
        enabled: true
    },
    whatsapp: {
        storeMessages: String(process.env.WHATSAPP_STORE_MESSAGES || '').toLowerCase() === 'true',
        enabled: String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true'
    }
};
