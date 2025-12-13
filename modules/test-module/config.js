/**
 * Test Module Configuration Schema
 *
 * Defines the configuration options for the test module
 */

module.exports = {
  schema: {
    testSetting: {
      type: 'string',
      label: 'Test Setting',
      description: 'A sample configuration setting for testing',
      default: 'default-value',
      placeholder: 'Enter a test value'
    },
    enableTestFeature: {
      type: 'boolean',
      label: 'Enable Test Feature',
      description: 'Toggle a test feature on or off',
      default: false
    },
    maxTestCount: {
      type: 'number',
      label: 'Max Test Count',
      description: 'Maximum number of test iterations',
      default: 10
    }
  },

  defaults: {
    testSetting: 'default-value',
    enableTestFeature: false,
    maxTestCount: 10
  }
};
