/**
 * ModuleHandler - Manages Discord command registration and routing for modules
 *
 * Responsibilities:
 * - Register slash commands from enabled modules
 * - Unregister commands when modules are disabled
 * - Route incoming commands to appropriate module handlers
 * - Handle module-specific command interactions
 */

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

class ModuleHandler {
  /**
   * @param {object} services - Injected services (moduleService, discord, logger)
   */
  constructor(services) {
    this.moduleService = services.moduleService;
    this.discord = services.discord;
    this.logger = services.logger;

    // Map of command names to module IDs: { commandName: moduleId }
    this.commandRegistry = new Map();

    // Discord REST client for command registration
    this.rest = null;
  }

  /**
   * Initialize handler and set up Discord REST client
   *
   * @param {string} token - Discord bot token
   * @param {string} clientId - Discord bot client ID
   * @returns {Promise<void>}
   */
  async initialize(token, clientId) {
    this.rest = new REST({ version: '10' }).setToken(token);
    this.clientId = clientId;
    this.logger.info('[ModuleHandler] Initialized');
  }

  /**
   * Register commands from a module for a specific guild
   *
   * @param {string} moduleId - Module identifier
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<boolean>} True if registered successfully
   */
  async registerModuleCommands(moduleId, guildId) {
    try {
      const module = this.moduleService.getModule(moduleId);
      if (!module) {
        this.logger.error(`[ModuleHandler] Module not found: ${moduleId}`);
        return false;
      }

      // Get commands from module
      const commands = module.getCommands();
      if (!commands || commands.length === 0) {
        this.logger.info(`[ModuleHandler] No commands to register for module ${moduleId}`);
        return true;
      }

      // Convert command builders to JSON
      const commandData = commands.map(cmd => cmd.toJSON());

      // Register commands with Discord API
      await this.rest.put(
        Routes.applicationGuildCommands(this.clientId, guildId),
        { body: commandData }
      );

      // Update command registry
      for (const cmd of commands) {
        const commandName = cmd.name;
        this.commandRegistry.set(commandName, moduleId);
        this.logger.info(`[ModuleHandler] Registered command /${commandName} for module ${moduleId}`);
      }

      this.logger.info(`[ModuleHandler] Registered ${commands.length} commands for module ${moduleId} in guild ${guildId}`);
      return true;

    } catch (error) {
      this.logger.error(`[ModuleHandler] Failed to register commands for module ${moduleId}:`, error);
      return false;
    }
  }

  /**
   * Unregister commands from a module for a specific guild
   *
   * @param {string} moduleId - Module identifier
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<boolean>} True if unregistered successfully
   */
  async unregisterModuleCommands(moduleId, guildId) {
    try {
      const module = this.moduleService.getModule(moduleId);
      if (!module) {
        this.logger.error(`[ModuleHandler] Module not found: ${moduleId}`);
        return false;
      }

      // Get current guild commands
      const guildCommands = await this.rest.get(
        Routes.applicationGuildCommands(this.clientId, guildId)
      );

      // Get module command names
      const moduleCommands = module.getCommands();
      const moduleCommandNames = new Set(moduleCommands.map(cmd => cmd.name));

      // Delete commands that belong to this module
      for (const cmd of guildCommands) {
        if (moduleCommandNames.has(cmd.name)) {
          await this.rest.delete(
            Routes.applicationGuildCommand(this.clientId, guildId, cmd.id)
          );

          // Remove from registry
          this.commandRegistry.delete(cmd.name);
          this.logger.info(`[ModuleHandler] Unregistered command /${cmd.name} for module ${moduleId}`);
        }
      }

      this.logger.info(`[ModuleHandler] Unregistered commands for module ${moduleId} in guild ${guildId}`);
      return true;

    } catch (error) {
      this.logger.error(`[ModuleHandler] Failed to unregister commands for module ${moduleId}:`, error);
      return false;
    }
  }

  /**
   * Route an incoming command interaction to the appropriate module
   *
   * @param {object} interaction - Discord interaction object
   * @returns {Promise<boolean>} True if routed successfully
   */
  async routeCommand(interaction) {
    try {
      const commandName = interaction.commandName;

      // Look up module for this command
      const moduleId = this.commandRegistry.get(commandName);
      if (!moduleId) {
        // Command not registered with any module - let main handler deal with it
        return false;
      }

      // Get module instance
      const module = this.moduleService.getModule(moduleId);
      if (!module) {
        this.logger.error(`[ModuleHandler] Module ${moduleId} not found for command /${commandName}`);
        await interaction.reply({
          content: 'Module not available.',
          ephemeral: true
        });
        return false;
      }

      // Check if module is enabled for this guild
      const guildId = interaction.guildId;
      const moduleState = await this.moduleService.getModuleState(moduleId, guildId);
      if (!moduleState || !moduleState.enabled) {
        this.logger.warning(`[ModuleHandler] Module ${moduleId} not enabled for guild ${guildId}`);
        await interaction.reply({
          content: 'This module is not enabled for this server.',
          ephemeral: true
        });
        return false;
      }

      // Delegate to module's command handler
      // Modules should implement a handleCommand(interaction) method
      if (typeof module.handleCommand === 'function') {
        await module.handleCommand(interaction);
        return true;
      } else {
        this.logger.error(`[ModuleHandler] Module ${moduleId} does not implement handleCommand()`);
        await interaction.reply({
          content: 'Command handler not implemented.',
          ephemeral: true
        });
        return false;
      }

    } catch (error) {
      this.logger.error(`[ModuleHandler] Failed to route command:`, error);

      // Try to respond to interaction if not already replied
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing this command.',
          ephemeral: true
        }).catch(() => {}); // Ignore if reply fails
      }

      return false;
    }
  }

  /**
   * Refresh all commands for a guild based on enabled modules
   *
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<void>}
   */
  async refreshGuildCommands(guildId) {
    try {
      this.logger.info(`[ModuleHandler] Refreshing commands for guild ${guildId}`);

      // Get all enabled modules for this guild
      const allModules = await this.moduleService.getAllModules(guildId);
      const enabledModules = allModules.filter(m => m.enabled);

      // Collect all commands from enabled modules
      const allCommands = [];
      this.commandRegistry.clear();

      for (const moduleInfo of enabledModules) {
        const module = this.moduleService.getModule(moduleInfo.id);
        if (!module) continue;

        const commands = module.getCommands();
        for (const cmd of commands) {
          allCommands.push(cmd.toJSON());
          this.commandRegistry.set(cmd.name, moduleInfo.id);
        }
      }

      // Register all commands at once
      await this.rest.put(
        Routes.applicationGuildCommands(this.clientId, guildId),
        { body: allCommands }
      );

      this.logger.info(`[ModuleHandler] Refreshed ${allCommands.length} commands for guild ${guildId}`);

    } catch (error) {
      this.logger.error(`[ModuleHandler] Failed to refresh guild commands:`, error);
      throw error;
    }
  }

  /**
   * Get command registry (for debugging/testing)
   *
   * @returns {Map} Command name to module ID mapping
   */
  getCommandRegistry() {
    return this.commandRegistry;
  }
}

module.exports = ModuleHandler;
