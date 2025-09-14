const http = require('http');
const Logger = require('../utils/logger');

class HealthCheckService {
    constructor(discordClient, postgresService, config) {
        this.discordClient = discordClient;
        this.postgresService = postgresService;
        this.config = config;
        this.server = null;
        this.port = config.health.port;
        this.isReady = false;
        this.startTime = Date.now();
        this.whatsappService = null; // optional injection for WhatsApp info
    }

    /**
     * Start the health check HTTP server
     */
    start() {
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.server.listen(this.port, () => {
            Logger.success(`Health check server started on port ${this.port}`);
            Logger.info(`Health check endpoints:`);
            Logger.info(`  - GET /health/live  - Liveness probe`);
            Logger.info(`  - GET /health/ready - Readiness probe`);
            Logger.info(`  - GET /health       - Combined health status`);
        });

        // Mark as ready after a short delay to allow Discord client to initialize
        setTimeout(() => {
            this.isReady = true;
            Logger.info('Health check service marked as ready');
        }, 5000);
    }

    /**
     * Handle HTTP requests
     */
    handleRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const path = url.pathname;

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json');

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Allow POST only for admin notify

        try {
            switch (path) {
                case '/health/live':
                    if (req.method === 'GET') this.handleLivenessProbe(res); else this.methodNotAllowed(res);
                    break;
                case '/health/ready':
                    if (req.method === 'GET') this.handleReadinessProbe(res); else this.methodNotAllowed(res);
                    break;
                case '/health':
                    if (req.method === 'GET') this.handleHealthCheck(res); else this.methodNotAllowed(res);
                    break;
                case '/whatsapp/chats':
                    if (req.method === 'GET') this.handleWhatsAppChats(res); else this.methodNotAllowed(res);
                    break;
                case '/admin/notify':
                    if (req.method === 'POST') this.handleAdminNotify(req, res); else this.methodNotAllowed(res);
                    break;
                default:
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Not found' }));
            }
        } catch (error) {
            Logger.error('Health check error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    }

    methodNotAllowed(res) {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }

    async handleAdminNotify(req, res) {
        try {
            const adminToken = process.env.ADMIN_NOTIFY_TOKEN || (this.config.health && this.config.health.adminToken);
            const provided = req.headers['x-admin-token'];
            if (!adminToken || provided !== adminToken) {
                Logger.warning('Unauthorized /admin/notify attempt');
                res.writeHead(401);
                res.end(JSON.stringify({ error: 'unauthorized' }));
                return;
            }

            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const raw = Buffer.concat(chunks).toString('utf-8');
            let data = {};
            try { data = JSON.parse(raw || '{}'); } catch (_) {}

            const type = data.type || 'info';
            const payload = data.payload || {};
            let message = '';
            switch (type) {
                case 'discord_channels_updated': {
                    // If feature disabled, just say disabled
                    try {
                        const on = await this.postgresService.getFeatureFlag('LINK_TRACKER_ENABLED');
                        if (!on) {
                            message = '🔧 LinkTracker is disabled.';
                            break;
                        }
                    } catch (_) {}
                    const items = Array.isArray(payload.items) ? payload.items : [];
                    const enabled = items.filter(i => i.is_active !== false);
                    const disabled = items.filter(i => i.is_active === false);
                    const fmt = (i) => (i.channel_name ? `#${i.channel_name} (${i.channel_id})` : i.channel_id) + (i.is_active === false ? ' (disabled)' : '');
                    const lines = [];
                    if (enabled.length > 0) {
                        lines.push(`✅ Enabled (${enabled.length}):`);
                        lines.push(...enabled.map(i => `• ${fmt(i)}`));
                    }
                    if (disabled.length > 0) {
                        if (lines.length > 0) lines.push('');
                        lines.push(`⛔ Disabled (${disabled.length}):`);
                        lines.push(...disabled.map(i => `• ${fmt(i)}`));
                    }
                    const total = items.length;
                    message = lines.length > 0
                      ? `🔔 LinkTracker: Monitored channels updated (${total})\n${lines.join('\n')}`
                      : '🔔 LinkTracker: Monitored channels updated (0)';
                    break;
                }
                case 'whatsapp_mappings_updated': {
                    try {
                        const on = await this.postgresService.getFeatureFlag('WHATSAPP_ENABLED');
                        if (!on) {
                            message = '🔧 WhatsApp Proxy is disabled.';
                            break;
                        }
                    } catch (_) {}
                    const items = Array.isArray(payload.items) ? payload.items : [];
                    const resolveChannelName = (id) => {
                        try {
                            if (!id || !this.discordClient) return null;
                            const ch = this.discordClient.channels?.cache?.get(id);
                            if (ch && ch.name) return `#${ch.name}`;
                            return null;
                        } catch (_) { return null; }
                    };
                    const labels = items.map(i => {
                        const chanName = i.discord_channel_name || resolveChannelName(i.discord_channel_id);
                        const chanDisplay = chanName || (i.discord_channel_id ? i.discord_channel_id : 'unset');
                        return `${i.chat_name || i.chat_id} → ${chanDisplay}${i.is_active === false ? ' (disabled)' : ''}`;
                    });
                    message = `🔔 WhatsApp Proxy: Mappings updated (${labels.length}):\n${labels.map(l => `• ${l}`).join('\n')}`;
                    break;
                }
                case 'feature_toggle': {
                    const name = payload.name || 'UNKNOWN';
                    if (name === 'AdminChannel' && payload.channelId) {
                        // Update in-memory admin channel so future messages use it
                        try { if (this.config && this.config.discord) this.config.discord.adminChannelId = payload.channelId; } catch (_) {}
                        message = `🔧 Admin notifications channel set to <#${payload.channelId}>`;
                    } else {
                        const enabled = payload.enabled ? 'enabled' : 'disabled';
                        message = `🔧 Feature toggled: ${name} is now ${enabled}${payload.message ? ` — ${payload.message}` : ''}`;
                    }
                    break;
                }
                case 'service_status': {
                    const name = payload.name || 'Service';
                    const enabled = payload.enabled ? 'enabled' : 'disabled';
                    const status = payload.statusText ? `\n${payload.statusText}` : '';
                    message = `📈 ${name} status (${enabled}):${status}`;
                    break;
                }
                case 'timezone_updated': {
                    const tz = payload.tz || 'UTC';
                    message = `🕒 Time zone set to ${tz}`;
                    break;
                }
                case 'feature_reloaded': {
                    const name = payload.name || 'UNKNOWN';
                    const enabled = payload.enabled ? 'enabled' : 'disabled';
                    message = `🔁 Feature reloaded: ${name} (${enabled})`;
                    break;
                }
                case 'cache_invalidate': {
                    // Optional: allow publishing cache invalidation via admin notify
                    try {
                        const channel = payload.channel;
                        const guildId = payload.guildId;
                        if (this.postgresService && this.config && this.config.health) {
                            // No direct cache here; the bot instance handles pub/sub. Just log.
                            message = `🧹 Cache invalidate requested for ${channel} (guild ${guildId || 'n/a'})`;
                        } else {
                            message = `🧹 Cache invalidate requested`;
                        }
                    } catch (_) {
                        message = `🧹 Cache invalidate requested`;
                    }
                    break;
                }
                default:
                    message = payload.message || 'Notification';
            }

            if (this.discordClient && this.discordClient.isReady()) {
                const targetChannelId = (payload && payload.channelId) ? payload.channelId : (this.config.discord && this.config.discord.adminChannelId);
                const ch = targetChannelId ? this.discordClient.channels.cache.get(targetChannelId) : null;
                if (ch) {
                    await ch.send(message);
                    Logger.info('Admin notify sent:', type);
                    res.writeHead(200);
                    res.end(JSON.stringify({ ok: true }));
                    return;
                }
            }
            Logger.warning('Discord not ready or admin channel missing; notification not delivered');
            res.writeHead(503);
            res.end(JSON.stringify({ ok: false, error: 'discord_not_ready' }));
        } catch (e) {
            Logger.error('Failed to handle admin notify:', e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
    }

    /**
     * Return available WhatsApp chats (from Baileys in-memory store if available)
     */
    async handleWhatsAppChats(res) {
        try {
            const wa = this.whatsappService;
            let chats = [];
            if (wa && wa.store && wa.store.chats && typeof wa.store.chats.all === 'function') {
                try {
                    const list = wa.store.chats.all();
                    chats = list.map((c) => ({
                        id: c.id,
                        name: c.name || c.id,
                        isGroup: typeof c.id === 'string' && c.id.endsWith('@g.us')
                    }));
                } catch (e) {
                    // Fallback empty
                    chats = [];
                }
            }
            // augment with live groups
            try {
                if (wa && wa.sock && typeof wa.sock.groupFetchAllParticipating === 'function') {
                    const groups = await wa.sock.groupFetchAllParticipating();
                    if (groups && typeof groups === 'object') {
                        for (const [gid, g] of Object.entries(groups)) {
                            if (!chats.find((c) => c.id === gid)) {
                                chats.push({ id: gid, name: (g && g.subject) || gid, isGroup: true });
                            }
                        }
                    }
                }
            } catch (e) {}
            // augment with contacts
            try {
                if (wa && wa.store && wa.store.contacts) {
                    const contacts = wa.store.contacts;
                    const values = typeof contacts.all === 'function' ? contacts.all() : Object.values(contacts);
                    for (const c of values) {
                        const id = c.id || c.jid;
                        if (id && !String(id).endsWith('@g.us')) {
                            const name = c.name || c.notify || c.vname || id;
                            if (!chats.find((x) => x.id === id)) {
                                chats.push({ id, name, isGroup: false });
                            }
                        }
                    }
                }
            } catch (e) {}
            // dedupe
            const seen = new Set();
            chats = chats.filter((c) => {
                if (!c || !c.id) return false;
                if (seen.has(c.id)) return false;
                seen.add(c.id);
                return true;
            });

            res.writeHead(200);
            res.end(JSON.stringify({ chats }, null, 2));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: error.message }));
        }
    }

    /**
     * Liveness probe - checks if the bot process is alive
     */
    async handleLivenessProbe(res) {
        const uptime = Date.now() - this.startTime;
        const status = {
            status: 'alive',
            timestamp: new Date().toISOString(),
            uptime: uptime,
            uptime_human: this.formatUptime(uptime)
        };

        res.writeHead(200);
        res.end(JSON.stringify(status, null, 2));
    }

    /**
     * Readiness probe - checks if the bot is ready to serve requests
     */
    async handleReadinessProbe(res) {
        const checks = await this.performHealthChecks();
        // Kubernetes readiness should not depend on Discord
        const isReady = checks.postgres.connected && this.isReady;

        const status = {
            status: isReady ? 'ready' : 'not_ready',
            timestamp: new Date().toISOString(),
            checks: checks,
            ready: this.isReady
        };

        res.writeHead(isReady ? 200 : 503);
        res.end(JSON.stringify(status, null, 2));
    }

    /**
     * Combined health check with detailed status
     */
    async handleHealthCheck(res) {
        const checks = await this.performHealthChecks();
        const discordRequired = await this.isDiscordRequired();
        const isHealthy = (discordRequired ? checks.discord.connected : true) && checks.postgres.connected && this.isReady;
        const uptime = Date.now() - this.startTime;

        const status = {
            status: isHealthy ? 'healthy' : 'unhealthy',
            timestamp: new Date().toISOString(),
            uptime: uptime,
            uptime_human: this.formatUptime(uptime),
            version: process.env.npm_package_version || '1.0.0',
            node_version: process.version,
            checks: checks,
            ready: this.isReady
        };

        res.writeHead(isHealthy ? 200 : 503);
        res.end(JSON.stringify(status, null, 2));
    }

    /**
     * Perform all health checks
     */
    async performHealthChecks() {
        const checks = {
            discord: await this.checkDiscordConnection(),
            postgres: await this.checkPostgreSQLConnection(),
            memory: this.checkMemoryUsage(),
            uptime: this.checkUptime()
        };

        return checks;
    }

    /**
     * Determine whether Discord should be considered required for health
     * Preference order: explicit config flag, then DB feature flag, fallback false
     */
    async isDiscordRequired() {
        try {
            if (this.config && this.config.discord && typeof this.config.discord.enabled === 'boolean') {
                return !!this.config.discord.enabled;
            }
        } catch (_) {}
        try {
            if (this.postgresService && typeof this.postgresService.getFeatureFlag === 'function') {
                const on = await this.postgresService.getFeatureFlag('LINK_TRACKER_ENABLED');
                return !!on;
            }
        } catch (_) {}
        return false;
    }

    /**
     * Check Discord API connection
     */
    async checkDiscordConnection() {
        try {
            if (!this.discordClient || !this.discordClient.isReady()) {
                return {
                    connected: false,
                    status: 'not_ready',
                    error: 'Discord client not ready'
                };
            }

            // Try to fetch a guild to verify API connectivity
            const guilds = this.discordClient.guilds.cache.size;
            
            return {
                connected: true,
                status: 'connected',
                guilds: guilds,
                user: this.discordClient.user ? this.discordClient.user.tag : 'unknown'
            };
        } catch (error) {
            return {
                connected: false,
                status: 'error',
                error: error.message
            };
        }
    }

    /**
     * Check PostgreSQL database connection
     */
    async checkPostgreSQLConnection() {
        try {
            // Try to make a simple connection test to PostgreSQL
            const response = await this.postgresService.testConnection();
            
            return {
                connected: true,
                status: 'connected',
                response_time: response.responseTime,
                tables: {
                    links: {
                        connected: response.tables?.links?.success || false,
                        response_time: response.tables?.links?.responseTime || 0,
                        database: (this.postgresService.pool && this.postgresService.pool.options && this.postgresService.pool.options.database) || this.config.postgres?.database,
                        data_count: response.tables?.links?.dataCount || 0
                    },
                    dmMapping: {
                        connected: response.tables?.dmMapping?.success || false,
                        response_time: response.tables?.dmMapping?.responseTime || 0,
                        database: (this.postgresService.pool && this.postgresService.pool.options && this.postgresService.pool.options.database) || this.config.postgres?.database,
                        data_count: response.tables?.dmMapping?.dataCount || 0
                    }
                }
            };
        } catch (error) {
            return {
                connected: false,
                status: 'error',
                error: error.message,
                tables: {
                    links: {
                        connected: false,
                        database: (this.postgresService.pool && this.postgresService.pool.options && this.postgresService.pool.options.database) || this.config.postgres?.database
                    },
                    dmMapping: {
                        connected: false,
                        database: (this.postgresService.pool && this.postgresService.pool.options && this.postgresService.pool.options.database) || this.config.postgres?.database
                    }
                }
            };
        }
    }

    /**
     * Check memory usage
     */
    checkMemoryUsage() {
        const memUsage = process.memoryUsage();
        const memUsageMB = {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024)
        };

        return {
            status: 'ok',
            usage: memUsageMB,
            unit: 'MB'
        };
    }

    /**
     * Check uptime
     */
    checkUptime() {
        const uptime = Date.now() - this.startTime;
        return {
            status: 'ok',
            uptime: uptime,
            uptime_human: this.formatUptime(uptime)
        };
    }

    /**
     * Format uptime in human-readable format
     */
    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    /**
     * Stop the health check server
     */
    stop() {
        if (this.server) {
            this.server.close(() => {
                Logger.info('Health check server stopped');
            });
        }
    }
}

module.exports = HealthCheckService;
