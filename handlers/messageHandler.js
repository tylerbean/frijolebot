const Logger = require('../utils/logger');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class MessageHandler {
    constructor(postgresService, whatsappService = null) {
        this.postgresService = postgresService;
        this.whatsappService = whatsappService;
        this.urlRegex = /(https?:\/\/[^\s]+)/g;
    }

    async handleMessage(message) {
        try {
            // Skip bot messages
            if (message.author.bot) return;

            // Check for WhatsApp forwarding first
            await this.handleWhatsAppForwarding(message);

            // Then handle link tracking
            await this.handleLinkTracking(message);

        } catch (error) {
            Logger.error('Error processing message:', error);
        }
    }

    async handleLinkTracking(message) {
        try {
            // Feature flag: LinkTracker gate (DB-backed)
            const enabled = this.postgresService && typeof this.postgresService.getFeatureFlagCached === 'function'
                ? await this.postgresService.getFeatureFlagCached('LINK_TRACKER_ENABLED')
                : true;
            if (!enabled) return;

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
            Logger.error('Error in link tracking:', error);
        }
    }

    async handleWhatsAppForwarding(message) {
        try {
            // Check if WhatsApp service is available and enabled
            const whatsappEnabled = this.postgresService && typeof this.postgresService.getFeatureFlagCached === 'function'
                ? await this.postgresService.getFeatureFlagCached('WHATSAPP_ENABLED')
                : false;

            if (!whatsappEnabled || !this.whatsappService) {
                return;
            }

            // Check if this Discord channel is mapped to a WhatsApp chat
            const whatsappChatId = await this.postgresService.getWhatsAppChatForDiscordChannel(message.channel.id);
            if (!whatsappChatId) {
                return; // No mapping found
            }

            Logger.info(`Forwarding message from Discord #${message.channel.name} to WhatsApp chat ${whatsappChatId}`);

            let success = false;

            // Handle attachments (images, videos, documents)
            if (message.attachments.size > 0) {
                for (const attachment of message.attachments.values()) {
                    const mediaResult = await this.forwardMediaToWhatsApp(attachment, message, whatsappChatId);
                    if (mediaResult) success = true;
                }
            }

            // Handle text content
            if (message.content && message.content.trim().length > 0) {
                const textResult = await this.forwardTextToWhatsApp(message, whatsappChatId);
                if (textResult) success = true;
            }

            // Add green checkmark if any message was sent successfully
            if (success) {
                try {
                    await message.react('✅');
                    Logger.success('Added success reaction for WhatsApp forwarding');
                } catch (error) {
                    Logger.error('Error adding success reaction:', error);
                }
            }

        } catch (error) {
            Logger.error('Error in WhatsApp forwarding:', error);
        }
    }

    async forwardTextToWhatsApp(message, whatsappChatId) {
        try {
            const author = message.author.username;
            const content = message.content;
            const formattedMessage = `**${author}**: ${content}`;

            const result = await this.whatsappService.sendTextMessage(whatsappChatId, formattedMessage);
            if (result) {
                Logger.success(`Text message forwarded to WhatsApp: ${content.substring(0, 50)}...`);
                return true;
            }
            return false;
        } catch (error) {
            Logger.error('Error forwarding text to WhatsApp:', error);
            return false;
        }
    }

    async forwardMediaToWhatsApp(attachment, message, whatsappChatId) {
        try {
            const author = message.author.username;
            const fileName = attachment.name;
            const fileSize = attachment.size;

            // Skip files larger than 64MB (WhatsApp limit)
            if (fileSize > 64 * 1024 * 1024) {
                Logger.warning(`File ${fileName} too large (${fileSize} bytes), skipping`);
                return false;
            }

            Logger.info(`Downloading attachment: ${fileName} (${fileSize} bytes)`);

            // Download the file
            const response = await axios.get(attachment.url, {
                responseType: 'arraybuffer',
                timeout: 30000 // 30 second timeout
            });
            const mediaBuffer = Buffer.from(response.data);

            // Determine media type based on file extension
            const ext = path.extname(fileName).toLowerCase();
            let mediaType = 'document'; // default

            if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                mediaType = 'image';
            } else if (['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(ext)) {
                mediaType = 'video';
            }

            // Create caption with Discord author info
            const caption = message.content ?
                `**${author}**: ${message.content}` :
                `**${author}** sent ${fileName}`;

            const result = await this.whatsappService.sendMediaMessage(
                whatsappChatId,
                mediaBuffer,
                mediaType,
                caption,
                fileName
            );

            if (result) {
                Logger.success(`Media forwarded to WhatsApp: ${fileName}`);
                return true;
            }
            return false;

        } catch (error) {
            Logger.error('Error forwarding media to WhatsApp:', error);
            return false;
        }
    }
}

module.exports = MessageHandler;
