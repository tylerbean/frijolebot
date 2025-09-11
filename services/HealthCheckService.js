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
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json');

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        if (req.method !== 'GET') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        try {
            switch (path) {
                case '/health/live':
                    this.handleLivenessProbe(res);
                    break;
                case '/health/ready':
                    this.handleReadinessProbe(res);
                    break;
                case '/health':
                    this.handleHealthCheck(res);
                    break;
                case '/whatsapp/chats':
                    this.handleWhatsAppChats(res);
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
        const isReady = checks.discord.connected && checks.postgres.connected && this.isReady;

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
        const isHealthy = checks.discord.connected && checks.postgres.connected && this.isReady;
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
