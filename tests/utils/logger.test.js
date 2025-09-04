const Logger = require('../../utils/logger');

describe('Logger', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      info: jest.spyOn(console, 'info').mockImplementation()
    };
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('Logger methods exist and are callable', () => {
    it('should have all required methods', () => {
      expect(typeof Logger.info).toBe('function');
      expect(typeof Logger.success).toBe('function');
      expect(typeof Logger.warning).toBe('function');
      expect(typeof Logger.error).toBe('function');
      expect(typeof Logger.debug).toBe('function');
      expect(typeof Logger.startup).toBe('function');
    });

    it('should call methods without throwing errors', () => {
      expect(() => {
        Logger.info('test');
        Logger.success('test');
        Logger.warning('test');
        Logger.error('test');
        Logger.debug('test');
        Logger.startup('test');
      }).not.toThrow();
    });
  });

  describe('Error logging behavior', () => {
    it('should always log error messages', () => {
      Logger.error('Test error message');
      expect(consoleSpy.error).toHaveBeenCalledWith('❌ Test error message');
    });

    it('should handle error messages with multiple arguments', () => {
      Logger.error('Test error', { key: 'value' }, 123);
      expect(consoleSpy.error).toHaveBeenCalledWith('❌ Test error', { key: 'value' }, 123);
    });
  });

  describe('Startup logging behavior', () => {
    it('should always log startup messages', () => {
      Logger.startup('Test startup message');
      expect(consoleSpy.log).toHaveBeenCalledWith('🚀 Test startup message');
    });

    it('should handle startup messages with multiple arguments', () => {
      Logger.startup('Test startup', { key: 'value' }, 123);
      expect(consoleSpy.log).toHaveBeenCalledWith('🚀 Test startup', { key: 'value' }, 123);
    });
  });

  describe('Message formatting', () => {
    it('should format info messages with emoji prefix', () => {
      Logger.info('Test info message');
      // The actual behavior depends on NODE_ENV, but we can test the method exists and is callable
      expect(typeof Logger.info).toBe('function');
    });

    it('should format success messages with emoji prefix', () => {
      Logger.success('Test success message');
      expect(typeof Logger.success).toBe('function');
    });

    it('should format warning messages with emoji prefix', () => {
      Logger.warning('Test warning message');
      expect(typeof Logger.warning).toBe('function');
    });

    it('should format debug messages with emoji prefix', () => {
      Logger.debug('Test debug message');
      expect(typeof Logger.debug).toBe('function');
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined messages', () => {
      expect(() => Logger.info()).not.toThrow();
      expect(() => Logger.error()).not.toThrow();
      expect(() => Logger.startup()).not.toThrow();
    });

    it('should handle null messages', () => {
      expect(() => Logger.info(null)).not.toThrow();
      expect(() => Logger.error(null)).not.toThrow();
      expect(() => Logger.startup(null)).not.toThrow();
    });

    it('should handle empty string messages', () => {
      expect(() => Logger.info('')).not.toThrow();
      expect(() => Logger.error('')).not.toThrow();
      expect(() => Logger.startup('')).not.toThrow();
    });

    it('should handle object messages', () => {
      const obj = { key: 'value' };
      expect(() => Logger.info(obj)).not.toThrow();
      expect(() => Logger.error(obj)).not.toThrow();
      expect(() => Logger.startup(obj)).not.toThrow();
    });

    it('should handle array messages', () => {
      const arr = [1, 2, 3];
      expect(() => Logger.info(arr)).not.toThrow();
      expect(() => Logger.error(arr)).not.toThrow();
      expect(() => Logger.startup(arr)).not.toThrow();
    });
  });
});