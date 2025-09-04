const axios = require('axios');
const Logger = require('../utils/logger');

class BaserowService {
    constructor(apiToken, apiUrl) {
        this.apiToken = apiToken;
        this.apiUrl = apiUrl;
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
            const queryUrl = `${this.apiUrl}/?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"message_id","type":"equal","value":"${messageId}"},{"field":"guild_id","type":"equal","value":"${guildId}"}]}`;
            
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

            const response = await axios.post(`${this.apiUrl}/?user_field_names=true`, linkData, {
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

            await axios.patch(`${this.apiUrl}/${link.id}/?user_field_names=true`, {
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
                
                await axios.patch(`${this.apiUrl}/${link.id}/?user_field_names=true`, {
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
            
            await axios.delete(`${this.apiUrl}/${link.id}/?user_field_names=true`, {
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
     * @returns {Promise<Array>} Array of unread links
     */
    async getUnreadLinksForUser(username, guildId) {
        try {
            const response = await axios.get(`${this.apiUrl}/?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"guild_id","type":"equal","value":"${guildId}"}]}`, {
                headers: { 'Authorization': `Token ${this.apiToken}` }
            });

            const allLinks = response.data.results;
            
            // Filter for unread links not posted by the requesting user
            const unreadLinks = allLinks.filter(link => 
                link.user !== username && 
                link.read === false &&
                link.url // Make sure URL exists
            );

            return unreadLinks;
        } catch (error) {
            Logger.error('Error fetching unread links:', error.response?.data || error.message);
            return [];
        }
    }
}

module.exports = BaserowService;
