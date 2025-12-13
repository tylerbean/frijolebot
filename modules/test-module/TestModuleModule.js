/**
 * TestModule - A simple test module for integration testing
 *
 * This module demonstrates the basic module lifecycle and is used
 * to verify the module management system works correctly.
 */

const ModuleInterface = require('../base/ModuleInterface');
const { SlashCommandBuilder } = require('discord.js');

class TestModuleModule extends ModuleInterface {
  constructor(services) {
    super(
      'test-module',
      'Test Module',
      'A simple test module for verifying the module system functionality',
      [] // No dependencies
    );

    this.services = services;
    this.logger = services.logger;
    this.testData = null;
  }

  /**
   * Initialize module resources
   */
  async initialize() {
    this.logger.info('[TestModule] Initializing...');
    // Perform any one-time initialization
    this.testData = {
      initialized: true,
      timestamp: new Date().toISOString()
    };
    this.logger.info('[TestModule] Initialization complete');
  }

  /**
   * Enable module
   */
  async enable(config = {}) {
    await super.enable(config);
    this.logger.info('[TestModule] Enabling with config:', config);

    // Perform module-specific enable logic
    this.testData = {
      ...this.testData,
      enabled: true,
      enabledAt: new Date().toISOString(),
      config
    };

    this.logger.info('[TestModule] Module enabled successfully');
  }

  /**
   * Disable module
   */
  async disable() {
    this.logger.info('[TestModule] Disabling...');

    // Perform module-specific disable logic
    if (this.testData) {
      this.testData.enabled = false;
      this.testData.disabledAt = new Date().toISOString();
    }

    await super.disable();
    this.logger.info('[TestModule] Module disabled successfully');
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.logger.info('[TestModule] Cleaning up...');
    this.testData = null;
    this.logger.info('[TestModule] Cleanup complete');
  }

  /**
   * Get module health status
   */
  getHealth() {
    const baseHealth = super.getHealth();

    // Add module-specific health information
    return {
      ...baseHealth,
      details: {
        ...baseHealth.details,
        testData: this.testData,
        customHealthCheck: 'All systems operational'
      }
    };
  }

  /**
   * Get slash commands for this module
   */
  getCommands() {
    return [
      new SlashCommandBuilder()
        .setName('test')
        .setDescription('Test command from the test module')
        .setDMPermission(false)
    ];
  }

  /**
   * Handle command interactions
   */
  async handleCommand(interaction) {
    if (interaction.commandName === 'test') {
      await interaction.reply({
        content: `✅ Test module is working!\n\nStatus: ${this.enabled ? 'Enabled' : 'Disabled'}\nConfig: ${JSON.stringify(this.config, null, 2)}`,
        ephemeral: true
      });
    }
  }
}

module.exports = TestModuleModule;
