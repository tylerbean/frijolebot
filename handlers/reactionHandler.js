function getLogger() { return require('../utils/logger'); }
const { PermissionFlagsBits } = require('discord.js');

class ReactionHandler {
    constructor(postgresService, config) {
        this.postgresService = postgresService;
        this.config = config;
        this.whatsappService = null; // Will be set after WhatsApp service is initialized
    }

    /**
     * Set the WhatsApp service instance for reverse reaction flow
     * @param {WhatsAppService} whatsappService - The WhatsApp service instance
     */
    setWhatsAppService(whatsappService) {
        this.whatsappService = whatsappService;
    }

    async handleReactionAdd(reaction, user) {
        try {
            getLogger().debug(`REACTION EVENT: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);
            getLogger().debug(`Message partial: ${reaction.message.partial}, Reaction partial: ${reaction.partial}`);
            
            if (user.bot) return;

            // Fetch partial messages to get full data for old messages
            if (reaction.partial) {
                try {
                    getLogger().debug('Fetching partial reaction...');
                    await reaction.fetch();
                    getLogger().success('Reaction fetched successfully');
                } catch (error) {
                    getLogger().error('Something went wrong when fetching the reaction:', error);
                    return;
                }
            }

            if (reaction.message.partial) {
                try {
                    getLogger().debug('Fetching partial message...');
                    await reaction.message.fetch();
                    getLogger().success('Message fetched successfully');
                } catch (error) {
                    getLogger().error('Something went wrong when fetching the message:', error);
                    return;
                }
            }
            
            // Handle DM reactions (for unread links command)
            if (!reaction.message.guild) {
                await this.handleDMReaction(reaction, user);
                return;
            }

            // Check for reverse reaction flow (Discord → WhatsApp)
            await this.handleReverseReaction(reaction, user, false); // false = add reaction

            // Handle channel reactions for marking links as read
            // Use DB-backed monitored channels via cache, with legacy fallback to config.discord.channelsToMonitor
            try {
                const guildId = reaction.message.guild?.id;
                const channelId = reaction.message.channel.id;
                let allowed = false;
                if (guildId && this.postgresService) {
                    const cacheService = this.config && this.config.cacheService;
                    const key = `monitored:${guildId}`;
                    let list = null;
                    if (cacheService && typeof cacheService.get === 'function') {
                        list = await cacheService.get(key);
                    }
                    if (!Array.isArray(list) || list.length === 0) {
                        list = await this.postgresService.getActiveMonitoredChannels(guildId);
                        if (cacheService && typeof cacheService.set === 'function' && Array.isArray(list) && list.length > 0) {
                            await cacheService.set(key, list, 60);
                        }
                    }
                    allowed = Array.isArray(list) && list.includes(channelId);
                }
                // Legacy fallback for tests and legacy config
                if (!allowed && this.config && this.config.discord && Array.isArray(this.config.discord.channelsToMonitor)) {
                    allowed = this.config.discord.channelsToMonitor.includes(channelId);
                }
                if (!allowed) return;
            } catch (_) {
                // On any error determining allowed channels, fallback to legacy list
                try {
                    const channelId = reaction.message.channel.id;
                    if (!(this.config && this.config.discord && Array.isArray(this.config.discord.channelsToMonitor) && this.config.discord.channelsToMonitor.includes(channelId))) {
                        return;
                    }
                } catch (__) {
                    return;
                }
            }
            
            // Handle admin deletion with X or trash emojis
            if (reaction.emoji.name === '❌' || reaction.emoji.name === '🗑️') {
                await this.handleDeletionReaction(reaction, user);
                return;
            }
            
            if (reaction.emoji.name !== '✅') return;
            
            getLogger().info(`Channel reaction: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);

            // Mark link as read in PostgreSQL if reactor is different from original poster
            await this.postgresService.updateReadStatusFromReaction(reaction.message.id, reaction.message.guild.id, user.username, true);
            
        } catch (error) {
            getLogger().error('Error handling reaction:', error && (error.message || error));
        }
    }

    async handleReactionRemove(reaction, user) {
        try {
            if (user.bot) return;
            
            // Fetch partial messages to get full data for old messages
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    getLogger().error('Something went wrong when fetching the reaction:', error);
                    return;
                }
            }

            if (reaction.message.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    getLogger().error('Something went wrong when fetching the message:', error);
                    return;
                }
            }
            
            // Handle DM reaction removal (for unread links command)
            if (!reaction.message.guild) {
                await this.handleDMReactionRemove(reaction, user);
                return;
            }

            // Check for reverse reaction flow (Discord → WhatsApp)
            await this.handleReverseReaction(reaction, user, true); // true = remove reaction

            // Only process reactions in monitored channels (DB-backed; with legacy fallback)
            try {
                const guildId = reaction.message.guild?.id;
                const channelId = reaction.message.channel.id;
                let allowed = false;
                if (guildId && this.postgresService) {
                    const cacheService = this.config && this.config.cacheService;
                    const key = `monitored:${guildId}`;
                    let list = null;
                    if (cacheService && typeof cacheService.get === 'function') {
                        list = await cacheService.get(key);
                    }
                    if (!Array.isArray(list) || list.length === 0) {
                        list = await this.postgresService.getActiveMonitoredChannels(guildId);
                        if (cacheService && typeof cacheService.set === 'function' && Array.isArray(list) && list.length > 0) {
                            await cacheService.set(key, list, 60);
                        }
                    }
                    allowed = Array.isArray(list) && list.includes(channelId);
                }
                if (!allowed && this.config && this.config.discord && Array.isArray(this.config.discord.channelsToMonitor)) {
                    allowed = this.config.discord.channelsToMonitor.includes(channelId);
                }
                if (!allowed) return;
            } catch (_) {
                try {
                    const channelId = reaction.message.channel.id;
                    if (!(this.config && this.config.discord && Array.isArray(this.config.discord.channelsToMonitor) && this.config.discord.channelsToMonitor.includes(channelId))) {
                        return;
                    }
                } catch (__) {
                    return;
                }
            }
            if (reaction.emoji.name !== '✅') return;

            getLogger().info(`Reaction removed: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);

            // Mark link as unread in PostgreSQL if reactor is different from original poster
            await this.postgresService.updateReadStatusFromReaction(reaction.message.id, reaction.message.guild.id, user.username, false);
            
        } catch (error) {
            getLogger().error('Error handling reaction removal:', error && (error.message || error));
        }
    }

    async handleDMReaction(reaction, user) {
        getLogger().debug(`DM reaction detected: ${reaction.emoji.name} on message ${reaction.message.id}`);
        
        // Find the mapping in the database
        const mapping = await this.postgresService.findDMMapping(reaction.message.id, reaction.emoji.name);
        
        if (mapping) {
            getLogger().debug(`Found mapping: ${JSON.stringify(mapping)}`);
            
            // Handle checkmark for "mark all as read"
            if (reaction.emoji.name === '✅') {
                try {
                    const messageIds = JSON.parse(mapping.original_message_id);
                    if (Array.isArray(messageIds)) {
                        getLogger().debug(`Bulk marking ${messageIds.length} links as read`);
                        let successCount = 0;
                        for (const id of messageIds) {
                            // For bulk operations, we need to find the actual guild_id for each message
                            const link = await this.postgresService.findLinkByMessageIdAllGuilds(id);
                            if (link) {
                                const success = await this.postgresService.updateReadStatus(id, link.guild_id, true);
                                if (success) successCount++;
                            } else {
                                getLogger().warning(`Could not find link for message ID: ${id}`);
                            }
                        }
                        getLogger().success(`Marked ${successCount}/${messageIds.length} links as read via bulk action`);
                    }
                } catch (error) {
                    getLogger().error('Error parsing bulk message IDs:', error);
                }
            } else {
                // Handle individual numbered reactions
                getLogger().debug(`Attempting to mark single link as read: ${mapping.original_message_id} in guild: ${mapping.guild_id}`);
                const success = await this.postgresService.updateReadStatus(mapping.original_message_id, mapping.guild_id, true);
                if (success) {
                    getLogger().success(`Marked link as read via DM reaction: ${mapping.original_message_id}`);
                } else {
                    getLogger().error(`Failed to mark link as read: ${mapping.original_message_id}`);
                }
            }
        } else {
            getLogger().warning(`No mapping found for DM message ${reaction.message.id} with emoji ${reaction.emoji.name}`);
        }
    }

    async handleDMReactionRemove(reaction, user) {
        getLogger().debug(`DM reaction removal detected: ${reaction.emoji.name} on message ${reaction.message.id}`);
        
        // Find the mapping in the database
        const mapping = await this.postgresService.findDMMapping(reaction.message.id, reaction.emoji.name);
        
        if (mapping) {
            getLogger().debug(`Found mapping for removal: ${JSON.stringify(mapping)}`);
            
            // Handle checkmark for "mark all as unread"
            if (reaction.emoji.name === '✅') {
                try {
                    const messageIds = JSON.parse(mapping.original_message_id);
                    if (Array.isArray(messageIds)) {
                        getLogger().debug(`Bulk marking ${messageIds.length} links as unread`);
                        let successCount = 0;
                        for (const id of messageIds) {
                            // For bulk operations, we need to find the actual guild_id for each message
                            const link = await this.postgresService.findLinkByMessageIdAllGuilds(id);
                            if (link) {
                                const success = await this.postgresService.updateReadStatus(id, link.guild_id, false);
                                if (success) successCount++;
                            } else {
                                getLogger().warning(`Could not find link for message ID: ${id}`);
                            }
                        }
                        getLogger().success(`Marked ${successCount}/${messageIds.length} links as unread via bulk removal`);
                    }
                } catch (error) {
                    getLogger().error('Error parsing bulk message IDs for removal:', error);
                }
            } else {
                // Handle individual numbered reactions
                getLogger().debug(`Attempting to mark single link as unread: ${mapping.original_message_id} in guild: ${mapping.guild_id}`);
                const success = await this.postgresService.updateReadStatus(mapping.original_message_id, mapping.guild_id, false);
                if (success) {
                    getLogger().success(`Marked link as unread via DM reaction removal: ${mapping.original_message_id}`);
                } else {
                    getLogger().error(`Failed to mark link as unread: ${mapping.original_message_id}`);
                }
            }
        } else {
            getLogger().warning(`No mapping found for DM message ${reaction.message.id} with emoji ${reaction.emoji.name} (removal)`);
        }
    }

    async handleDeletionReaction(reaction, user) {
        getLogger().info(`Admin deletion request: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);
        if (!reaction.message.guild) {
            throw new Error('Cannot delete in DM');
        }
        
        // Check if user has admin permissions
        let hasAdminPerms = false;
        try {
            const member = await reaction.message.guild.members.fetch(user.id);
            hasAdminPerms = await this.isUserAdmin(member);
        } catch (err) {
            getLogger().error('Error checking admin permissions:', err && (err.message || err));
        }
        
        // Check if user is the original poster
        const isOriginalPoster = reaction.message.author.id === user.id;
        
        getLogger().debug(`Deletion permission check:`);
        getLogger().debug(`   - User: ${user.username} (${user.id})`);
        getLogger().debug(`   - Message author: ${reaction.message.author.username} (${reaction.message.author.id})`);
        getLogger().debug(`   - Is admin: ${hasAdminPerms}`);
        getLogger().debug(`   - Is original poster: ${isOriginalPoster}`);
        
        if (hasAdminPerms) {
            getLogger().success(`Admin ${user.username} can delete any message, proceeding with deletion`);
        } else if (isOriginalPoster) {
            getLogger().success(`Original poster ${user.username} can delete their own message, proceeding with deletion`);
        } else {
            getLogger().warning(`User ${user.username} cannot delete message by ${reaction.message.author.username} (not admin, not original poster)`);
            return;
        }
        
        if (hasAdminPerms || isOriginalPoster) {
            try {
                // Delete from PostgreSQL first
                let dbDeleted = false;
                try {
                    dbDeleted = await this.postgresService.deleteLink(reaction.message.id, reaction.message.guild.id);
                } catch (dbErr) {
                    Logger.error(`Error deleting DB entry: ${dbErr && (dbErr.message || dbErr)}`);
                }
                
                // Delete the Discord message
                await reaction.message.delete();
                
                const deletionType = hasAdminPerms ? 'admin' : 'self';
                getLogger().success(`Deleted Discord message ${reaction.message.id} by ${deletionType} ${user.username}`);
                
                if (dbDeleted) {
                    getLogger().success('Successfully deleted message and database entry');
                } else {
                    getLogger().warning('Message deleted but no database entry found');
                }
                
            } catch (error) {
                getLogger().error(`Error deleting message: ${error.message || error}`);
            }
        }
    }

    /**
     * Handle reverse reaction flow (Discord → WhatsApp)
     * @param {MessageReaction} reaction - The Discord reaction
     * @param {User} user - The user who reacted
     * @param {boolean} isRemoval - Whether this is a reaction removal (true) or addition (false)
     */
    async handleReverseReaction(reaction, user, isRemoval = false) {
        try {
            // Skip if WhatsApp service is not available
            if (!this.whatsappService) {
                getLogger().debug('WhatsApp service not available, skipping reverse reaction');
                return;
            }

            // Look up WhatsApp message information by Discord message ID
            const whatsappInfo = await this.postgresService.getWhatsAppMessageByDiscordId(reaction.message.id);

            if (!whatsappInfo) {
                getLogger().debug(`No WhatsApp message found for Discord message ${reaction.message.id}, skipping reverse reaction`);
                return;
            }

            const { chatId, messageKey } = whatsappInfo;

            getLogger().debug(`Received WhatsApp info:`, whatsappInfo);
            getLogger().debug(`Extracted chatId: ${chatId}, messageKey:`, messageKey);

            if (!chatId || !messageKey) {
                getLogger().warning('Missing chatId or messageKey for reverse reaction', { chatId, messageKey });
                return;
            }

            // For additions, check if user already has a reaction on this WhatsApp message
            if (!isRemoval) {
                // Get all reactions from this user on this message
                const userReactions = reaction.message.reactions.cache.filter(r =>
                    r.users.cache.has(user.id)
                );

                if (userReactions.size > 1) {
                    // User has multiple reactions - WhatsApp only allows one
                    getLogger().warning(`User ${user.username} has multiple reactions on WhatsApp message, removing new reaction`);

                    // Remove the new reaction
                    try {
                        await reaction.users.remove(user.id);
                        getLogger().debug('Successfully removed duplicate reaction from Discord');
                    } catch (removeError) {
                        getLogger().error('Failed to remove duplicate reaction from Discord:', removeError);
                    }

                    // Send DM to user explaining the limitation
                    try {
                        const dmChannel = await user.createDM();
                        await dmChannel.send(
                            '⚠️ **WhatsApp Reaction Limitation**\n\n' +
                            'WhatsApp only allows one reaction per message. You already have a reaction on this message.\n\n' +
                            'Please remove your existing reaction first, then add the new one.'
                        );
                        getLogger().info(`Sent DM to ${user.username} about WhatsApp reaction limitation`);
                    } catch (dmError) {
                        getLogger().warning('Failed to send DM about reaction limitation:', dmError);
                    }

                    return; // Don't send to WhatsApp
                }
            }

            // Get emoji text - handle different emoji types
            let emoji = '';
            if (!isRemoval) {
                if (reaction.emoji.name) {
                    emoji = reaction.emoji.name;
                    // For custom emojis, we might want to use the name instead of the actual emoji
                    if (reaction.emoji.id) {
                        // This is a custom Discord emoji, use name
                        emoji = `:${reaction.emoji.name}:`;
                    }
                }
            }
            // For removal, emoji stays empty string

            getLogger().info(`Sending reverse reaction to WhatsApp: ${emoji || '(remove)'} from ${user.username} to chat ${chatId}`);

            // Send reaction to WhatsApp
            const result = await this.whatsappService.sendReaction(chatId, messageKey, emoji);

            if (result) {
                getLogger().success(`Reverse reaction sent successfully to WhatsApp`);
            } else {
                getLogger().warning('Failed to send reverse reaction to WhatsApp');
            }

        } catch (error) {
            getLogger().error('Error handling reverse reaction:', error);
        }
    }

    async isUserAdmin(member) {
        try {
            // Check for Discord Administrator permission (most reliable)
            if (member.permissions.has(PermissionFlagsBits.Administrator)) {
                return true;
            }
            
            // Check for ManageMessages permission (common for moderators)
            if (member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                return true;
            }
            
            // Check for roles by name (case-insensitive)
            const hasAdminRole = member.roles.cache.some(role => {
                const roleName = role.name.toLowerCase();
                return roleName === 'admin' || 
                       roleName === 'administrator' || 
                       roleName.includes('admin') || 
                       roleName === 'moderator' || 
                       roleName === 'mod' ||
                       roleName.includes('moderator');
            });
            
            getLogger().debug(`Admin check for ${member.user.username}:`);
            getLogger().debug(`   - Administrator permission: ${member.permissions.has('Administrator')}`);
            getLogger().debug(`   - ManageMessages permission: ${member.permissions.has('ManageMessages')}`);
            getLogger().debug(`   - Admin role found: ${hasAdminRole}`);
            getLogger().debug(`   - User roles: ${member.roles.cache.map(role => role.name).join(', ')}`);
            
            return hasAdminRole;
        } catch (error) {
            getLogger().error('Error checking admin permissions:', error);
            return false;
        }
    }

}

module.exports = ReactionHandler;
