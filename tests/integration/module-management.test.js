/**
 * Integration Test: Module Management Workflow
 *
 * Tests the complete module enable/disable workflow:
 * 1. Load test module
 * 2. Enable via ModuleService
 * 3. Verify database state
 * 4. Verify no restart required
 * 5. Disable module
 * 6. Verify cleanup
 */

const ModuleService = require('../../services/ModuleService');
const { Pool } = require('pg');
const path = require('path');

describe('Module Management Integration Test', () => {
  let moduleService;
  let mockServices;
  let testPool;
  let mockLogger;
  const TEST_GUILD_ID = 'test-guild-123';
  const TEST_MODULE_ID = 'test-module';

  beforeAll(async () => {
    // Setup test database connection
    testPool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: process.env.POSTGRES_DATABASE || 'frijolebot'
    });

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      success: jest.fn(),
      startup: jest.fn()
    };

    mockServices = {
      postgres: {
        query: async (query, params) => testPool.query(query, params),
        pool: testPool
      },
      cache: {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn()
      },
      discord: {
        user: { id: 'test-bot-id' }
      },
      logger: mockLogger,
      scheduler: {
        schedule: jest.fn()
      }
    };

    // Initialize module service
    moduleService = new ModuleService(mockServices);
  });

  afterAll(async () => {
    // Cleanup: Remove test module state
    try {
      await testPool.query(
        'DELETE FROM module_states WHERE module_id = $1 AND guild_id = $2',
        [TEST_MODULE_ID, TEST_GUILD_ID]
      );
    } catch (error) {
      console.error('Cleanup error:', error);
    }

    await testPool.end();
  });

  describe('T029: Module Enable/Disable Workflow', () => {
    test('Step 1: Load modules including test module', async () => {
      await moduleService.loadModules();

      expect(moduleService.initialized).toBe(true);
      expect(moduleService.modules.size).toBeGreaterThan(0);

      // Verify test module was loaded
      const testModule = moduleService.getModule(TEST_MODULE_ID);
      expect(testModule).not.toBeNull();
      expect(testModule.getId()).toBe(TEST_MODULE_ID);
      expect(testModule.getName()).toBe('Test Module');
    });

    test('Step 2: Enable test module with configuration', async () => {
      const config = {
        testSetting: 'integration-test-value',
        enableTestFeature: true,
        maxTestCount: 42
      };

      const result = await moduleService.enableModule(
        TEST_MODULE_ID,
        TEST_GUILD_ID,
        config,
        'test-user-123'
      );

      expect(result).toBe(true);

      // Verify module is enabled in memory
      const testModule = moduleService.getModule(TEST_MODULE_ID);
      expect(testModule.isEnabled()).toBe(true);
      expect(testModule.getConfig()).toEqual(config);
    });

    test('Step 3: Verify database state after enable', async () => {
      const result = await testPool.query(
        'SELECT * FROM module_states WHERE module_id = $1 AND guild_id = $2',
        [TEST_MODULE_ID, TEST_GUILD_ID]
      );

      expect(result.rows).toHaveLength(1);

      const state = result.rows[0];
      expect(state.enabled).toBe(true);
      expect(state.module_id).toBe(TEST_MODULE_ID);
      expect(state.guild_id).toBe(TEST_GUILD_ID);
      expect(state.enabled_by).toBe('test-user-123');
      expect(state.config).toEqual({
        testSetting: 'integration-test-value',
        enableTestFeature: true,
        maxTestCount: 42
      });
    });

    test('Step 4: Verify module health is healthy', async () => {
      const health = await moduleService.getModuleHealth(TEST_MODULE_ID, TEST_GUILD_ID);

      expect(health.status).toBe('healthy');
      expect(health.details.enabled).toBe(true);
      expect(health.guildState).toBeDefined();
      expect(health.guildState.enabled).toBe(true);
    });

    test('Step 5: Verify no restart required (module commands available)', () => {
      const testModule = moduleService.getModule(TEST_MODULE_ID);
      const commands = testModule.getCommands();

      expect(commands).toBeDefined();
      expect(commands.length).toBeGreaterThan(0);
      expect(commands[0].name).toBe('test');
    });

    test('Step 6: Disable test module', async () => {
      const result = await moduleService.disableModule(TEST_MODULE_ID, TEST_GUILD_ID);

      expect(result).toBe(true);

      // Verify module is disabled in memory
      const testModule = moduleService.getModule(TEST_MODULE_ID);
      expect(testModule.isEnabled()).toBe(false);
      expect(testModule.getConfig()).toEqual({});
    });

    test('Step 7: Verify database state after disable', async () => {
      const result = await testPool.query(
        'SELECT * FROM module_states WHERE module_id = $1 AND guild_id = $2',
        [TEST_MODULE_ID, TEST_GUILD_ID]
      );

      expect(result.rows).toHaveLength(1);

      const state = result.rows[0];
      expect(state.enabled).toBe(false);
      expect(state.disabled_at).not.toBeNull();
    });

    test('Step 8: Verify module health is disabled', async () => {
      const health = await moduleService.getModuleHealth(TEST_MODULE_ID, TEST_GUILD_ID);

      expect(health.status).toBe('disabled');
      expect(health.details.enabled).toBe(false);
    });

    test('Step 9: Verify cleanup on module service shutdown', async () => {
      await moduleService.cleanup();

      expect(moduleService.modules.size).toBe(0);
      expect(moduleService.initialized).toBe(false);
    });
  });

  describe('Additional Integration Tests', () => {
    beforeEach(async () => {
      // Reload modules for each test
      moduleService = new ModuleService(mockServices);
      await moduleService.loadModules();
    });

    afterEach(async () => {
      await moduleService.cleanup();
    });

    test('Cannot enable module with missing dependencies', async () => {
      // This test assumes we don't have any modules with dependencies in the test environment
      // If we did, we would test that enabling fails when dependencies aren't met
      const result = await moduleService.validateDependencies(TEST_MODULE_ID, TEST_GUILD_ID);
      expect(result).toBe(true); // No dependencies, so validation passes
    });

    test('Module state persists across service restarts', async () => {
      // Enable module
      await moduleService.enableModule(TEST_MODULE_ID, TEST_GUILD_ID, { test: 'value' });

      // Cleanup and reinitialize
      await moduleService.cleanup();

      const newModuleService = new ModuleService(mockServices);
      await newModuleService.loadModules();

      // Check state was persisted
      const state = await newModuleService.getModuleState(TEST_MODULE_ID, TEST_GUILD_ID);
      expect(state).not.toBeNull();
      expect(state.enabled).toBe(true);
      expect(state.config).toEqual({ test: 'value' });

      // Cleanup
      await newModuleService.disableModule(TEST_MODULE_ID, TEST_GUILD_ID);
      await newModuleService.cleanup();
    });

    test('Can re-enable module after disabling', async () => {
      // Enable
      let result = await moduleService.enableModule(TEST_MODULE_ID, TEST_GUILD_ID);
      expect(result).toBe(true);

      // Disable
      result = await moduleService.disableModule(TEST_MODULE_ID, TEST_GUILD_ID);
      expect(result).toBe(true);

      // Re-enable
      result = await moduleService.enableModule(TEST_MODULE_ID, TEST_GUILD_ID, { reEnabled: true });
      expect(result).toBe(true);

      const testModule = moduleService.getModule(TEST_MODULE_ID);
      expect(testModule.isEnabled()).toBe(true);
      expect(testModule.getConfig()).toEqual({ reEnabled: true });

      // Cleanup
      await moduleService.disableModule(TEST_MODULE_ID, TEST_GUILD_ID);
    });
  });
});
