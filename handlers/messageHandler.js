const Logger = require('../utils/logger');

class MessageHandler {
    constructor(postgresService) {
        this.postgresService = postgresService;
        this.urlRegex = /(https?:\/\/[^\s]+)/g;
    }

    async handleMessage(message) {
        try {
            // Feature flag: LinkTracker gate (DB-backed)
            const enabled = this.postgresService && typeof this.postgresService.getFeatureFlagCached === 'function'
                ? await this.postgresService.getFeatureFlagCached('LINK_TRACKER_ENABLED')
                : true;
            if (!enabled) return;
            // Skip bot messages
            if (message.author.bot) return;
            
            // Check if message contains URLs
            const urls = message.content.match(this.urlRegex);
            if (!urls || urls.length === 0) return;
            
            Logger.info(`Found ${urls.length} URL(s) in #${message.channel.name} from ${message.author.username}`);
            
            // Store links in PostgreSQL with guild_id
            for (const url of urls) {
                try {
                    await this.postgresService.storeLink(message, url, message.guild.id);
                } catch (e) {
                    Logger.error('Error processing message:', e);
                }
            }
            
            // Add green checkmark reaction to the message
            try {
                await message.react('✅');
                Logger.success('Added green checkmark reaction');
            } catch (error) {
                Logger.error('Error adding reaction:', error);
            }
            
        } catch (error) {
            Logger.error('Error processing message:', error);
        }
    }
}

module.exports = MessageHandler;
