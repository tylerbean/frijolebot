/**
 * ModuleService Tests
 *
 * Comprehensive test suite for ModuleService with 85%+ coverage
 */

const ModuleService = require('../../services/ModuleService');
const ModuleInterface = require('../../modules/base/ModuleInterface');
const { loadModules } = require('../../utils/moduleLoader');

// Mock dependencies
jest.mock('../../utils/moduleLoader');

describe('ModuleService', () => {
  let moduleService;
  let mockServices;
  let mockPostgres;
  let mockCache;
  let mockDiscord;
  let mockLogger;
  let mockScheduler;

  beforeEach(() => {
    // Setup mock services
    mockPostgres = {
      query: jest.fn(),
      pool: {
        query: jest.fn()
      }
    };

    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn()
    };

    mockDiscord = {
      user: { id: 'test-bot-id' }
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    mockScheduler = {
      schedule: jest.fn()
    };

    mockServices = {
      postgres: mockPostgres,
      cache: mockCache,
      discord: mockDiscord,
      logger: mockLogger,
      scheduler: mockScheduler
    };

    moduleService = new ModuleService(mockServices);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with provided services', () => {
      expect(moduleService.postgres).toBe(mockPostgres);
      expect(moduleService.cache).toBe(mockCache);
      expect(moduleService.discord).toBe(mockDiscord);
      expect(moduleService.logger).toBe(mockLogger);
      expect(moduleService.scheduler).toBe(mockScheduler);
      expect(moduleService.modules).toBeInstanceOf(Map);
      expect(moduleService.initialized).toBe(false);
    });
  });

  describe('loadModules', () => {
    let mockModule1;
    let mockModule2;

    beforeEach(() => {
      // Create mock modules
      mockModule1 = {
        getId: jest.fn(() => 'test-module-1'),
        getName: jest.fn(() => 'Test Module 1'),
        getDescription: jest.fn(() => 'Test description 1'),
        getDependencies: jest.fn(() => []),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined),
        getHealth: jest.fn(() => ({ status: 'healthy' }))
      };

      mockModule2 = {
        getId: jest.fn(() => 'test-module-2'),
        getName: jest.fn(() => 'Test Module 2'),
        getDescription: jest.fn(() => 'Test description 2'),
        getDependencies: jest.fn(() => ['test-module-1']),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined),
        getHealth: jest.fn(() => ({ status: 'healthy' }))
      };

      loadModules.mockResolvedValue([mockModule1, mockModule2]);
      mockPostgres.query.mockResolvedValue({ rows: [] });
    });

    test('should load modules and initialize them', async () => {
      await moduleService.loadModules();

      expect(loadModules).toHaveBeenCalledWith(mockServices, mockLogger);
      expect(mockModule1.initialize).toHaveBeenCalled();
      expect(mockModule2.initialize).toHaveBeenCalled();
      expect(moduleService.modules.size).toBe(2);
      expect(moduleService.initialized).toBe(true);
    });

    test('should sync module registry with database', async () => {
      await moduleService.loadModules();

      expect(mockPostgres.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO modules'),
        ['test-module-1', 'Test Module 1', 'Test description 1', []]
      );
      expect(mockPostgres.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO modules'),
        ['test-module-2', 'Test Module 2', 'Test description 2', ['test-module-1']]
      );
    });

    test('should handle module initialization errors gracefully', async () => {
      mockModule1.initialize.mockRejectedValue(new Error('Init failed'));

      await moduleService.loadModules();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize module'),
        expect.any(Error)
      );
      expect(moduleService.initialized).toBe(true); // Should still mark as initialized
    });

    test('should not reload if already initialized', async () => {
      await moduleService.loadModules();
      jest.clearAllMocks();

      await moduleService.loadModules();

      expect(loadModules).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already loaded')
      );
    });

    test('should throw error if module loading fails critically', async () => {
      loadModules.mockRejectedValue(new Error('Critical load failure'));

      await expect(moduleService.loadModules()).rejects.toThrow('Critical load failure');
    });
  });

  describe('enableModule', () => {
    let mockModule;

    beforeEach(async () => {
      mockModule = {
        getId: jest.fn(() => 'test-module'),
        getName: jest.fn(() => 'Test Module'),
        getDescription: jest.fn(() => 'Test description'),
        getDependencies: jest.fn(() => []),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined),
        getHealth: jest.fn(() => ({ status: 'healthy' }))
      };

      loadModules.mockResolvedValue([mockModule]);
      mockPostgres.query.mockResolvedValue({ rows: [] });
      await moduleService.loadModules();
      jest.clearAllMocks();
    });

    test('should enable a module successfully', async () => {
      const config = { setting1: 'value1' };
      const result = await moduleService.enableModule('test-module', 'guild-123', config, 'user-456');

      expect(result).toBe(true);
      expect(mockModule.enable).toHaveBeenCalledWith(config);
      expect(mockPostgres.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO module_states'),
        ['test-module', 'guild-123', JSON.stringify(config), 'user-456']
      );
    });

    test('should return false if module not found', async () => {
      const result = await moduleService.enableModule('nonexistent-module', 'guild-123');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Module not found')
      );
    });

    test('should validate dependencies before enabling', async () => {
      jest.spyOn(moduleService, 'validateDependencies').mockResolvedValue(false);

      const result = await moduleService.enableModule('test-module', 'guild-123');

      expect(result).toBe(false);
      expect(mockModule.enable).not.toHaveBeenCalled();
    });

    test('should skip enabling if already enabled', async () => {
      jest.spyOn(moduleService, 'getModuleState').mockResolvedValue({
        enabled: true,
        config: {}
      });

      const result = await moduleService.enableModule('test-module', 'guild-123');

      expect(result).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already enabled')
      );
    });

    test('should handle enable errors gracefully', async () => {
      mockModule.enable.mockRejectedValue(new Error('Enable failed'));

      const result = await moduleService.enableModule('test-module', 'guild-123');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('disableModule', () => {
    let mockModule;

    beforeEach(async () => {
      mockModule = {
        getId: jest.fn(() => 'test-module'),
        getName: jest.fn(() => 'Test Module'),
        getDescription: jest.fn(() => 'Test description'),
        getDependencies: jest.fn(() => []),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined),
        getHealth: jest.fn(() => ({ status: 'healthy' }))
      };

      loadModules.mockResolvedValue([mockModule]);
      mockPostgres.query.mockResolvedValue({ rows: [] });
      await moduleService.loadModules();
      jest.clearAllMocks();
    });

    test('should disable a module successfully', async () => {
      jest.spyOn(moduleService, 'getModuleState').mockResolvedValue({
        enabled: true,
        config: {}
      });

      const result = await moduleService.disableModule('test-module', 'guild-123');

      expect(result).toBe(true);
      expect(mockModule.disable).toHaveBeenCalled();
      expect(mockPostgres.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE module_states'),
        ['test-module', 'guild-123']
      );
    });

    test('should return false if module not found', async () => {
      const result = await moduleService.disableModule('nonexistent-module', 'guild-123');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Module not found')
      );
    });

    test('should skip disabling if already disabled', async () => {
      jest.spyOn(moduleService, 'getModuleState').mockResolvedValue({
        enabled: false,
        config: {}
      });

      const result = await moduleService.disableModule('test-module', 'guild-123');

      expect(result).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('already disabled')
      );
    });

    test('should handle disable errors gracefully', async () => {
      jest.spyOn(moduleService, 'getModuleState').mockResolvedValue({
        enabled: true,
        config: {}
      });
      mockModule.disable.mockRejectedValue(new Error('Disable failed'));

      const result = await moduleService.disableModule('test-module', 'guild-123');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('validateDependencies', () => {
    let mockModule1;
    let mockModule2;

    beforeEach(async () => {
      mockModule1 = {
        getId: jest.fn(() => 'module-1'),
        getName: jest.fn(() => 'Module 1'),
        getDescription: jest.fn(() => 'Description 1'),
        getDependencies: jest.fn(() => []),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };

      mockModule2 = {
        getId: jest.fn(() => 'module-2'),
        getName: jest.fn(() => 'Module 2'),
        getDescription: jest.fn(() => 'Description 2'),
        getDependencies: jest.fn(() => ['module-1']),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };

      loadModules.mockResolvedValue([mockModule1, mockModule2]);
      mockPostgres.query.mockResolvedValue({ rows: [] });
      await moduleService.loadModules();
      jest.clearAllMocks();
    });

    test('should return true if no dependencies', async () => {
      const result = await moduleService.validateDependencies('module-1', 'guild-123');

      expect(result).toBe(true);
    });

    test('should return true if all dependencies are enabled', async () => {
      jest.spyOn(moduleService, 'getModuleState').mockResolvedValue({
        enabled: true,
        config: {}
      });

      const result = await moduleService.validateDependencies('module-2', 'guild-123');

      expect(result).toBe(true);
    });

    test('should return false if dependency is not enabled', async () => {
      jest.spyOn(moduleService, 'getModuleState').mockResolvedValue({
        enabled: false,
        config: {}
      });

      const result = await moduleService.validateDependencies('module-2', 'guild-123');

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Dependency module-1 not enabled')
      );
    });

    test('should return false if module not found', async () => {
      const result = await moduleService.validateDependencies('nonexistent', 'guild-123');

      expect(result).toBe(false);
    });
  });

  describe('getModuleHealth', () => {
    let mockModule;

    beforeEach(async () => {
      mockModule = {
        getId: jest.fn(() => 'test-module'),
        getName: jest.fn(() => 'Test Module'),
        getDescription: jest.fn(() => 'Test description'),
        getDependencies: jest.fn(() => []),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined),
        getHealth: jest.fn(() => ({
          status: 'healthy',
          details: { enabled: true }
        }))
      };

      loadModules.mockResolvedValue([mockModule]);
      mockPostgres.query.mockResolvedValue({ rows: [] });
      await moduleService.loadModules();
      jest.clearAllMocks();
    });

    test('should return module health', async () => {
      const health = await moduleService.getModuleHealth('test-module');

      expect(health.status).toBe('healthy');
      expect(mockModule.getHealth).toHaveBeenCalled();
    });

    test('should include guild state if guild ID provided', async () => {
      jest.spyOn(moduleService, 'getModuleState').mockResolvedValue({
        enabled: true,
        config: { setting: 'value' }
      });

      const health = await moduleService.getModuleHealth('test-module', 'guild-123');

      expect(health.guildState).toEqual({
        enabled: true,
        config: { setting: 'value' }
      });
    });

    test('should return not_found if module does not exist', async () => {
      const health = await moduleService.getModuleHealth('nonexistent');

      expect(health.status).toBe('not_found');
      expect(health.details.moduleId).toBe('nonexistent');
    });

    test('should handle errors gracefully', async () => {
      mockModule.getHealth.mockImplementation(() => {
        throw new Error('Health check failed');
      });

      const health = await moduleService.getModuleHealth('test-module');

      expect(health.status).toBe('error');
      expect(health.details.error).toBe('Health check failed');
    });
  });

  describe('getModuleState', () => {
    test('should retrieve module state from database', async () => {
      mockPostgres.query.mockResolvedValue({
        rows: [{
          enabled: true,
          config: { setting: 'value' },
          enabled_by: 'user-123',
          enabled_at: new Date(),
          disabled_at: null
        }]
      });

      const state = await moduleService.getModuleState('test-module', 'guild-123');

      expect(state.enabled).toBe(true);
      expect(state.config).toEqual({ setting: 'value' });
      expect(mockPostgres.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM module_states'),
        ['test-module', 'guild-123']
      );
    });

    test('should return null if no state found', async () => {
      mockPostgres.query.mockResolvedValue({ rows: [] });

      const state = await moduleService.getModuleState('test-module', 'guild-123');

      expect(state).toBeNull();
    });

    test('should handle database errors gracefully', async () => {
      mockPostgres.query.mockRejectedValue(new Error('DB error'));

      const state = await moduleService.getModuleState('test-module', 'guild-123');

      expect(state).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getAllModules', () => {
    beforeEach(async () => {
      const mockModule1 = {
        getId: jest.fn(() => 'module-1'),
        getName: jest.fn(() => 'Module 1'),
        getDescription: jest.fn(() => 'Description 1'),
        getDependencies: jest.fn(() => []),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };

      const mockModule2 = {
        getId: jest.fn(() => 'module-2'),
        getName: jest.fn(() => 'Module 2'),
        getDescription: jest.fn(() => 'Description 2'),
        getDependencies: jest.fn(() => ['module-1']),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };

      loadModules.mockResolvedValue([mockModule1, mockModule2]);
      mockPostgres.query.mockResolvedValue({ rows: [] });
      await moduleService.loadModules();
      jest.clearAllMocks();
    });

    test('should return all modules without guild info', async () => {
      const modules = await moduleService.getAllModules();

      expect(modules).toHaveLength(2);
      expect(modules[0].id).toBe('module-1');
      expect(modules[1].id).toBe('module-2');
      expect(modules[0].enabled).toBe(false);
    });

    test('should include guild state when guild ID provided', async () => {
      jest.spyOn(moduleService, 'getModuleState')
        .mockResolvedValueOnce({ enabled: true, config: { a: 1 } })
        .mockResolvedValueOnce({ enabled: false, config: {} });

      const modules = await moduleService.getAllModules('guild-123');

      expect(modules[0].enabled).toBe(true);
      expect(modules[0].config).toEqual({ a: 1 });
      expect(modules[1].enabled).toBe(false);
    });
  });

  describe('getModule', () => {
    beforeEach(async () => {
      const mockModule = {
        getId: jest.fn(() => 'test-module'),
        getName: jest.fn(() => 'Test Module'),
        getDescription: jest.fn(() => 'Test description'),
        getDependencies: jest.fn(() => []),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };

      loadModules.mockResolvedValue([mockModule]);
      mockPostgres.query.mockResolvedValue({ rows: [] });
      await moduleService.loadModules();
    });

    test('should return module instance if exists', () => {
      const module = moduleService.getModule('test-module');

      expect(module).not.toBeNull();
      expect(module.getId()).toBe('test-module');
    });

    test('should return null if module does not exist', () => {
      const module = moduleService.getModule('nonexistent');

      expect(module).toBeNull();
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      const mockModule1 = {
        getId: jest.fn(() => 'module-1'),
        getName: jest.fn(() => 'Module 1'),
        getDescription: jest.fn(() => 'Description 1'),
        getDependencies: jest.fn(() => []),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };

      const mockModule2 = {
        getId: jest.fn(() => 'module-2'),
        getName: jest.fn(() => 'Module 2'),
        getDescription: jest.fn(() => 'Description 2'),
        getDependencies: jest.fn(() => []),
        initialize: jest.fn().mockResolvedValue(undefined),
        enable: jest.fn().mockResolvedValue(undefined),
        disable: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined)
      };

      loadModules.mockResolvedValue([mockModule1, mockModule2]);
      mockPostgres.query.mockResolvedValue({ rows: [] });
      await moduleService.loadModules();
      jest.clearAllMocks();
    });

    test('should cleanup all modules', async () => {
      await moduleService.cleanup();

      expect(moduleService.modules.size).toBe(0);
      expect(moduleService.initialized).toBe(false);
    });

    test('should handle cleanup errors gracefully', async () => {
      const modules = Array.from(moduleService.modules.values());
      modules[0].cleanup.mockRejectedValue(new Error('Cleanup failed'));

      await moduleService.cleanup();

      expect(mockLogger.error).toHaveBeenCalled();
      expect(moduleService.modules.size).toBe(0);
    });
  });
});
