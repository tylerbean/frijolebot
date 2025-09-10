const { Pool } = require('pg');
const Logger = require('../utils/logger');

class PostgreSQLService {
    constructor(connectionConfig) {
        this.pool = new Pool(connectionConfig);
        
        // Test connection on initialization
        this.pool.on('connect', () => {
            Logger.info('PostgreSQL connection established');
        });
        
        this.pool.on('error', (err) => {
            Logger.error('PostgreSQL connection error:', err);
        });
        
        Logger.info('PostgreSQLService initialized with config:', {
            host: connectionConfig.host,
            port: connectionConfig.port,
            database: connectionConfig.database,
            user: connectionConfig.user
        });
    }

    /**
     * Initialize database schema - creates all required tables
     * @returns {Promise<boolean>} Success status
     */
    async initializeDatabase() {
        try {
            Logger.info('Initializing PostgreSQL database schema...');
            
            // Create Discord Links table
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS discord_links (
                    id SERIAL PRIMARY KEY,
                    url TEXT NOT NULL,
                    content TEXT,
                    channel_id VARCHAR(20) NOT NULL,
                    channel_name VARCHAR(100),
                    "user" VARCHAR(50) NOT NULL,
                    user_id VARCHAR(20) NOT NULL,
                    message_id VARCHAR(20) NOT NULL,
                    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
                    read BOOLEAN DEFAULT FALSE,
                    guild_id VARCHAR(20) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(message_id, guild_id)
                )
            `);

            // Create Discord DM Mapping table
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS discord_dm_mappings (
                    id SERIAL PRIMARY KEY,
                    dm_message_id VARCHAR(20) NOT NULL,
                    emoji VARCHAR(10) NOT NULL,
                    original_message_id TEXT NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    user_id VARCHAR(20) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    UNIQUE(dm_message_id, emoji)
                )
            `);

            // Create WhatsApp Sessions table
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS whatsapp_sessions (
                    id SERIAL PRIMARY KEY,
                    session_id VARCHAR(100) UNIQUE NOT NULL,
                    session_data TEXT,
                    status VARCHAR(20) DEFAULT 'active',
                    last_used TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    device_info TEXT,
                    notes TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create WhatsApp Chats table
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS whatsapp_chats (
                    id SERIAL PRIMARY KEY,
                    chat_id VARCHAR(100) UNIQUE NOT NULL,
                    discord_channel_id VARCHAR(20) NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create WhatsApp Messages table
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS whatsapp_messages (
                    id SERIAL PRIMARY KEY,
                    message_id VARCHAR(100) NOT NULL,
                    chat_id VARCHAR(100) NOT NULL,
                    sender VARCHAR(100),
                    content TEXT,
                    message_type VARCHAR(20),
                    discord_message_id VARCHAR(20),
                    discord_guild_id VARCHAR(20),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create indexes for better performance
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_discord_links_message_guild 
                ON discord_links(message_id, guild_id)
            `);
            
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_discord_links_user_guild 
                ON discord_links("user", guild_id)
            `);
            
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_discord_links_read 
                ON discord_links(read)
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_dm_mappings_dm_message_emoji 
                ON discord_dm_mappings(dm_message_id, emoji)
            `);
            
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_dm_mappings_expires_at 
                ON discord_dm_mappings(expires_at)
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_session_id 
                ON whatsapp_sessions(session_id)
            `);
            
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_status 
                ON whatsapp_sessions(status)
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_chat_id 
                ON whatsapp_chats(chat_id)
            `);
            
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_active 
                ON whatsapp_chats(is_active)
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat_id 
                ON whatsapp_messages(chat_id)
            `);
            
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_discord_message 
                ON whatsapp_messages(discord_message_id)
            `);

            Logger.success('PostgreSQL database schema initialized successfully');
            return true;
        } catch (error) {
            Logger.error('Error initializing PostgreSQL database schema:', error);
            return false;
        }
    }

    /**
     * Test database connection
     * @returns {Promise<Object>} Connection test result
     */
    async testConnection() {
        const startTime = Date.now();
        try {
            const result = await this.pool.query('SELECT NOW() as current_time, version() as version');
            const responseTime = Date.now() - startTime;
            
            // Test individual tables for health check
            const tables = {};
            
            // Test discord_links table
            try {
                const linksStartTime = Date.now();
                const linksResult = await this.pool.query('SELECT COUNT(*) as count FROM discord_links');
                tables.links = {
                    success: true,
                    responseTime: Date.now() - linksStartTime,
                    dataCount: parseInt(linksResult.rows[0].count)
                };
            } catch (error) {
                tables.links = {
                    success: false,
                    responseTime: 0,
                    error: error.message
                };
            }
            
            // Test discord_dm_mappings table
            try {
                const dmStartTime = Date.now();
                const dmResult = await this.pool.query('SELECT COUNT(*) as count FROM discord_dm_mappings');
                tables.dmMapping = {
                    success: true,
                    responseTime: Date.now() - dmStartTime,
                    dataCount: parseInt(dmResult.rows[0].count)
                };
            } catch (error) {
                tables.dmMapping = {
                    success: false,
                    responseTime: 0,
                    error: error.message
                };
            }
            
            Logger.success('PostgreSQL connection test successful');
            return {
                success: true,
                responseTime,
                currentTime: result.rows[0].current_time,
                version: result.rows[0].version,
                tables
            };
        } catch (error) {
            const responseTime = Date.now() - startTime;
            Logger.error('PostgreSQL connection test failed:', error.message);
            return {
                success: false,
                responseTime,
                error: error.message
            };
        }
    }

    // ===== DISCORD LINKS METHODS =====

    /**
     * Find a link by message ID and guild ID
     * @param {string} messageId - Discord message ID
     * @param {string} guildId - Discord guild/server ID
     * @returns {Promise<Object|null>} Link object or null if not found
     */
    async findLinkByMessageId(messageId, guildId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM discord_links WHERE message_id = $1 AND guild_id = $2',
                [messageId, guildId]
            );
            
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            Logger.error('Error finding link by message ID:', error);
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
            const result = await this.pool.query(
                'SELECT * FROM discord_links WHERE message_id = $1',
                [messageId]
            );
            
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            Logger.error('Error finding link by message ID across all guilds:', error);
            return null;
        }
    }

    /**
     * Store a new link in PostgreSQL
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

            Logger.info('Storing link in PostgreSQL:', linkData);

            const result = await this.pool.query(`
                INSERT INTO discord_links (url, content, channel_id, channel_name, "user", user_id, message_id, timestamp, read, guild_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
            `, [
                linkData.url,
                linkData.content,
                linkData.channel_id,
                linkData.channel_name,
                linkData.user,
                linkData.user_id,
                linkData.message_id,
                linkData.timestamp,
                linkData.read,
                linkData.guild_id
            ]);

            Logger.success('Link stored successfully:', result.rows[0]);
            return result.rows[0];
        } catch (error) {
            Logger.error('Error storing link in PostgreSQL:', error);
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
            const result = await this.pool.query(`
                UPDATE discord_links 
                SET read = $1, updated_at = CURRENT_TIMESTAMP 
                WHERE message_id = $2 AND guild_id = $3
                RETURNING *
            `, [readStatus, messageId, guildId]);

            if (result.rows.length === 0) {
                Logger.warning(`No link found with message ID: ${messageId} in guild: ${guildId}`);
                return false;
            }

            Logger.success(`Marked link as ${readStatus ? 'read' : 'unread'}: ${result.rows[0].url}`);
            return true;
        } catch (error) {
            Logger.error(`Error marking link as ${readStatus ? 'read' : 'unread'}:`, error);
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
            
            const result = await this.pool.query(`
                SELECT * FROM discord_links 
                WHERE message_id = $1 AND guild_id = $2
            `, [messageId, guildId]);

            if (result.rows.length === 0) {
                Logger.error('No link found with message ID:', messageId);
                return false;
            }

            const link = result.rows[0];
            Logger.debug(`Found link:`, link);
            
            // Check if reactor is different from original poster
            if (link.user !== reactorUsername) {
                Logger.success(`Reactor (${reactorUsername}) is different from original poster (${link.user}), updating read status`);
                
                await this.pool.query(`
                    UPDATE discord_links 
                    SET read = $1, updated_at = CURRENT_TIMESTAMP 
                    WHERE message_id = $2 AND guild_id = $3
                `, [readStatus, messageId, guildId]);

                Logger.success(`Marked link as ${readStatus ? 'read' : 'unread'}: ${link.url}`);
                return true;
            }

            Logger.warning(`Reactor is the same as the original poster, skipping read status update`);
            return false;
        } catch (error) {
            Logger.error(`Error updating read status from reaction:`, error);
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
            const result = await this.pool.query(`
                DELETE FROM discord_links 
                WHERE message_id = $1 AND guild_id = $2
                RETURNING *
            `, [messageId, guildId]);

            if (result.rows.length === 0) {
                Logger.warning('No link found with message ID:', messageId);
                return false;
            }

            Logger.success(`Deleted link from PostgreSQL: ${result.rows[0].url}`);
            return true;
        } catch (error) {
            Logger.error('Error deleting link from PostgreSQL:', error);
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
            const result = await this.pool.query(`
                SELECT * FROM discord_links 
                WHERE guild_id = $1 AND read = FALSE AND "user" != $2 AND url IS NOT NULL
                ORDER BY timestamp DESC
            `, [guildId, username]);

            const allLinks = result.rows;
            
            Logger.info(`Found ${allLinks.length} total unread links in guild ${guildId}`);
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
            
            // Filter for links from channels they have access to
            const unreadLinks = allLinks.filter(link => {
                const hasChannelAccess = userChannels.has(link.channel_id);
                
                Logger.debug(`Link filtering:`, {
                    user: link.user,
                    username: username,
                    read: link.read,
                    hasUrl: !!link.url,
                    hasChannelAccess: hasChannelAccess,
                    channel_id: link.channel_id,
                    passes: hasChannelAccess
                });
                
                return hasChannelAccess;
            });

            Logger.info(`Filtered to ${unreadLinks.length} unread links for ${username}`);
            return unreadLinks;
        } catch (error) {
            Logger.error('Error fetching unread links:', error);
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
            const result = await this.pool.query(`
                SELECT * FROM discord_links 
                WHERE read = FALSE AND "user" != $1 AND url IS NOT NULL
                ORDER BY timestamp DESC
            `, [username]);

            const allLinks = result.rows;
            
            Logger.info(`Found ${allLinks.length} total unread links across all guilds`);
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
            
            // Filter for unread links from servers/channels they have access to
            const unreadLinks = allLinks.filter(link => {
                const hasGuildAccess = userGuilds.has(link.guild_id);
                const hasChannelAccess = userChannels.has(link.channel_id);
                
                Logger.debug(`Link filtering:`, {
                    user: link.user,
                    username: username,
                    read: link.read,
                    hasUrl: !!link.url,
                    hasGuildAccess: hasGuildAccess,
                    hasChannelAccess: hasChannelAccess,
                    guild_id: link.guild_id,
                    channel_id: link.channel_id,
                    passes: hasGuildAccess && hasChannelAccess
                });
                
                return hasGuildAccess && hasChannelAccess;
            });

            Logger.info(`Filtered to ${unreadLinks.length} unread links for ${username} from accessible guilds`);
            return unreadLinks;
        } catch (error) {
            Logger.error('Error fetching unread links from accessible guilds:', error);
            return [];
        }
    }

    // ===== DM MAPPING METHODS =====

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

            const result = await this.pool.query(`
                INSERT INTO discord_dm_mappings (dm_message_id, emoji, original_message_id, guild_id, user_id, created_at, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [
                mappingData.dm_message_id,
                mappingData.emoji,
                mappingData.original_message_id,
                mappingData.guild_id,
                mappingData.user_id,
                mappingData.created_at,
                mappingData.expires_at
            ]);

            Logger.success('DM mapping created successfully:', result.rows[0]);
            return result.rows[0];
        } catch (error) {
            Logger.error('Error creating DM mapping:', error);
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

            const result = await this.pool.query(`
                INSERT INTO discord_dm_mappings (dm_message_id, emoji, original_message_id, guild_id, user_id, created_at, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [
                mappingData.dm_message_id,
                mappingData.emoji,
                mappingData.original_message_id,
                mappingData.guild_id,
                mappingData.user_id,
                mappingData.created_at,
                mappingData.expires_at
            ]);

            Logger.success('Bulk DM mapping created successfully:', result.rows[0]);
            return result.rows[0];
        } catch (error) {
            Logger.error('Error creating bulk DM mapping:', error);
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
            const result = await this.pool.query(`
                SELECT * FROM discord_dm_mappings 
                WHERE dm_message_id = $1 AND emoji = $2
            `, [dmMessageId, emoji]);

            if (result.rows.length === 0) {
                return null;
            }

            const mapping = result.rows[0];
            
            // Check if mapping has expired
            const expiresAt = new Date(mapping.expires_at);
            if (expiresAt < new Date()) {
                Logger.warning(`DM mapping expired for ${dmMessageId}-${emoji}, removing...`);
                await this.deleteDMMapping(mapping.id);
                return null;
            }

            return mapping;
        } catch (error) {
            Logger.error('Error finding DM mapping:', error);
            return null;
        }
    }

    /**
     * Delete a DM mapping by ID
     * @param {number} mappingId - Mapping ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteDMMapping(mappingId) {
        try {
            const result = await this.pool.query(`
                DELETE FROM discord_dm_mappings 
                WHERE id = $1
                RETURNING *
            `, [mappingId]);

            if (result.rows.length > 0) {
                Logger.success(`Deleted DM mapping: ${mappingId}`);
                return true;
            }
            return false;
        } catch (error) {
            Logger.error('Error deleting DM mapping:', error);
            return false;
        }
    }

    /**
     * Clean up expired DM mappings
     * @returns {Promise<number>} Number of mappings cleaned up
     */
    async cleanupExpiredDMMappings() {
        try {
            const result = await this.pool.query(`
                DELETE FROM discord_dm_mappings 
                WHERE expires_at < CURRENT_TIMESTAMP
                RETURNING *
            `);

            const cleanupCount = result.rows.length;
            if (cleanupCount > 0) {
                Logger.success(`Cleaned up ${cleanupCount} expired DM mappings`);
            }

            return cleanupCount;
        } catch (error) {
            Logger.error('Error cleaning up expired DM mappings:', error);
            return 0;
        }
    }

    // ===== WHATSAPP METHODS =====

    /**
     * Get active WhatsApp chats that should be monitored
     * @returns {Promise<Array>} Array of active chat configurations
     */
    async getActiveChats() {
        try {
            const result = await this.pool.query(`
                SELECT * FROM whatsapp_chats 
                WHERE is_active = TRUE
                ORDER BY created_at DESC
            `);

            return result.rows || [];
        } catch (error) {
            Logger.error('Error fetching active WhatsApp chats:', error);
            return [];
        }
    }

    /**
     * Get WhatsApp chat details by chat ID
     * @param {string} chatId - WhatsApp chat ID
     * @returns {Promise<Object|null>} Chat details or null if not found
     */
    async getChatById(chatId) {
        try {
            const result = await this.pool.query(`
                SELECT * FROM whatsapp_chats 
                WHERE chat_id = $1
            `, [chatId]);

            return result.rows[0] || null;
        } catch (error) {
            Logger.error('Error fetching chat by ID:', error);
            return null;
        }
    }

    /**
     * Check if a WhatsApp chat is being monitored
     * @param {string} chatId - WhatsApp chat ID
     * @returns {Promise<boolean>} True if chat is monitored
     */
    async isChatMonitored(chatId) {
        try {
            const result = await this.pool.query(`
                SELECT 1 FROM whatsapp_chats 
                WHERE chat_id = $1 AND is_active = TRUE
                LIMIT 1
            `, [chatId]);

            return result.rows.length > 0;
        } catch (error) {
            Logger.error('Error checking if chat is monitored:', error);
            return false;
        }
    }

    /**
     * Get Discord channel ID for a WhatsApp chat
     * @param {string} chatId - WhatsApp chat ID
     * @returns {Promise<string|null>} Discord channel ID or null
     */
    async getDiscordChannelForChat(chatId) {
        try {
            const result = await this.pool.query(`
                SELECT discord_channel_id FROM whatsapp_chats 
                WHERE chat_id = $1 AND is_active = TRUE
                LIMIT 1
            `, [chatId]);

            return result.rows.length > 0 ? result.rows[0].discord_channel_id : null;
        } catch (error) {
            Logger.error('Error getting Discord channel for chat:', error);
            return null;
        }
    }

    /**
     * Store a WhatsApp message in PostgreSQL
     * @param {Object} messageData - WhatsApp message data
     * @param {string} discordMessageId - Discord message ID where it was posted
     * @param {string} discordGuildId - Discord Guild ID for multi-tenant support
     * @returns {Promise<Object|null>} Created message record or null if failed
     */
    async storeWhatsAppMessage(messageData, discordMessageId, discordGuildId = null) {
        try {
            const messageRecord = {
                message_id: messageData.id._serialized,
                chat_id: messageData.from,
                sender: messageData._data.notifyName || messageData.from,
                content: messageData.body || '',
                message_type: messageData.type,
                discord_message_id: discordMessageId,
                discord_guild_id: discordGuildId,
                created_at: new Date().toISOString()
            };

            Logger.info('Storing WhatsApp message in PostgreSQL:', messageRecord);

            const result = await this.pool.query(`
                INSERT INTO whatsapp_messages (message_id, chat_id, sender, content, message_type, discord_message_id, discord_guild_id, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `, [
                messageRecord.message_id,
                messageRecord.chat_id,
                messageRecord.sender,
                messageRecord.content,
                messageRecord.message_type,
                messageRecord.discord_message_id,
                messageRecord.discord_guild_id,
                messageRecord.created_at
            ]);

            Logger.success('WhatsApp message stored successfully:', result.rows[0]);
            return result.rows[0];
        } catch (error) {
            Logger.error('Error storing WhatsApp message in PostgreSQL:', error);
            return null;
        }
    }

    /**
     * Save WhatsApp session data to PostgreSQL
     * @param {string} sessionId - Unique session identifier
     * @param {string} sessionData - Encrypted session data
     * @param {string} status - Session status (active, expired, needs_auth)
     * @param {string} deviceInfo - Device fingerprint info
     * @returns {Promise<Object|null>} Created session record or null if failed
     */
    async saveWhatsAppSession(sessionId, sessionData, status = 'active', deviceInfo = null) {
        try {
            // First, check if a session with this ID already exists
            const existingResult = await this.pool.query(`
                SELECT * FROM whatsapp_sessions 
                WHERE session_id = $1
            `, [sessionId]);

            const sessionRecord = {
                session_id: sessionId,
                session_data: sessionData,
                status: status,
                last_used: new Date().toISOString(),
                device_info: deviceInfo || '',
                notes: ''
            };

            Logger.info('Attempting to save WhatsApp session to PostgreSQL');
            Logger.debug('Session Record:', JSON.stringify(sessionRecord, null, 2));

            let result;
            if (existingResult.rows.length > 0) {
                // Update existing session
                const existingSession = existingResult.rows[0];
                sessionRecord.created_at = existingSession.created_at; // Preserve original creation date
                
                Logger.info('Updating existing WhatsApp session in PostgreSQL');
                
                result = await this.pool.query(`
                    UPDATE whatsapp_sessions 
                    SET session_data = $1, status = $2, last_used = $3, device_info = $4, notes = $5, updated_at = CURRENT_TIMESTAMP
                    WHERE session_id = $6
                    RETURNING *
                `, [
                    sessionRecord.session_data,
                    sessionRecord.status,
                    sessionRecord.last_used,
                    sessionRecord.device_info,
                    sessionRecord.notes,
                    sessionId
                ]);
                
                Logger.success('WhatsApp session updated successfully');
            } else {
                // Create new session
                sessionRecord.created_at = new Date().toISOString();
                
                Logger.info('Creating new WhatsApp session in PostgreSQL');
                
                result = await this.pool.query(`
                    INSERT INTO whatsapp_sessions (session_id, session_data, status, last_used, device_info, notes, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING *
                `, [
                    sessionRecord.session_id,
                    sessionRecord.session_data,
                    sessionRecord.status,
                    sessionRecord.last_used,
                    sessionRecord.device_info,
                    sessionRecord.notes,
                    sessionRecord.created_at
                ]);
                
                Logger.success('WhatsApp session created successfully');
            }

            return result.rows[0];
        } catch (error) {
            Logger.error('Error saving WhatsApp session to PostgreSQL:', error);
            return null;
        }
    }

    /**
     * Update WhatsApp session status
     * @param {string} sessionId - Session identifier
     * @param {string} status - New status
     * @param {string} notes - Optional notes
     * @returns {Promise<boolean>} Success status
     */
    async updateWhatsAppSessionStatus(sessionId, status, notes = '') {
        try {
            const updateData = {
                status: status,
                last_used: new Date().toISOString()
            };

            if (notes) {
                updateData.notes = notes;
            }

            const result = await this.pool.query(`
                UPDATE whatsapp_sessions 
                SET status = $1, last_used = $2, notes = $3, updated_at = CURRENT_TIMESTAMP
                WHERE session_id = $4
                RETURNING *
            `, [updateData.status, updateData.last_used, updateData.notes, sessionId]);

            if (result.rows.length === 0) {
                Logger.warning(`No WhatsApp session found with ID: ${sessionId}`);
                return false;
            }

            Logger.success(`Updated WhatsApp session status to: ${status}`);
            return true;
        } catch (error) {
            Logger.error('Error updating WhatsApp session status:', error);
            return false;
        }
    }

    /**
     * Get active WhatsApp session
     * @returns {Promise<Object|null>} Active session or null
     */
    async getActiveWhatsAppSession() {
        try {
            // Get all sessions (not just active ones) to properly evaluate them
            const result = await this.pool.query(`
                SELECT * FROM whatsapp_sessions 
                ORDER BY last_used DESC, created_at DESC
            `);

            const sessions = result.rows || [];
            if (sessions.length === 0) {
                return null;
            }

            // Find the most recent valid session
            for (const session of sessions) {
                if (this.isSessionValid(session)) {
                    Logger.debug(`Found valid session: ${session.session_id} (last used: ${session.last_used})`);
                    return session;
                }
            }

            // If no valid sessions found, clean up expired ones
            await this.cleanupExpiredSessions(sessions);
            return null;

        } catch (error) {
            Logger.error('Error getting active WhatsApp session:', error);
            return null;
        }
    }

    isSessionValid(session) {
        try {
            // Check if session has required fields
            if (!session.session_id || !session.status) {
                return false;
            }

            // Check if session is marked as active
            if (session.status !== 'active' && session.status !== 'authenticated') {
                return false;
            }

            // Check if session is not too old (24 hours max)
            const lastUsed = new Date(session.last_used || session.created_at);
            const now = new Date();
            const hoursSinceLastUse = (now - lastUsed) / (1000 * 60 * 60);
            
            if (hoursSinceLastUse > 24) {
                Logger.debug(`Session ${session.session_id} expired (${hoursSinceLastUse.toFixed(1)} hours old)`);
                return false;
            }

            // Check if session data is valid (if it exists)
            if (session.session_data) {
                try {
                    const sessionData = JSON.parse(session.session_data);
                    // Add any additional validation for session data here
                    if (sessionData.status === 'failed') {
                        return false;
                    }
                } catch (e) {
                    Logger.debug(`Session ${session.session_id} has invalid session_data`);
                    return false;
                }
            }

            return true;
        } catch (error) {
            Logger.error('Error validating session:', error);
            return false;
        }
    }

    async cleanupExpiredSessions(sessions) {
        try {
            const now = new Date();
            const expiredSessions = sessions.filter(session => {
                const lastUsed = new Date(session.last_used || session.created_at);
                const hoursSinceLastUse = (now - lastUsed) / (1000 * 60 * 60);
                return hoursSinceLastUse > 24 || session.status === 'failed';
            });

            for (const session of expiredSessions) {
                await this.updateWhatsAppSessionStatus(session.session_id, 'expired', 'Auto-expired due to age or failure');
                Logger.info(`Marked expired session as expired: ${session.session_id}`);
            }

            if (expiredSessions.length > 0) {
                Logger.info(`Cleaned up ${expiredSessions.length} expired sessions`);
            }
        } catch (error) {
            Logger.error('Error cleaning up expired sessions:', error);
        }
    }

    /**
     * Close the database connection pool
     */
    async close() {
        try {
            await this.pool.end();
            Logger.info('PostgreSQL connection pool closed');
        } catch (error) {
            Logger.error('Error closing PostgreSQL connection pool:', error);
        }
    }
}

module.exports = PostgreSQLService;
