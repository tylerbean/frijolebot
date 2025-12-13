/**
 * ModuleService - Manages module lifecycle and state
 *
 * Responsibilities:
 * - Load modules dynamically from modules/ directory
 * - Enable/disable modules per guild with configuration
 * - Validate module dependencies before enabling
 * - Track module health and status
 * - Persist module state in PostgreSQL
 */

const { loadModules } = require('../utils/moduleLoader');

class ModuleService {
  /**
   * @param {object} services - Injected services (postgres, cache, discord, logger, scheduler)
   */
  constructor(services) {
    this.postgres = services.postgres;
    this.cache = services.cache;
    this.discord = services.discord;
    this.logger = services.logger;
    this.scheduler = services.scheduler;

    // Map of module instances: { moduleId: moduleInstance }
    this.modules = new Map();

    // Track module initialization status
    this.initialized = false;
  }

  /**
   * Load and initialize all modules
   * Called once during bot startup
   *
   * @returns {Promise<void>}
   */
  async loadModules() {
    if (this.initialized) {
      this.logger.warning('[ModuleService] Modules already loaded');
      return;
    }

    try {
      this.logger.info('[ModuleService] Loading modules...');

      // Load module instances from filesystem
      const moduleInstances = await loadModules({
        postgres: this.postgres,
        cache: this.cache,
        discord: this.discord,
        logger: this.logger,
        scheduler: this.scheduler
      }, this.logger);

      // Store modules in map
      for (const module of moduleInstances) {
        this.modules.set(module.getId(), module);
      }

      // Initialize all modules
      for (const [moduleId, module] of this.modules) {
        try {
          await module.initialize();
          this.logger.info(`[ModuleService] Initialized module: ${moduleId}`);
        } catch (error) {
          this.logger.error(`[ModuleService] Failed to initialize module ${moduleId}:`, error);
        }
      }

      // Sync module registry with database
      await this.syncModuleRegistry();

      this.initialized = true;
      this.logger.info(`[ModuleService] Loaded ${this.modules.size} modules`);

    } catch (error) {
      this.logger.error('[ModuleService] Failed to load modules:', error);
      throw error;
    }
  }

  /**
   * Sync module registry with database
   * Ensures all loaded modules are registered in the modules table
   *
   * @returns {Promise<void>}
   */
  async syncModuleRegistry() {
    try {
      for (const [moduleId, module] of this.modules) {
        const query = `
          INSERT INTO modules (id, name, description, dependencies)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            dependencies = EXCLUDED.dependencies,
            updated_at = CURRENT_TIMESTAMP
        `;

        await this.postgres.pool.query(query, [
          moduleId,
          module.getName(),
          module.getDescription(),
          module.getDependencies()
        ]);
      }

      this.logger.info('[ModuleService] Synced module registry with database');
    } catch (error) {
      this.logger.error('[ModuleService] Failed to sync module registry:', error);
      throw error;
    }
  }

  /**
   * Enable a module for a specific guild
   *
   * @param {string} moduleId - Module identifier
   * @param {string} guildId - Discord guild ID
   * @param {object} config - Module-specific configuration
   * @param {string} enabledBy - User ID who enabled the module
   * @returns {Promise<boolean>} True if enabled successfully
   */
  async enableModule(moduleId, guildId, config = {}, enabledBy = null) {
    try {
      const module = this.modules.get(moduleId);
      if (!module) {
        this.logger.error(`[ModuleService] Module not found: ${moduleId}`);
        return false;
      }

      // Validate dependencies
      const depsValid = await this.validateDependencies(moduleId, guildId);
      if (!depsValid) {
        this.logger.error(`[ModuleService] Dependency validation failed for ${moduleId}`);
        return false;
      }

      // Check if already enabled
      const existingState = await this.getModuleState(moduleId, guildId);
      if (existingState && existingState.enabled) {
        this.logger.warning(`[ModuleService] Module ${moduleId} already enabled for guild ${guildId}`);
        return true;
      }

      // Enable the module
      await module.enable(config);

      // Update database
      const query = `
        INSERT INTO module_states (module_id, guild_id, enabled, config, enabled_by, enabled_at)
        VALUES ($1, $2, TRUE, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (module_id, guild_id) DO UPDATE SET
          enabled = TRUE,
          config = EXCLUDED.config,
          enabled_by = EXCLUDED.enabled_by,
          enabled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `;

      await this.postgres.pool.query(query, [moduleId, guildId, JSON.stringify(config), enabledBy]);

      this.logger.info(`[ModuleService] Enabled module ${moduleId} for guild ${guildId}`);
      return true;

    } catch (error) {
      this.logger.error(`[ModuleService] Failed to enable module ${moduleId}:`, error);
      return false;
    }
  }

  /**
   * Disable a module for a specific guild
   *
   * @param {string} moduleId - Module identifier
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<boolean>} True if disabled successfully
   */
  async disableModule(moduleId, guildId) {
    try {
      const module = this.modules.get(moduleId);
      if (!module) {
        this.logger.error(`[ModuleService] Module not found: ${moduleId}`);
        return false;
      }

      // Check if already disabled
      const existingState = await this.getModuleState(moduleId, guildId);
      if (!existingState || !existingState.enabled) {
        this.logger.warning(`[ModuleService] Module ${moduleId} already disabled for guild ${guildId}`);
        return true;
      }

      // Disable the module
      await module.disable();

      // Update database
      const query = `
        UPDATE module_states
        SET enabled = FALSE,
            disabled_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE module_id = $1 AND guild_id = $2
      `;

      await this.postgres.pool.query(query, [moduleId, guildId]);

      this.logger.info(`[ModuleService] Disabled module ${moduleId} for guild ${guildId}`);
      return true;

    } catch (error) {
      this.logger.error(`[ModuleService] Failed to disable module ${moduleId}:`, error);
      return false;
    }
  }

  /**
   * Get module health status
   *
   * @param {string} moduleId - Module identifier
   * @param {string} guildId - Discord guild ID (optional, for guild-specific status)
   * @returns {Promise<object>} Health status object
   */
  async getModuleHealth(moduleId, guildId = null) {
    try {
      const module = this.modules.get(moduleId);
      if (!module) {
        return {
          status: 'not_found',
          details: { moduleId }
        };
      }

      // Get base health from module
      const health = module.getHealth();

      // If guild specified, add guild-specific state
      if (guildId) {
        const state = await this.getModuleState(moduleId, guildId);
        health.guildState = state || { enabled: false };
      }

      return health;

    } catch (error) {
      this.logger.error(`[ModuleService] Failed to get health for ${moduleId}:`, error);
      return {
        status: 'error',
        details: { error: error.message }
      };
    }
  }

  /**
   * Validate module dependencies are enabled
   *
   * @param {string} moduleId - Module identifier
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<boolean>} True if all dependencies are enabled
   */
  async validateDependencies(moduleId, guildId) {
    try {
      const module = this.modules.get(moduleId);
      if (!module) {
        return false;
      }

      const dependencies = module.getDependencies();
      if (!dependencies || dependencies.length === 0) {
        return true; // No dependencies
      }

      // Check each dependency is enabled
      for (const depId of dependencies) {
        const depState = await this.getModuleState(depId, guildId);
        if (!depState || !depState.enabled) {
          this.logger.warning(`[ModuleService] Dependency ${depId} not enabled for module ${moduleId}`);
          return false;
        }
      }

      return true;

    } catch (error) {
      this.logger.error(`[ModuleService] Failed to validate dependencies for ${moduleId}:`, error);
      return false;
    }
  }

  /**
   * Get module state from database
   *
   * @param {string} moduleId - Module identifier
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<object|null>} Module state or null if not found
   */
  async getModuleState(moduleId, guildId) {
    try {
      const query = `
        SELECT * FROM module_states
        WHERE module_id = $1 AND guild_id = $2
      `;

      const result = await this.postgres.pool.query(query, [moduleId, guildId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        enabled: row.enabled,
        config: row.config,
        enabledBy: row.enabled_by,
        enabledAt: row.enabled_at,
        disabledAt: row.disabled_at
      };

    } catch (error) {
      this.logger.error(`[ModuleService] Failed to get module state:`, error);
      return null;
    }
  }

  /**
   * Get all modules with their states for a guild
   *
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<array>} Array of module info objects
   */
  async getAllModules(guildId = null) {
    const moduleList = [];

    for (const [moduleId, module] of this.modules) {
      const moduleInfo = {
        id: moduleId,
        name: module.getName(),
        description: module.getDescription(),
        dependencies: module.getDependencies(),
        enabled: false,
        config: {}
      };

      if (guildId) {
        const state = await this.getModuleState(moduleId, guildId);
        if (state) {
          moduleInfo.enabled = state.enabled;
          moduleInfo.config = state.config;
        }
      }

      moduleList.push(moduleInfo);
    }

    return moduleList;
  }

  /**
   * Get a specific module instance
   *
   * @param {string} moduleId - Module identifier
   * @returns {object|null} Module instance or null
   */
  getModule(moduleId) {
    return this.modules.get(moduleId) || null;
  }

  /**
   * Cleanup all modules (called on bot shutdown)
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.logger.info('[ModuleService] Cleaning up modules...');

    for (const [moduleId, module] of this.modules) {
      try {
        await module.cleanup();
        this.logger.info(`[ModuleService] Cleaned up module: ${moduleId}`);
      } catch (error) {
        this.logger.error(`[ModuleService] Failed to cleanup module ${moduleId}:`, error);
      }
    }

    this.modules.clear();
    this.initialized = false;
  }
}

module.exports = ModuleService;
