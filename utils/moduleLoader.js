/**
 * Module Loader - Dynamically loads feature modules from modules/ directory
 *
 * Scans the modules/ directory for module subdirectories, instantiates module classes,
 * and returns an array of module instances for the ModuleService to manage.
 */

const fs = require('fs');
const path = require('path');
const ModuleInterface = require('../modules/base/ModuleInterface');

/**
 * Load all modules from the modules/ directory
 *
 * @param {object} services - Injected services (postgres, cache, discord, logger, scheduler)
 * @param {object} logger - Logger instance
 * @returns {Promise<array>} Array of instantiated module objects
 */
async function loadModules(services, logger) {
  const modules = [];
  const modulesDir = path.join(__dirname, '..', 'modules');

  try {
    // Check if modules directory exists
    if (!fs.existsSync(modulesDir)) {
      logger.warning('[ModuleLoader] modules/ directory not found, creating it');
      fs.mkdirSync(modulesDir, { recursive: true });
      return modules;
    }

    // Read all subdirectories in modules/
    const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
    const moduleDirs = entries
      .filter(entry => entry.isDirectory() && entry.name !== 'base')
      .map(entry => entry.name);

    logger.info(`[ModuleLoader] Found ${moduleDirs.length} module directories`);

    // Load each module
    for (const moduleDir of moduleDirs) {
      try {
        const modulePath = path.join(modulesDir, moduleDir);

        // Look for main module file (capitalized name + 'Module.js')
        const moduleName = moduleDir
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join('');
        const moduleFile = `${moduleName}Module.js`;
        const moduleFilePath = path.join(modulePath, moduleFile);

        if (!fs.existsSync(moduleFilePath)) {
          logger.warning(`[ModuleLoader] Module file not found: ${moduleFile} in ${moduleDir}`);
          continue;
        }

        // Load the module class
        const ModuleClass = require(moduleFilePath);

        // Verify it extends ModuleInterface
        if (!(ModuleClass.prototype instanceof ModuleInterface)) {
          logger.warning(`[ModuleLoader] ${moduleFile} does not extend ModuleInterface, skipping`);
          continue;
        }

        // Instantiate the module with injected services
        const moduleInstance = new ModuleClass(services);

        logger.info(`[ModuleLoader] Loaded module: ${moduleInstance.getId()} (${moduleInstance.getName()})`);
        modules.push(moduleInstance);

      } catch (error) {
        logger.error(`[ModuleLoader] Failed to load module from ${moduleDir}:`, error);
        // Continue loading other modules even if one fails
      }
    }

    logger.info(`[ModuleLoader] Successfully loaded ${modules.length} modules`);
    return modules;

  } catch (error) {
    logger.error('[ModuleLoader] Error loading modules:', error);
    return modules;
  }
}

/**
 * Validate module structure
 *
 * @param {string} modulePath - Path to module directory
 * @returns {boolean} True if module structure is valid
 */
function validateModuleStructure(modulePath) {
  const requiredFiles = ['commands.js', 'config.js'];

  for (const file of requiredFiles) {
    const filePath = path.join(modulePath, file);
    if (!fs.existsSync(filePath)) {
      return false;
    }
  }

  return true;
}

module.exports = {
  loadModules,
  validateModuleStructure
};
