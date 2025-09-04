const axios = require('axios');
const Logger = require('../utils/logger');

class BaserowService {
    constructor(apiToken, apiUrl, linksTableId, dmMappingTableId) {
        this.apiToken = apiToken;
        this.linksTableId = linksTableId;
        this.dmMappingTableId = dmMappingTableId;
        this.linksApiUrl = `${apiUrl}${linksTableId}/`;
        this.dmMappingApiUrl = `${apiUrl}${dmMappingTableId}/`;
        this.headers = {
            'Authorization': `Token ${this.apiToken}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Find a link by message ID and guild ID
     * @param {string} messageId - Discord message ID
     * @param {string} guildId - Discord guild/server ID
     * @returns {Promise<Object|null>} Link object or null if not found
     */
    async findLinkByMessageId(messageId, guildId) {
        try {
            const queryUrl = `${this.linksApiUrl}/?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"message_id","type":"equal","value":"${messageId}"},{"field":"guild_id","type":"equal","value":"${guildId}"}]}`;
            
            const response = await axios.get(queryUrl, {
                headers: { 'Authorization': `Token ${this.apiToken}` }
            });

            const links = response.data.results;
            return links.length > 0 ? links[0] : null;
        } catch (error) {
            Logger.error('Error finding link by message ID:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Find a link by message ID across all guilds (for bulk operations)
     * @param {string} messageId - Discord message ID
     * @returns {Promise<Object|null>} Link object or null if not found
     */
    async findLinkByMessageIdAllGuilds(messageId) {
        try {
            const queryUrl = `${this.linksApiUrl}/?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"message_id","type":"equal","value":"${messageId}"}]}`;
            
            const response = await axios.get(queryUrl, {
                headers: { 'Authorization': `Token ${this.apiToken}` }
            });

            const links = response.data.results;
            return links.length > 0 ? links[0] : null;
        } catch (error) {
            Logger.error('Error finding link by message ID across all guilds:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Store a new link in Baserow
     * @param {Object} messageData - Discord message data
     * @param {string} url - URL to store
     * @param {string} guildId - Discord guild/server ID
     * @returns {Promise<Object|null>} Created link object or null if failed
     */
    async storeLink(messageData, url, guildId) {
        try {
            const linkData = {
                url: url,
                content: messageData.content,
                channel_id: messageData.channel.id,
                channel_name: messageData.channel.name,
                user: messageData.author.username,
                user_id: messageData.author.id,
                message_id: messageData.id,
                timestamp: messageData.createdAt.toISOString(),
                read: false,
                guild_id: guildId
            };

            Logger.info('Storing link in Baserow:', linkData);

            const response = await axios.post(`${this.linksApiUrl}/?user_field_names=true`, linkData, {
                headers: this.headers
            });

            Logger.success('Link stored successfully:', response.data);
            return response.data;
        } catch (error) {
            Logger.error('Error storing link in Baserow:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Update link read status
     * @param {string} messageId - Discord message ID
     * @param {string} guildId - Discord guild/server ID
     * @param {boolean} readStatus - True for read, false for unread
     * @returns {Promise<boolean>} Success status
     */
    async updateReadStatus(messageId, guildId, readStatus) {
        try {
            const link = await this.findLinkByMessageId(messageId, guildId);
            if (!link) {
                Logger.warning(`No link found with message ID: ${messageId} in guild: ${guildId}`);
                return false;
            }

            await axios.patch(`${this.linksApiUrl}/${link.id}/?user_field_names=true`, {
                read: readStatus
            }, {
                headers: this.headers
            });

            Logger.success(`Marked link as ${readStatus ? 'read' : 'unread'}: ${link.url}`);
            return true;
        } catch (error) {
            Logger.error(`Error marking link as ${readStatus ? 'read' : 'unread'}:`, error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Update read status from reaction (only if reactor is different from poster)
     * @param {string} messageId - Discord message ID
     * @param {string} guildId - Discord guild/server ID
     * @param {string} reactorUsername - Username of person reacting
     * @param {boolean} readStatus - True for read, false for unread
     * @returns {Promise<boolean>} Success status
     */
    async updateReadStatusFromReaction(messageId, guildId, reactorUsername, readStatus) {
        try {
            Logger.debug(`Looking for link with message_id: ${messageId} in guild: ${guildId}`);
            Logger.debug(`Reactor username: ${reactorUsername}`);
            
            const link = await this.findLinkByMessageId(messageId, guildId);
            if (!link) {
                Logger.error('No link found with message ID:', messageId);
                return false;
            }

            Logger.debug(`Found link:`, link);
            
            // Check if reactor is different from original poster
            if (link.user !== reactorUsername) {
                Logger.success(`Reactor (${reactorUsername}) is different from original poster (${link.user}), updating read status`);
                
                await axios.patch(`${this.linksApiUrl}/${link.id}/?user_field_names=true`, {
                    read: readStatus
                }, {
                    headers: this.headers
                });

                Logger.success(`Marked link as ${readStatus ? 'read' : 'unread'}: ${link.url}`);
                return true;
            }

            Logger.warning(`Reactor is the same as the original poster, skipping read status update`);
            return false;
        } catch (error) {
            Logger.error(`Error updating read status from reaction:`, error.response?.data || error.message);
            if (error.response) {
                Logger.error('Response status:', error.response.status);
                Logger.error('Response headers:', error.response.headers);
            }
            return false;
        }
    }

    /**
     * Delete a link by message ID and guild ID
     * @param {string} messageId - Discord message ID
     * @param {string} guildId - Discord guild/server ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteLink(messageId, guildId) {
        try {
            const link = await this.findLinkByMessageId(messageId, guildId);
            if (!link) {
                Logger.warning('No link found with message ID:', messageId);
                return false;
            }
            
            await axios.delete(`${this.linksApiUrl}/${link.id}/?user_field_names=true`, {
                headers: this.headers
            });

            Logger.success(`Deleted link from Baserow: ${link.url}`);
            return true;
        } catch (error) {
            Logger.error('Error deleting link from Baserow:', error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Get all unread links for a user in a specific guild (excluding their own posts)
     * @param {string} username - Username to get unread links for
     * @param {string} guildId - Discord guild/server ID
     * @param {string} userId - Discord user ID to check channel access
     * @param {Object} discordClient - Discord client to check channel access
     * @returns {Promise<Array>} Array of unread links
     */
    async getUnreadLinksForUser(username, guildId, userId, discordClient) {
        try {
            const response = await axios.get(`${this.linksApiUrl}/?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"guild_id","type":"equal","value":"${guildId}"}]}`, {
                headers: { 'Authorization': `Token ${this.apiToken}` }
            });

            const allLinks = response.data.results;
            
            Logger.info(`Found ${allLinks.length} total links in guild ${guildId}`);
            Logger.info(`Looking for unread links for user: ${username} (${userId})`);
            
            // Get user's channel access within this guild
            const userChannels = new Set();
            try {
                const guild = discordClient.guilds.cache.get(guildId);
                if (guild) {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        for (const [channelId, channel] of guild.channels.cache) {
                            try {
                                const hasAccess = channel.permissionsFor(member)?.has('ViewChannel') ?? false;
                                if (hasAccess) {
                                    userChannels.add(channelId);
                                    Logger.debug(`User ${username} has access to channel: ${channel.name} (${channelId})`);
                                }
                            } catch (channelError) {
                                Logger.debug(`Could not check channel access for ${channelId}:`, channelError.message);
                            }
                        }
                    }
                }
            } catch (error) {
                Logger.error('Error checking user channel access:', error);
                return [];
            }
            
            Logger.info(`User ${username} has access to ${userChannels.size} channels in guild ${guildId}`);
            
            // Debug: Log all links to see their structure
            allLinks.forEach((link, index) => {
                Logger.info(`Link ${index + 1}:`, {
                    user: link.user,
                    read: link.read,
                    readType: typeof link.read,
                    url: link.url,
                    message_id: link.message_id,
                    channel_id: link.channel_id,
                    userHasChannelAccess: userChannels.has(link.channel_id)
                });
            });
            
            // Filter for unread links not posted by the requesting user AND from channels they have access to
            const unreadLinks = allLinks.filter(link => {
                const isNotOwnPost = link.user !== username;
                const isUnread = link.read === false;
                const hasUrl = !!link.url;
                const hasChannelAccess = userChannels.has(link.channel_id);
                
                Logger.info(`Link filtering:`, {
                    user: link.user,
                    username: username,
                    isNotOwnPost: isNotOwnPost,
                    read: link.read,
                    isUnread: isUnread,
                    hasUrl: hasUrl,
                    hasChannelAccess: hasChannelAccess,
                    channel_id: link.channel_id,
                    passes: isNotOwnPost && isUnread && hasUrl && hasChannelAccess
                });
                
                return isNotOwnPost && isUnread && hasUrl && hasChannelAccess;
            });

            Logger.info(`Filtered to ${unreadLinks.length} unread links for ${username}`);
            return unreadLinks;
        } catch (error) {
            Logger.error('Error fetching unread links:', error.response?.data || error.message);
            return [];
        }
    }

    /**
     * Get all unread links for a user across guilds they're members of (excluding their own posts)
     * @param {string} username - Username to get unread links for
     * @param {string} userId - Discord user ID to check server memberships
     * @param {Object} discordClient - Discord client to check server memberships
     * @returns {Promise<Array>} Array of unread links from accessible guilds
     */
    async getUnreadLinksForUserAllGuilds(username, userId, discordClient) {
        try {
            // Get all links without guild filter
            const response = await axios.get(`${this.linksApiUrl}/?user_field_names=true`, {
                headers: { 'Authorization': `Token ${this.apiToken}` }
            });

            const allLinks = response.data.results;
            
            Logger.info(`Found ${allLinks.length} total links across all guilds`);
            Logger.info(`Looking for unread links for user: ${username} (${userId})`);
            
            // Get user's current server memberships and channel access
            const userGuilds = new Set();
            const userChannels = new Set();
            try {
                for (const [guildId, guild] of discordClient.guilds.cache) {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        userGuilds.add(guildId);
                        Logger.debug(`User ${username} is member of guild: ${guild.name} (${guildId})`);
                        
                        // Check channel access within this guild
                        for (const [channelId, channel] of guild.channels.cache) {
                            try {
                                // Check if user has permission to view this channel
                                const hasAccess = channel.permissionsFor(member)?.has('ViewChannel') ?? false;
                                if (hasAccess) {
                                    userChannels.add(channelId);
                                    Logger.debug(`User ${username} has access to channel: ${channel.name} (${channelId}) in ${guild.name}`);
                                }
                            } catch (channelError) {
                                Logger.debug(`Could not check channel access for ${channelId}:`, channelError.message);
                            }
                        }
                    }
                }
            } catch (error) {
                Logger.error('Error checking user guild memberships:', error);
                return [];
            }
            
            Logger.info(`User ${username} is member of ${userGuilds.size} guilds:`, Array.from(userGuilds));
            Logger.info(`User ${username} has access to ${userChannels.size} channels:`, Array.from(userChannels));
            
            // Debug: Log all links to see their structure
            allLinks.forEach((link, index) => {
                Logger.info(`Link ${index + 1}:`, {
                    user: link.user,
                    read: link.read,
                    readType: typeof link.read,
                    url: link.url,
                    message_id: link.message_id,
                    guild_id: link.guild_id,
                    channel_id: link.channel_id,
                    userHasGuildAccess: userGuilds.has(link.guild_id),
                    userHasChannelAccess: userChannels.has(link.channel_id)
                });
            });
            
            // Filter for unread links not posted by the requesting user AND from servers/channels they have access to
            const unreadLinks = allLinks.filter(link => {
                const isNotOwnPost = link.user !== username;
                const isUnread = link.read === false;
                const hasUrl = !!link.url;
                const hasGuildAccess = userGuilds.has(link.guild_id);
                const hasChannelAccess = userChannels.has(link.channel_id);
                
                Logger.info(`Link filtering:`, {
                    user: link.user,
                    username: username,
                    isNotOwnPost: isNotOwnPost,
                    read: link.read,
                    isUnread: isUnread,
                    hasUrl: hasUrl,
                    hasGuildAccess: hasGuildAccess,
                    hasChannelAccess: hasChannelAccess,
                    guild_id: link.guild_id,
                    channel_id: link.channel_id,
                    passes: isNotOwnPost && isUnread && hasUrl && hasGuildAccess && hasChannelAccess
                });
                
                return isNotOwnPost && isUnread && hasUrl && hasGuildAccess && hasChannelAccess;
            });

            Logger.info(`Filtered to ${unreadLinks.length} unread links for ${username} from accessible guilds`);
            return unreadLinks;
        } catch (error) {
            Logger.error('Error fetching unread links from accessible guilds:', error.response?.data || error.message);
            return [];
        }
    }

    /**
     * Create a DM message mapping
     * @param {string} dmMessageId - Discord DM message ID
     * @param {string} emoji - Reaction emoji
     * @param {string} originalMessageId - Original Discord message ID
     * @param {string} guildId - Discord guild/server ID
     * @param {string} userId - Discord user ID
     * @returns {Promise<Object|null>} Created mapping object or null if failed
     */
    async createDMMapping(dmMessageId, emoji, originalMessageId, guildId, userId) {
        try {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

            const mappingData = {
                dm_message_id: dmMessageId,
                emoji: emoji,
                original_message_id: originalMessageId,
                guild_id: guildId,
                user_id: userId,
                created_at: now.toISOString(),
                expires_at: expiresAt.toISOString()
            };

            Logger.debug('Creating DM mapping:', mappingData);

            const response = await axios.post(`${this.dmMappingApiUrl}/?user_field_names=true`, mappingData, {
                headers: this.headers
            });

            Logger.success('DM mapping created successfully:', response.data);
            return response.data;
        } catch (error) {
            Logger.error('Error creating DM mapping:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Create a bulk DM mapping for checkmark reactions
     * @param {string} dmMessageId - Discord DM message ID
     * @param {Array<string>} messageIds - Array of original message IDs
     * @param {string} guildId - Discord guild/server ID
     * @param {string} userId - Discord user ID
     * @returns {Promise<Object|null>} Created mapping object or null if failed
     */
    async createBulkDMMapping(dmMessageId, messageIds, guildId, userId) {
        try {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

            const mappingData = {
                dm_message_id: dmMessageId,
                emoji: '✅',
                original_message_id: JSON.stringify(messageIds), // Store as JSON string
                guild_id: guildId,
                user_id: userId,
                created_at: now.toISOString(),
                expires_at: expiresAt.toISOString()
            };

            Logger.debug('Creating bulk DM mapping:', mappingData);

            const response = await axios.post(`${this.dmMappingApiUrl}/?user_field_names=true`, mappingData, {
                headers: this.headers
            });

            Logger.success('Bulk DM mapping created successfully:', response.data);
            return response.data;
        } catch (error) {
            Logger.error('Error creating bulk DM mapping:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Find a DM mapping by DM message ID and emoji
     * @param {string} dmMessageId - Discord DM message ID
     * @param {string} emoji - Reaction emoji
     * @returns {Promise<Object|null>} Mapping object or null if not found
     */
    async findDMMapping(dmMessageId, emoji) {
        try {
            const queryUrl = `${this.dmMappingApiUrl}/?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"dm_message_id","type":"equal","value":"${dmMessageId}"},{"field":"emoji","type":"equal","value":"${emoji}"}]}`;
            
            const response = await axios.get(queryUrl, {
                headers: { 'Authorization': `Token ${this.apiToken}` }
            });

            const mappings = response.data.results;
            if (mappings.length === 0) {
                return null;
            }

            const mapping = mappings[0];
            
            // Check if mapping has expired
            const expiresAt = new Date(mapping.expires_at);
            if (expiresAt < new Date()) {
                Logger.warning(`DM mapping expired for ${dmMessageId}-${emoji}, removing...`);
                await this.deleteDMMapping(mapping.id);
                return null;
            }

            return mapping;
        } catch (error) {
            Logger.error('Error finding DM mapping:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Delete a DM mapping by ID
     * @param {number} mappingId - Baserow mapping ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteDMMapping(mappingId) {
        try {
            await axios.delete(`${this.dmMappingApiUrl}/${mappingId}/?user_field_names=true`, {
                headers: this.headers
            });

            Logger.success(`Deleted DM mapping: ${mappingId}`);
            return true;
        } catch (error) {
            Logger.error('Error deleting DM mapping:', error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Clean up expired DM mappings
     * @returns {Promise<number>} Number of mappings cleaned up
     */
    async cleanupExpiredDMMappings() {
        try {
            const now = new Date().toISOString();
            const queryUrl = `${this.dmMappingApiUrl}/?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"expires_at","type":"date_before","value":"${now}"}]}`;
            
            const response = await axios.get(queryUrl, {
                headers: { 'Authorization': `Token ${this.apiToken}` }
            });

            const expiredMappings = response.data.results;
            let cleanupCount = 0;

            for (const mapping of expiredMappings) {
                const success = await this.deleteDMMapping(mapping.id);
                if (success) {
                    cleanupCount++;
                }
            }

            if (cleanupCount > 0) {
                Logger.success(`Cleaned up ${cleanupCount} expired DM mappings`);
            }

            return cleanupCount;
        } catch (error) {
            Logger.error('Error cleaning up expired DM mappings:', error.response?.data || error.message);
            return 0;
        }
    }

    /**
     * Test Baserow API connection for health checks
     * @returns {Promise<Object>} Connection test result
     */
    async testConnection() {
        const startTime = Date.now();
        try {
            // Make a simple API call to test connectivity
            const response = await axios.get(`${this.linksApiUrl}/?user_field_names=true&size=1`, {
                headers: { 'Authorization': `Token ${this.apiToken}` },
                timeout: 5000 // 5 second timeout
            });

            const responseTime = Date.now() - startTime;
            
            return {
                success: true,
                responseTime: responseTime,
                status: response.status,
                dataCount: response.data.results ? response.data.results.length : 0
            };
        } catch (error) {
            const responseTime = Date.now() - startTime;
            throw new Error(`Baserow API connection failed: ${error.message} (${responseTime}ms)`);
        }
    }
}

module.exports = BaserowService;
