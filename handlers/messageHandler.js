const Logger = require('../utils/logger');

class MessageHandler {
    constructor(baserowService) {
        this.baserowService = baserowService;
        this.urlRegex = /(https?:\/\/[^\s]+)/g;
    }

    async handleMessage(message) {
        try {
            // Skip bot messages
            if (message.author.bot) return;
            
            // Check if message contains URLs
            const urls = message.content.match(this.urlRegex);
            if (!urls || urls.length === 0) return;
            
            Logger.info(`Found ${urls.length} URL(s) in #${message.channel.name} from ${message.author.username}`);
            
            // Store links in Baserow with guild_id
            for (const url of urls) {
                await this.baserowService.storeLink(message, url, message.guild.id);
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
