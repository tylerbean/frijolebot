const axios = require('axios');

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
     * Find a link by message ID
     * @param {string} messageId - Discord message ID
     * @returns {Promise<Object|null>} Link object or null if not found
     */
    async findLinkByMessageId(messageId) {
        try {
            const queryUrl = `${this.apiUrl}/?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"message_id","type":"equal","value":"${messageId}"}]}`;
            
            const response = await axios.get(queryUrl, {
                headers: { 'Authorization': `Token ${this.apiToken}` }
            });

            const links = response.data.results;
            return links.length > 0 ? links[0] : null;
        } catch (error) {
            console.error('Error finding link by message ID:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Store a new link in Baserow
     * @param {Object} messageData - Discord message data
     * @param {string} url - URL to store
     * @returns {Promise<Object|null>} Created link object or null if failed
     */
    async storeLink(messageData, url) {
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
                read: false
            };

            console.log('Storing link in Baserow:', linkData);

            const response = await axios.post(`${this.apiUrl}/?user_field_names=true`, linkData, {
                headers: this.headers
            });

            console.log('Link stored successfully:', response.data);
            return response.data;
        } catch (error) {
            console.error('Error storing link in Baserow:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Update link read status
     * @param {string} messageId - Discord message ID
     * @param {boolean} readStatus - True for read, false for unread
     * @returns {Promise<boolean>} Success status
     */
    async updateReadStatus(messageId, readStatus) {
        try {
            const link = await this.findLinkByMessageId(messageId);
            if (!link) {
                console.log(`No link found with message ID: ${messageId}`);
                return false;
            }

            await axios.patch(`${this.apiUrl}/${link.id}/?user_field_names=true`, {
                read: readStatus
            }, {
                headers: this.headers
            });

            console.log(`Marked link as ${readStatus ? 'read' : 'unread'}: ${link.url}`);
            return true;
        } catch (error) {
            console.error(`Error marking link as ${readStatus ? 'read' : 'unread'}:`, error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Update read status from reaction (only if reactor is different from poster)
     * @param {string} messageId - Discord message ID
     * @param {string} reactorUsername - Username of person reacting
     * @param {boolean} readStatus - True for read, false for unread
     * @returns {Promise<boolean>} Success status
     */
    async updateReadStatusFromReaction(messageId, reactorUsername, readStatus) {
        try {
            console.log(`🔍 Looking for link with message_id: ${messageId}`);
            console.log(`🔍 Reactor username: ${reactorUsername}`);
            
            const link = await this.findLinkByMessageId(messageId);
            if (!link) {
                console.log('❌ No link found with message ID:', messageId);
                return false;
            }

            console.log(`🔍 Found link:`, link);
            
            // Check if reactor is different from original poster
            if (link.user !== reactorUsername) {
                console.log(`✅ Reactor (${reactorUsername}) is different from original poster (${link.user}), updating read status`);
                
                await axios.patch(`${this.apiUrl}/${link.id}/?user_field_names=true`, {
                    read: readStatus
                }, {
                    headers: this.headers
                });

                console.log(`✅ Marked link as ${readStatus ? 'read' : 'unread'}: ${link.url}`);
                return true;
            }

            console.log(`⚠️ Reactor is the same as the original poster, skipping read status update`);
            return false;
        } catch (error) {
            console.error(`❌ Error updating read status from reaction:`, error.response?.data || error.message);
            if (error.response) {
                console.error('❌ Response status:', error.response.status);
                console.error('❌ Response headers:', error.response.headers);
            }
            return false;
        }
    }

    /**
     * Delete a link by message ID
     * @param {string} messageId - Discord message ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteLink(messageId) {
        try {
            const link = await this.findLinkByMessageId(messageId);
            if (!link) {
                console.log('No link found with message ID:', messageId);
                return false;
            }
            
            await axios.delete(`${this.apiUrl}/${link.id}/?user_field_names=true`, {
                headers: this.headers
            });

            console.log(`Deleted link from Baserow: ${link.url}`);
            return true;
        } catch (error) {
            console.error('Error deleting link from Baserow:', error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Get all unread links for a user (excluding their own posts)
     * @param {string} username - Username to get unread links for
     * @returns {Promise<Array>} Array of unread links
     */
    async getUnreadLinksForUser(username) {
        try {
            const response = await axios.get(`${this.apiUrl}/?user_field_names=true`, {
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
            console.error('Error fetching unread links:', error.response?.data || error.message);
            return [];
        }
    }
}

module.exports = BaserowService;
