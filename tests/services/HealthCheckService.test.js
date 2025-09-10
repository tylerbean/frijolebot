const HealthCheckService = require('../../services/HealthCheckService');
const { mockConfig, mockDiscordClient } = require('../fixtures/mockData');

// Mock dependencies
jest.mock('../../utils/logger');
const Logger = require('../../utils/logger');

describe('HealthCheckService', () => {
  let healthCheckService;
  let mockPostgresService;
  let mockServer;

  beforeEach(() => {
    mockPostgresService = {
      testConnection: jest.fn()
    };

    healthCheckService = new HealthCheckService(
      mockDiscordClient,
      mockPostgresService,
      mockConfig
    );

    // Mock HTTP server
    mockServer = {
      listen: jest.fn((port, callback) => {
        if (callback) callback();
      }),
      close: jest.fn()
    };
    
    jest.spyOn(require('http'), 'createServer').mockReturnValue(mockServer);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(healthCheckService.discordClient).toBe(mockDiscordClient);
      expect(healthCheckService.postgresService).toBe(mockPostgresService);
      expect(healthCheckService.config).toBe(mockConfig);
      expect(healthCheckService.port).toBe(mockConfig.health.port);
      expect(healthCheckService.isReady).toBe(false);
      expect(typeof healthCheckService.startTime).toBe('number');
    });
  });

  describe('start', () => {
    it('should start the health check server', () => {
      healthCheckService.start();

      expect(mockServer.listen).toHaveBeenCalledWith(mockConfig.health.port, expect.any(Function));
      expect(Logger.success).toHaveBeenCalledWith(
        `Health check server started on port ${mockConfig.health.port}`
      );
    });

    it('should mark as ready after delay', (done) => {
      healthCheckService.start();

      setTimeout(() => {
        expect(healthCheckService.isReady).toBe(true);
        expect(Logger.info).toHaveBeenCalledWith('Health check service marked as ready');
        done();
      }, 5100); // Slightly more than 5 second delay
    });
  });

  describe('handleLivenessProbe', () => {
    it('should return liveness status', async () => {
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      await healthCheckService.handleLivenessProbe(mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200);
      expect(mockRes.end).toHaveBeenCalledWith(
        expect.stringContaining('"status": "alive"')
      );
    });
  });

  describe('handleReadinessProbe', () => {
    it('should return ready status when all checks pass', async () => {
      mockPostgresService.testConnection.mockResolvedValue({
        success: true,
        responseTime: 100,
        tables: {
          links: { success: true, responseTime: 50, dataCount: 5 },
          dmMapping: { success: true, responseTime: 50, dataCount: 2 }
        }
      });

      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      healthCheckService.isReady = true;

      await healthCheckService.handleReadinessProbe(mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200);
      expect(mockRes.end).toHaveBeenCalledWith(
        expect.stringContaining('"status": "ready"')
      );
    });

    it('should return not ready status when checks fail', async () => {
      mockPostgresService.testConnection.mockRejectedValue(new Error('Connection failed'));

      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      healthCheckService.isReady = true;

      await healthCheckService.handleReadinessProbe(mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(503);
      expect(mockRes.end).toHaveBeenCalledWith(
        expect.stringContaining('"status": "not_ready"')
      );
    });

    it('should return not ready when service is not ready', async () => {
      mockPostgresService.testConnection.mockResolvedValue({
        success: true,
        responseTime: 100
      });

      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      healthCheckService.isReady = false;

      await healthCheckService.handleReadinessProbe(mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(503);
      expect(mockRes.end).toHaveBeenCalledWith(
        expect.stringContaining('"status": "not_ready"')
      );
    });
  });

  describe('handleHealthCheck', () => {
    it('should return healthy status when all checks pass', async () => {
      mockPostgresService.testConnection.mockResolvedValue({
        success: true,
        responseTime: 100,
        tables: {
          links: { success: true, responseTime: 50, dataCount: 5 },
          dmMapping: { success: true, responseTime: 50, dataCount: 2 }
        }
      });

      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      healthCheckService.isReady = true;

      await healthCheckService.handleHealthCheck(mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200);
      expect(mockRes.end).toHaveBeenCalledWith(
        expect.stringContaining('"status": "healthy"')
      );
    });

    it('should return unhealthy status when checks fail', async () => {
      mockPostgresService.testConnection.mockRejectedValue(new Error('Connection failed'));

      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      healthCheckService.isReady = true;

      await healthCheckService.handleHealthCheck(mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(503);
      expect(mockRes.end).toHaveBeenCalledWith(
        expect.stringContaining('"status": "unhealthy"')
      );
    });
  });

  describe('checkDiscordConnection', () => {
    it('should return connected status when Discord client is ready', async () => {
      const result = await healthCheckService.checkDiscordConnection();

      expect(result).toEqual({
        connected: true,
        status: 'connected',
        guilds: 1,
        user: 'TestBot#1234'
      });
    });

    it('should return not ready status when Discord client is not ready', async () => {
      const mockClient = {
        isReady: () => false
      };
      healthCheckService.discordClient = mockClient;

      const result = await healthCheckService.checkDiscordConnection();

      expect(result).toEqual({
        connected: false,
        status: 'not_ready',
        error: 'Discord client not ready'
      });
    });

    it('should handle Discord client errors', async () => {
      const mockClient = {
        isReady: () => { throw new Error('Discord Error'); }
      };
      healthCheckService.discordClient = mockClient;

      const result = await healthCheckService.checkDiscordConnection();

      expect(result).toEqual({
        connected: false,
        status: 'error',
        error: 'Discord Error'
      });
    });
  });

  // Removed Baserow connection checks in HealthCheckService

  describe('checkMemoryUsage', () => {
    it('should return memory usage information', () => {
      const result = healthCheckService.checkMemoryUsage();

      expect(result).toEqual({
        status: 'ok',
        usage: {
          rss: expect.any(Number),
          heapTotal: expect.any(Number),
          heapUsed: expect.any(Number),
          external: expect.any(Number)
        },
        unit: 'MB'
      });
    });
  });

  describe('checkUptime', () => {
    it('should return uptime information', () => {
      const result = healthCheckService.checkUptime();

      expect(result).toEqual({
        status: 'ok',
        uptime: expect.any(Number),
        uptime_human: expect.any(String)
      });
    });
  });

  describe('formatUptime', () => {
    it('should format uptime correctly for seconds', () => {
      const result = healthCheckService.formatUptime(5000);
      expect(result).toBe('5s');
    });

    it('should format uptime correctly for minutes', () => {
      const result = healthCheckService.formatUptime(125000);
      expect(result).toBe('2m 5s');
    });

    it('should format uptime correctly for hours', () => {
      const result = healthCheckService.formatUptime(3665000);
      expect(result).toBe('1h 1m');
    });

    it('should format uptime correctly for days', () => {
      const result = healthCheckService.formatUptime(90061000);
      expect(result).toBe('1d 1h 1m');
    });
  });

  describe('stop', () => {
    it('should stop the health check server', () => {
      healthCheckService.server = mockServer;
      healthCheckService.stop();

      expect(mockServer.close).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should handle missing server gracefully', () => {
      healthCheckService.server = null;
      
      expect(() => healthCheckService.stop()).not.toThrow();
    });
  });
});
