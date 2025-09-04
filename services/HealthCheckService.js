const http = require('http');
const Logger = require('../utils/logger');

class HealthCheckService {
    constructor(discordClient, baserowService, config) {
        this.discordClient = discordClient;
        this.baserowService = baserowService;
        this.config = config;
        this.server = null;
        this.port = config.health.port;
        this.isReady = false;
        this.startTime = Date.now();
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
        const isReady = checks.discord.connected && checks.baserow.connected && this.isReady;

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
        const isHealthy = checks.discord.connected && checks.baserow.connected && this.isReady;
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
            baserow: await this.checkBaserowConnection(),
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
     * Check Baserow API connection
     */
    async checkBaserowConnection() {
        try {
            // Try to make a simple API call to Baserow
            const response = await this.baserowService.testConnection();
            
            return {
                connected: true,
                status: 'connected',
                response_time: response.responseTime,
                api_url: this.config.baserow.apiUrl
            };
        } catch (error) {
            return {
                connected: false,
                status: 'error',
                error: error.message,
                api_url: this.config.baserow.apiUrl
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
