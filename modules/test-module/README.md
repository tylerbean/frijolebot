# Test Module

A simple demonstration module for testing the FrijoleBot module management system.

## Purpose

This module serves as a reference implementation and integration test for the modular architecture. It demonstrates:

- Extending the `ModuleInterface` base class
- Implementing lifecycle hooks (initialize, enable, disable, cleanup)
- Defining slash commands
- Managing module configuration
- Reporting health status

## Features

- **Slash Command**: `/test` - Responds with module status and configuration
- **Configuration Options**:
  - `testSetting` (string): A sample text configuration
  - `enableTestFeature` (boolean): Toggle a test feature
  - `maxTestCount` (number): Set a numeric limit

## Testing

This module is used in integration tests to verify:

1. Module loading and discovery
2. Enable/disable workflows
3. Configuration persistence
4. Health monitoring
5. No-restart module updates

## Usage

### Via Web UI

1. Navigate to `/admin/modules` in the control panel
2. Find "Test Module" in the list
3. Toggle the enable switch
4. Click "Configure" to set configuration values
5. Save and test with `/test` command in Discord

### Via API

```bash
# Enable the module
curl -X POST http://localhost:3000/api/modules/test-module/enable \
  -H "Content-Type: application/json" \
  -d '{"guildId": "your-guild-id", "config": {"testSetting": "custom-value"}}'

# Check health
curl http://localhost:3000/api/modules/test-module/health?guildId=your-guild-id

# Disable the module
curl -X POST http://localhost:3000/api/modules/test-module/disable \
  -H "Content-Type: application/json" \
  -d '{"guildId": "your-guild-id"}'
```

## File Structure

```
test-module/
├── TestModuleModule.js   # Main module class
├── commands.js            # Slash command definitions
├── config.js              # Configuration schema
└── README.md              # This file
```

## Development

To create your own module based on this template:

1. Copy the `test-module` directory
2. Rename files (e.g., `YourModuleModule.js`)
3. Update the class name and module ID
4. Implement your custom logic in lifecycle methods
5. Define your slash commands
6. Configure your module schema

## Notes

- This module has no dependencies on other modules
- It's safe to enable/disable at any time
- All operations are logged for debugging
- Module state persists across bot restarts
