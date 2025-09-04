const Logger = require('../utils/logger');

class ReactionHandler {
    constructor(baserowService, config) {
        this.baserowService = baserowService;
        this.config = config;
    }

    async handleReactionAdd(reaction, user) {
        try {
            Logger.debug(`REACTION EVENT: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);
            Logger.debug(`Message partial: ${reaction.message.partial}, Reaction partial: ${reaction.partial}`);
            
            if (user.bot) return;

            // Fetch partial messages to get full data for old messages
            if (reaction.partial) {
                try {
                    Logger.debug('Fetching partial reaction...');
                    await reaction.fetch();
                    Logger.success('Reaction fetched successfully');
                } catch (error) {
                    Logger.error('Something went wrong when fetching the reaction:', error);
                    return;
                }
            }

            if (reaction.message.partial) {
                try {
                    Logger.debug('Fetching partial message...');
                    await reaction.message.fetch();
                    Logger.success('Message fetched successfully');
                } catch (error) {
                    Logger.error('Something went wrong when fetching the message:', error);
                    return;
                }
            }
            
            // Handle DM reactions (for unread links command)
            if (!reaction.message.guild) {
                await this.handleDMReaction(reaction, user);
                return;
            }

            // Handle channel reactions for marking links as read
            if (!this.config.discord.channelsToMonitor.includes(reaction.message.channel.id)) return;
            
            // Handle admin deletion with X emoji
            if (reaction.emoji.name === '❌') {
                await this.handleDeletionReaction(reaction, user);
                return;
            }
            
            if (reaction.emoji.name !== '✅') return;
            
            Logger.info(`Channel reaction: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);

            // Mark link as read in Baserow if reactor is different from original poster
            await this.baserowService.updateReadStatusFromReaction(reaction.message.id, reaction.message.guild.id, user.username, true);
            
        } catch (error) {
            Logger.error('Error handling reaction:', error.message);
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
                    Logger.error('Something went wrong when fetching the reaction:', error);
                    return;
                }
            }

            if (reaction.message.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    Logger.error('Something went wrong when fetching the message:', error);
                    return;
                }
            }
            
            // Handle DM reaction removal (for unread links command)
            if (!reaction.message.guild) {
                await this.handleDMReactionRemove(reaction, user);
                return;
            }
            
            // Only process reactions in monitored channels
            if (!this.config.discord.channelsToMonitor.includes(reaction.message.channel.id)) return;
            if (reaction.emoji.name !== '✅') return;

            Logger.info(`Reaction removed: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);

            // Mark link as unread in Baserow if reactor is different from original poster
            await this.baserowService.updateReadStatusFromReaction(reaction.message.id, reaction.message.guild.id, user.username, false);
            
        } catch (error) {
            Logger.error('Error handling reaction removal:', error.message);
        }
    }

    async handleDMReaction(reaction, user) {
        Logger.debug(`DM reaction detected: ${reaction.emoji.name} on message ${reaction.message.id}`);
        
        // Find the mapping in the database
        const mapping = await this.baserowService.findDMMapping(reaction.message.id, reaction.emoji.name);
        
        if (mapping) {
            Logger.debug(`Found mapping: ${JSON.stringify(mapping)}`);
            
            // Handle checkmark for "mark all as read"
            if (reaction.emoji.name === '✅') {
                try {
                    const messageIds = JSON.parse(mapping.original_message_id);
                    if (Array.isArray(messageIds)) {
                        Logger.debug(`Bulk marking ${messageIds.length} links as read`);
                        let successCount = 0;
                        for (const id of messageIds) {
                            // For bulk operations, we need to find the actual guild_id for each message
                            const link = await this.baserowService.findLinkByMessageIdAllGuilds(id);
                            if (link) {
                                const success = await this.baserowService.updateReadStatus(id, link.guild_id, true);
                                if (success) successCount++;
                            } else {
                                Logger.warning(`Could not find link for message ID: ${id}`);
                            }
                        }
                        Logger.success(`Marked ${successCount}/${messageIds.length} links as read via bulk action`);
                    }
                } catch (error) {
                    Logger.error('Error parsing bulk message IDs:', error);
                }
            } else {
                // Handle individual numbered reactions
                Logger.debug(`Attempting to mark single link as read: ${mapping.original_message_id} in guild: ${mapping.guild_id}`);
                const success = await this.baserowService.updateReadStatus(mapping.original_message_id, mapping.guild_id, true);
                if (success) {
                    Logger.success(`Marked link as read via DM reaction: ${mapping.original_message_id}`);
                } else {
                    Logger.error(`Failed to mark link as read: ${mapping.original_message_id}`);
                }
            }
        } else {
            Logger.warning(`No mapping found for DM message ${reaction.message.id} with emoji ${reaction.emoji.name}`);
        }
    }

    async handleDMReactionRemove(reaction, user) {
        Logger.debug(`DM reaction removal detected: ${reaction.emoji.name} on message ${reaction.message.id}`);
        
        // Find the mapping in the database
        const mapping = await this.baserowService.findDMMapping(reaction.message.id, reaction.emoji.name);
        
        if (mapping) {
            Logger.debug(`Found mapping for removal: ${JSON.stringify(mapping)}`);
            
            // Handle checkmark for "mark all as unread"
            if (reaction.emoji.name === '✅') {
                try {
                    const messageIds = JSON.parse(mapping.original_message_id);
                    if (Array.isArray(messageIds)) {
                        Logger.debug(`Bulk marking ${messageIds.length} links as unread`);
                        let successCount = 0;
                        for (const id of messageIds) {
                            // For bulk operations, we need to find the actual guild_id for each message
                            const link = await this.baserowService.findLinkByMessageIdAllGuilds(id);
                            if (link) {
                                const success = await this.baserowService.updateReadStatus(id, link.guild_id, false);
                                if (success) successCount++;
                            } else {
                                Logger.warning(`Could not find link for message ID: ${id}`);
                            }
                        }
                        Logger.success(`Marked ${successCount}/${messageIds.length} links as unread via bulk removal`);
                    }
                } catch (error) {
                    Logger.error('Error parsing bulk message IDs for removal:', error);
                }
            } else {
                // Handle individual numbered reactions
                Logger.debug(`Attempting to mark single link as unread: ${mapping.original_message_id} in guild: ${mapping.guild_id}`);
                const success = await this.baserowService.updateReadStatus(mapping.original_message_id, mapping.guild_id, false);
                if (success) {
                    Logger.success(`Marked link as unread via DM reaction removal: ${mapping.original_message_id}`);
                } else {
                    Logger.error(`Failed to mark link as unread: ${mapping.original_message_id}`);
                }
            }
        } else {
            Logger.warning(`No mapping found for DM message ${reaction.message.id} with emoji ${reaction.emoji.name} (removal)`);
        }
    }

    async handleDeletionReaction(reaction, user) {
        Logger.info(`Admin deletion request: ${reaction.emoji.name} by ${user.username} on message ${reaction.message.id}`);
        
        // Check if user has admin permissions
        const member = await reaction.message.guild.members.fetch(user.id);
        const hasAdminPerms = await this.isUserAdmin(member);
        
        // Check if user is the original poster
        const isOriginalPoster = reaction.message.author.id === user.id;
        
        Logger.debug(`Deletion permission check:`);
        Logger.debug(`   - User: ${user.username} (${user.id})`);
        Logger.debug(`   - Message author: ${reaction.message.author.username} (${reaction.message.author.id})`);
        Logger.debug(`   - Is admin: ${hasAdminPerms}`);
        Logger.debug(`   - Is original poster: ${isOriginalPoster}`);
        
        if (hasAdminPerms) {
            Logger.success(`Admin ${user.username} can delete any message, proceeding with deletion`);
        } else if (isOriginalPoster) {
            Logger.success(`Original poster ${user.username} can delete their own message, proceeding with deletion`);
        } else {
            Logger.warning(`User ${user.username} cannot delete message by ${reaction.message.author.username} (not admin, not original poster)`);
            return;
        }
        
        if (hasAdminPerms || isOriginalPoster) {
            try {
                // Delete from Baserow first
                const baserowDeleted = await this.baserowService.deleteLink(reaction.message.id, reaction.message.guild.id);
                
                // Delete the Discord message
                await reaction.message.delete();
                
                const deletionType = hasAdminPerms ? 'admin' : 'self';
                Logger.success(`Deleted Discord message ${reaction.message.id} by ${deletionType} ${user.username}`);
                
                if (baserowDeleted) {
                    Logger.success('Successfully deleted message and Baserow entry');
                } else {
                    Logger.warning('Message deleted but no Baserow entry found');
                }
                
            } catch (error) {
                Logger.error(`Error deleting message: ${error.message}`);
            }
        }
    }

    async isUserAdmin(member) {
        try {
            // Check for Discord Administrator permission (most reliable)
            if (member.permissions.has('Administrator')) {
                return true;
            }
            
            // Check for ManageMessages permission (common for moderators)
            if (member.permissions.has('ManageMessages')) {
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
            
            Logger.debug(`Admin check for ${member.user.username}:`);
            Logger.debug(`   - Administrator permission: ${member.permissions.has('Administrator')}`);
            Logger.debug(`   - ManageMessages permission: ${member.permissions.has('ManageMessages')}`);
            Logger.debug(`   - Admin role found: ${hasAdminRole}`);
            Logger.debug(`   - User roles: ${member.roles.cache.map(role => role.name).join(', ')}`);
            
            return hasAdminRole;
        } catch (error) {
            Logger.error('Error checking admin permissions:', error);
            return false;
        }
    }

}

module.exports = ReactionHandler;
