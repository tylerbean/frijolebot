/**
 * moduleLoader Tests
 *
 * Comprehensive test suite for moduleLoader with 85%+ coverage
 */

const fs = require('fs');
const path = require('path');
const { loadModules, validateModuleStructure } = require('../../utils/moduleLoader');
const ModuleInterface = require('../../modules/base/ModuleInterface');

// Mock fs module
jest.mock('fs');

describe('moduleLoader', () => {
  let mockLogger;
  let mockServices;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockServices = {
      postgres: {},
      cache: {},
      discord: {},
      logger: mockLogger,
      scheduler: {}
    };

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('loadModules', () => {
    test('should create modules directory if it does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockImplementation(() => {});

      const modules = await loadModules(mockServices, mockLogger);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('modules'),
        { recursive: true }
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('modules/ directory not found')
      );
      expect(modules).toEqual([]);
    });

    test('should return empty array if no module directories found', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'base', isDirectory: () => true }
      ]);

      const modules = await loadModules(mockServices, mockLogger);

      expect(modules).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found 0 module directories')
      );
    });

    test('should skip non-directory entries', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'base', isDirectory: () => true },
        { name: 'some-file.js', isDirectory: () => false },
        { name: 'test-module', isDirectory: () => true }
      ]);
      fs.existsSync.mockImplementation((p) => {
        // Modules directory exists, but module file doesn't
        return p.endsWith('modules');
      });

      const modules = await loadModules(mockServices, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 module directories')
      );
    });

    test('should skip base directory', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'base', isDirectory: () => true },
        { name: 'test-module', isDirectory: () => true }
      ]);
      fs.existsSync.mockImplementation((p) => {
        return p.endsWith('modules');
      });

      await loadModules(mockServices, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 module directories')
      );
    });

    test('should load valid module and instantiate it', async () => {
      // Mock module class that extends ModuleInterface
      class TestModule extends ModuleInterface {
        constructor(services) {
          super('test-module', 'Test Module', 'Test description');
          this.services = services;
        }
      }

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'test-module', isDirectory: () => true }
      ]);

      // Mock file exists for module file
      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('modules')) return true;
        if (p.endsWith('TestModuleModule.js')) return true;
        return false;
      });

      // Mock require to return our test module class
      jest.doMock(path.join(process.cwd(), 'modules', 'test-module', 'TestModuleModule.js'), () => TestModule, { virtual: true });

      const modules = await loadModules(mockServices, mockLogger);

      expect(modules).toHaveLength(1);
      expect(modules[0]).toBeInstanceOf(ModuleInterface);
      expect(modules[0].getId()).toBe('test-module');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Loaded module: test-module')
      );
    });

    test('should warn if module file not found', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'missing-module', isDirectory: () => true }
      ]);

      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('modules')) return true;
        return false; // Module file doesn't exist
      });

      const modules = await loadModules(mockServices, mockLogger);

      expect(modules).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Module file not found')
      );
    });

    test('should warn if module does not extend ModuleInterface', async () => {
      // Mock module class that does NOT extend ModuleInterface
      class InvalidModule {
        constructor() {}
      }

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'invalid-module', isDirectory: () => true }
      ]);

      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('modules')) return true;
        if (p.endsWith('InvalidModuleModule.js')) return true;
        return false;
      });

      jest.doMock(path.join(process.cwd(), 'modules', 'invalid-module', 'InvalidModuleModule.js'), () => InvalidModule, { virtual: true });

      const modules = await loadModules(mockServices, mockLogger);

      expect(modules).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('does not extend ModuleInterface')
      );
    });

    test('should handle module instantiation errors gracefully', async () => {
      // Mock module class that throws error on construction
      class ErrorModule extends ModuleInterface {
        constructor(services) {
          super('error-module', 'Error Module');
          throw new Error('Instantiation failed');
        }
      }

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'error-module', isDirectory: () => true }
      ]);

      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('modules')) return true;
        if (p.endsWith('ErrorModuleModule.js')) return true;
        return false;
      });

      jest.doMock(path.join(process.cwd(), 'modules', 'error-module', 'ErrorModuleModule.js'), () => ErrorModule, { virtual: true });

      const modules = await loadModules(mockServices, mockLogger);

      expect(modules).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load module'),
        expect.any(Error)
      );
    });

    test('should convert kebab-case directory names to PascalCase', async () => {
      class MyTestModule extends ModuleInterface {
        constructor(services) {
          super('my-test-module', 'My Test Module');
        }
      }

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'my-test-module', isDirectory: () => true }
      ]);

      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('modules')) return true;
        if (p.endsWith('MyTestModuleModule.js')) return true;
        return false;
      });

      jest.doMock(path.join(process.cwd(), 'modules', 'my-test-module', 'MyTestModuleModule.js'), () => MyTestModule, { virtual: true });

      const modules = await loadModules(mockServices, mockLogger);

      expect(modules).toHaveLength(1);
      expect(modules[0].getId()).toBe('my-test-module');
    });

    test('should handle overall loading errors gracefully', async () => {
      fs.existsSync.mockImplementation(() => {
        throw new Error('Filesystem error');
      });

      const modules = await loadModules(mockServices, mockLogger);

      expect(modules).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error loading modules'),
        expect.any(Error)
      );
    });

    test('should load multiple modules successfully', async () => {
      class Module1 extends ModuleInterface {
        constructor(services) {
          super('module-1', 'Module 1');
        }
      }

      class Module2 extends ModuleInterface {
        constructor(services) {
          super('module-2', 'Module 2');
        }
      }

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'module-1', isDirectory: () => true },
        { name: 'module-2', isDirectory: () => true }
      ]);

      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('modules')) return true;
        if (p.endsWith('Module1Module.js')) return true;
        if (p.endsWith('Module2Module.js')) return true;
        return false;
      });

      jest.doMock(path.join(process.cwd(), 'modules', 'module-1', 'Module1Module.js'), () => Module1, { virtual: true });
      jest.doMock(path.join(process.cwd(), 'modules', 'module-2', 'Module2Module.js'), () => Module2, { virtual: true });

      const modules = await loadModules(mockServices, mockLogger);

      expect(modules).toHaveLength(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully loaded 2 modules')
      );
    });

    test('should continue loading other modules even if one fails', async () => {
      class GoodModule extends ModuleInterface {
        constructor(services) {
          super('good-module', 'Good Module');
        }
      }

      class BadModule extends ModuleInterface {
        constructor(services) {
          super('bad-module', 'Bad Module');
          throw new Error('Bad module error');
        }
      }

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        { name: 'bad-module', isDirectory: () => true },
        { name: 'good-module', isDirectory: () => true }
      ]);

      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('modules')) return true;
        if (p.endsWith('BadModuleModule.js')) return true;
        if (p.endsWith('GoodModuleModule.js')) return true;
        return false;
      });

      jest.doMock(path.join(process.cwd(), 'modules', 'bad-module', 'BadModuleModule.js'), () => BadModule, { virtual: true });
      jest.doMock(path.join(process.cwd(), 'modules', 'good-module', 'GoodModuleModule.js'), () => GoodModule, { virtual: true });

      const modules = await loadModules(mockServices, mockLogger);

      expect(modules).toHaveLength(1);
      expect(modules[0].getId()).toBe('good-module');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('validateModuleStructure', () => {
    test('should return true if all required files exist', () => {
      fs.existsSync.mockReturnValue(true);

      const result = validateModuleStructure('/path/to/module');

      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('commands.js')
      );
      expect(fs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('config.js')
      );
    });

    test('should return false if commands.js is missing', () => {
      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('commands.js')) return false;
        return true;
      });

      const result = validateModuleStructure('/path/to/module');

      expect(result).toBe(false);
    });

    test('should return false if config.js is missing', () => {
      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('config.js')) return false;
        return true;
      });

      const result = validateModuleStructure('/path/to/module');

      expect(result).toBe(false);
    });

    test('should return false if both required files are missing', () => {
      fs.existsSync.mockReturnValue(false);

      const result = validateModuleStructure('/path/to/module');

      expect(result).toBe(false);
    });

    test('should check files in correct module path', () => {
      fs.existsSync.mockReturnValue(true);

      validateModuleStructure('/custom/path/my-module');

      expect(fs.existsSync).toHaveBeenCalledWith('/custom/path/my-module/commands.js');
      expect(fs.existsSync).toHaveBeenCalledWith('/custom/path/my-module/config.js');
    });
  });
});
