/**
 * ModuleInterface - Base class for all FrijoleBot feature modules
 *
 * All modules must extend this class and implement the required lifecycle methods.
 * This ensures consistent module behavior and enables the ModuleService to manage
 * module lifecycles uniformly.
 */
class ModuleInterface {
  /**
   * @param {string} id - Unique module identifier (e.g., 'whatsapp', 'message-tracking')
   * @param {string} name - Human-readable module name
   * @param {string} description - Module purpose and functionality
   * @param {string[]} dependencies - Array of module IDs this module depends on
   */
  constructor(id, name, description = '', dependencies = []) {
    if (!id || typeof id !== 'string') {
      throw new Error('Module ID is required and must be a string');
    }
    if (!name || typeof name !== 'string') {
      throw new Error('Module name is required and must be a string');
    }
    if (!Array.isArray(dependencies)) {
      throw new Error('Dependencies must be an array');
    }

    this.id = id;
    this.name = name;
    this.description = description;
    this.dependencies = dependencies;
    this.config = {};
    this.enabled = false;
  }

  /**
   * Initialize module resources (called once when bot starts)
   * Override this method to perform one-time setup tasks
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    // Default implementation does nothing
    // Subclasses should override if needed
  }

  /**
   * Enable module (called when enabled via Admin UI)
   * Override this method to start module functionality
   *
   * @param {object} config - Module-specific configuration from database
   * @returns {Promise<void>}
   */
  async enable(config = {}) {
    this.config = config;
    this.enabled = true;
    // Subclasses should override to register commands, start listeners, etc.
  }

  /**
   * Disable module (called when disabled via Admin UI)
   * Override this method to stop module functionality
   *
   * @returns {Promise<void>}
   */
  async disable() {
    this.enabled = false;
    this.config = {};
    // Subclasses should override to unregister commands, stop listeners, etc.
  }

  /**
   * Cleanup resources (called on bot shutdown)
   * Override this method to perform teardown tasks
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Default implementation does nothing
    // Subclasses should override if needed
  }

  /**
   * Report health status
   * Override this method to provide module-specific health information
   *
   * @returns {object} Health status object with status and details
   */
  getHealth() {
    return {
      status: this.enabled ? 'healthy' : 'disabled',
      details: {
        enabled: this.enabled,
        id: this.id,
        name: this.name
      }
    };
  }

  /**
   * Get module ID
   * @returns {string}
   */
  getId() {
    return this.id;
  }

  /**
   * Get module name
   * @returns {string}
   */
  getName() {
    return this.name;
  }

  /**
   * Get module description
   * @returns {string}
   */
  getDescription() {
    return this.description;
  }

  /**
   * Get module dependencies
   * @returns {string[]}
   */
  getDependencies() {
    return this.dependencies;
  }

  /**
   * Check if module is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get current configuration
   * @returns {object}
   */
  getConfig() {
    return this.config;
  }

  /**
   * Get command definitions (to be overridden by subclasses)
   * @returns {array} Array of discord.js SlashCommandBuilder objects
   */
  getCommands() {
    return [];
  }
}

module.exports = ModuleInterface;
