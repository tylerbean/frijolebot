module.exports = {
  // Test environment
  testEnvironment: 'node',
  // Use native V8 coverage to avoid Babel instrumentation
  coverageProvider: 'v8',
  // Explicitly disable transforms; tests are CommonJS
  transform: {},
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'services/**/*.js',
    'handlers/**/*.js',
    'utils/**/*.js',
    'config/**/*.js',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/*.test.js',
    '!**/*.spec.js'
  ],
  
  // Disable coverage thresholds to avoid reporter bug with glob.sync in newer glob versions
  coverageThreshold: undefined,
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Test timeout
  testTimeout: 10000,
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  
  // Verbose output
  verbose: true,
  
  // Module name mapping for mocking
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  }
};