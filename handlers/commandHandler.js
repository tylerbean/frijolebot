const { EmbedBuilder, MessageFlags } = require('discord.js');
const Logger = require('../utils/logger');
const RateLimiter = require('../utils/rateLimiter');

class CommandHandler {
    constructor(postgresService, reactionHandler, config, discordClient) {
        this.postgresService = postgresService;
        this.reactionHandler = reactionHandler;
        this.config = config;
        this.discordClient = discordClient;
        
        // Initialize rate limiter from admin settings (fallback to defaults)
        const rl = config.rateLimit || { enabled: true, windowMs: 60000, maxRequests: 5, cleanupInterval: 300000 };
        if (rl.enabled) {
            this.rateLimiter = new RateLimiter({
                windowMs: rl.windowMs,
                maxRequests: rl.maxRequests,
                cleanupInterval: rl.cleanupInterval
            });
            Logger.info(`Rate limiting enabled: ${rl.maxRequests} requests per ${rl.windowMs}ms`);
        } else {
            this.rateLimiter = null;
            Logger.info('Rate limiting disabled');
        }
    }

    /**
     * Check rate limit for a user and command
     * @param {Object} interaction - Discord interaction object
     * @param {string} commandName - Name of the command
     * @returns {Object|null} - Rate limit result or null if not rate limited
     */
    async checkRateLimit(interaction, commandName) {
        if (!this.rateLimiter) {
            return null; // Rate limiting disabled
        }

        const userId = interaction.user.id;
        const rateLimitResult = this.rateLimiter.checkLimit(userId, commandName);

        if (!rateLimitResult.allowed) {
            const retryTime = this.rateLimiter.formatRetryTime(rateLimitResult.retryAfter);
            
            await interaction.editReply({
                content: `⏰ **Rate Limited**\n\nYou've used this command too many times. Please try again in **${retryTime}**.\n\n*You can use this command ${this.config.rateLimit.maxRequests} times per minute.*`,
                flags: MessageFlags.Ephemeral
            });

            Logger.warning(`Rate limit exceeded for user ${interaction.user.username} (${userId}) on command ${commandName}`);
            return rateLimitResult;
        }

        return null; // Not rate limited
    }

    async handleUnreadCommand(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            // Check rate limit
            const rateLimitResult = await this.checkRateLimit(interaction, 'unread');
            if (rateLimitResult) {
                return; // Rate limited, response already sent
            }
            
            const username = interaction.user.username;
            const guildId = interaction.guildId;
            
            Logger.info(`/unread command called by:`, {
                username: username,
                userId: interaction.user.id,
                guildId: guildId,
                guildName: interaction.guild?.name
            });
            
            // Handle DM usage - show unread links from servers user is member of
            if (!guildId) {
                Logger.info('Command used in DM - fetching unread links from accessible servers');
                const unreadLinks = await this.postgresService.getUnreadLinksForUserAllGuilds(username, interaction.user.id, this.discordClient);

                if (unreadLinks.length === 0) {
                    await interaction.editReply({
                        content: '🎉 You\'re all caught up! No unread links from others in any server.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Send DM to user with multiple messages (max 9 links per message due to 20 reaction limit)
                // 9 numbered reactions + 1 checkmark = 10 total, leaving room for user reactions
                try {
                    const dmChannel = await interaction.user.createDM();
                    const reactions = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
                    const LINKS_PER_MESSAGE = 9;
                    const totalMessages = Math.ceil(unreadLinks.length / LINKS_PER_MESSAGE);

                    for (let msgIndex = 0; msgIndex < totalMessages; msgIndex++) {
                        const startIdx = msgIndex * LINKS_PER_MESSAGE;
                        const endIdx = Math.min(startIdx + LINKS_PER_MESSAGE, unreadLinks.length);
                        const linksChunk = unreadLinks.slice(startIdx, endIdx);

                        // Create embed for this chunk
                        const embed = new EmbedBuilder()
                            .setTitle(totalMessages > 1 ? `📚 Unread Links (All Servers) - Part ${msgIndex + 1}/${totalMessages}` : '📚 Unread Links (All Servers)')
                            .setDescription(`You have ${unreadLinks.length} unread link(s) total\n\n**React to mark as read, remove reaction to mark as unread**`)
                            .setColor(0x00AE86)
                            .setTimestamp();

                        // Add fields for links in this chunk
                        linksChunk.forEach((link, chunkIdx) => {
                            const globalIdx = startIdx + chunkIdx;
                            const channelName = link.channel_name || 'unknown';
                            const poster = link.user || 'unknown';
                            const timestamp = link.timestamp ? new Date(link.timestamp).toLocaleDateString() : 'unknown';
                            const guildName = link.guild_name || 'Unknown Server';

                            const messageLink = `https://discord.com/channels/${link.guild_id}/${link.channel_id}/${link.message_id}`;

                            // Truncate URL if too long
                            const maxUrlLength = 200;
                            const displayUrl = link.url.length > maxUrlLength
                                ? link.url.substring(0, maxUrlLength) + '...'
                                : link.url;

                            embed.addFields({
                                name: `${globalIdx + 1}. From ${poster} in #${channelName} (${guildName})`,
                                value: `[Jump to message](${messageLink})\nOriginal URL: ${displayUrl}\n*Posted: ${timestamp}*`,
                                inline: false
                            });
                        });

                        // Send the message
                        const dmMessage = await dmChannel.send({ embeds: [embed] });

                        // Add reactions for each link in this message
                        for (let i = 0; i < linksChunk.length; i++) {
                            await dmMessage.react(reactions[i]);
                            await this.postgresService.createDMMapping(
                                dmMessage.id,
                                reactions[i],
                                linksChunk[i].message_id,
                                linksChunk[i].guild_id,
                                interaction.user.id
                            );
                        }

                        // Add checkmark for "mark all in this message as read"
                        await dmMessage.react('✅');
                        await this.postgresService.createBulkDMMapping(
                            dmMessage.id,
                            linksChunk.map(link => link.message_id),
                            'all_guilds',
                            interaction.user.id
                        );
                    }

                    await interaction.editReply({
                        content: totalMessages > 1
                            ? `📬 I've sent you ${totalMessages} DMs with your unread links from all servers! React to mark as read, remove reaction to mark as unread.`
                            : '📬 I\'ve sent you a DM with your unread links from all servers! React to mark as read, remove reaction to mark as unread.',
                        flags: MessageFlags.Ephemeral
                    });

                } catch (dmError) {
                    Logger.error('Error sending DM:', dmError);
                    await interaction.editReply({
                        content: '❌ I couldn\'t send you a DM. Please check your privacy settings.',
                        flags: MessageFlags.Ephemeral
                    });
                }
                return;
            }
            
            const unreadLinks = await this.postgresService.getUnreadLinksForUser(username, guildId, interaction.user.id, this.discordClient) || [];

            if (unreadLinks.length === 0) {
                await interaction.editReply({
                    content: '🎉 You\'re all caught up! No unread links from others.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // Send DM to user with multiple messages (max 9 links per message due to 20 reaction limit)
            // 9 numbered reactions + 1 checkmark = 10 total, leaving room for user reactions
            try {
                const dmChannel = await interaction.user.createDM();
                const reactions = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
                const LINKS_PER_MESSAGE = 9;
                const totalMessages = Math.ceil(unreadLinks.length / LINKS_PER_MESSAGE);

                for (let msgIndex = 0; msgIndex < totalMessages; msgIndex++) {
                    const startIdx = msgIndex * LINKS_PER_MESSAGE;
                    const endIdx = Math.min(startIdx + LINKS_PER_MESSAGE, unreadLinks.length);
                    const linksChunk = unreadLinks.slice(startIdx, endIdx);

                    // Create embed for this chunk
                    const embed = new EmbedBuilder()
                        .setTitle(totalMessages > 1 ? `📚 Unread Links - Part ${msgIndex + 1}/${totalMessages}` : '📚 Unread Links')
                        .setDescription(`You have ${unreadLinks.length} unread link(s) total\n\n**React to mark as read, remove reaction to mark as unread**`)
                        .setColor(0x00AE86)
                        .setTimestamp();

                    // Add fields for links in this chunk
                    linksChunk.forEach((link, chunkIdx) => {
                        const globalIdx = startIdx + chunkIdx;
                        const channelName = link.channel_name || 'unknown';
                        const poster = link.user || 'unknown';
                        const timestamp = link.timestamp ? new Date(link.timestamp).toLocaleDateString() : 'unknown';

                        const messageLink = `https://discord.com/channels/${this.config.discord.guildId}/${link.channel_id}/${link.message_id}`;

                        // Truncate URL if too long
                        const maxUrlLength = 200;
                        const displayUrl = link.url.length > maxUrlLength
                            ? link.url.substring(0, maxUrlLength) + '...'
                            : link.url;

                        embed.addFields({
                            name: `${globalIdx + 1}. From ${poster} in #${channelName}`,
                            value: `[Jump to message](${messageLink})\nOriginal URL: ${displayUrl}\n*Posted: ${timestamp}*`,
                            inline: false
                        });
                    });

                    // Send the message
                    const dmMessage = await dmChannel.send({ embeds: [embed] });

                    // Add reactions for each link in this message
                    for (let i = 0; i < linksChunk.length; i++) {
                        await dmMessage.react(reactions[i]);
                        await this.postgresService.createDMMapping(
                            dmMessage.id,
                            reactions[i],
                            linksChunk[i].message_id,
                            guildId,
                            interaction.user.id
                        );
                    }

                    // Add checkmark for "mark all in this message as read"
                    await dmMessage.react('✅');
                    await this.postgresService.createBulkDMMapping(
                        dmMessage.id,
                        linksChunk.map(link => link.message_id),
                        guildId,
                        interaction.user.id
                    );
                }

                await interaction.editReply({
                    content: totalMessages > 1
                        ? `📬 I've sent you ${totalMessages} DMs with your unread links! React to mark as read, remove reaction to mark as unread.`
                        : '📬 I\'ve sent you a DM with your unread links! React to mark as read, remove reaction to mark as unread.',
                    flags: MessageFlags.Ephemeral
                });

            } catch (dmError) {
                Logger.error('Error sending DM:', dmError);
                await interaction.editReply({
                    content: '❌ I couldn\'t send you a DM. Please check your privacy settings.',
                    flags: MessageFlags.Ephemeral
                });
            }
            
        } catch (error) {
            Logger.error('Error handling unread command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while fetching your unread links.',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    /**
     * Generic command handler that applies rate limiting to any command
     * @param {Object} interaction - Discord interaction object
     * @param {string} commandName - Name of the command
     * @param {Function} commandHandler - Function to execute if not rate limited
     * @returns {Promise} - Result of command execution or rate limit response
     */
    async handleCommand(interaction, commandName, commandHandler) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            // Check rate limit
            const rateLimitResult = await this.checkRateLimit(interaction, commandName);
            if (rateLimitResult) {
                return; // Rate limited, response already sent
            }
            
            // Execute the actual command
            await commandHandler(interaction);
            
        } catch (error) {
            Logger.error(`Error handling ${commandName} command:`, error);
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing your command. Please try again later.',
                    flags: MessageFlags.Ephemeral
                });
            } catch (replyError) {
                Logger.error('Error sending error reply:', replyError);
            }
        }
    }

    /**
     * Get rate limit information for a user
     * @param {string} userId - Discord user ID
     * @param {string} commandName - Name of the command
     * @returns {Object} - Rate limit information
     */
    getRateLimitInfo(userId, commandName = 'global') {
        if (!this.rateLimiter) {
            return { enabled: false };
        }
        
        const info = this.rateLimiter.getLimitInfo(userId, commandName);
        return {
            enabled: true,
            remaining: info.remaining,
            resetTime: info.resetTime,
            retryAfter: info.retryAfter,
            maxRequests: this.config.rateLimit.maxRequests,
            windowMs: this.config.rateLimit.windowMs
        };
    }

    /**
     * Reset rate limit for a user (admin function)
     * @param {string} userId - Discord user ID
     * @param {string} commandName - Name of the command (optional)
     */
    resetRateLimit(userId, commandName = null) {
        if (!this.rateLimiter) {
            return;
        }
        
        if (commandName) {
            this.rateLimiter.resetLimit(userId, commandName);
        } else {
            this.rateLimiter.resetUserLimits(userId);
        }
    }

    /**
     * Get rate limiter statistics
     * @returns {Object} - Rate limiter statistics
     */
    getRateLimitStats() {
        if (!this.rateLimiter) {
            return { enabled: false };
        }
        
        return {
            enabled: true,
            ...this.rateLimiter.getStats()
        };
    }

    /**
     * Clean up resources when CommandHandler is destroyed
     */
    destroy() {
        if (this.rateLimiter) {
            this.rateLimiter.destroy();
        }
    }
}

module.exports = CommandHandler;
