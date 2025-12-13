# Quickstart Guide: Module Development

**Feature**: Modular Discord Bot with WhatsApp Sync and Message Tracking
**Audience**: Developers adding new feature modules to FrijoleBot
**Time to complete**: ~30 minutes for first module

## Overview

This guide walks you through creating a custom feature module for FrijoleBot. By the end, you'll have a working module that can be enabled/disabled via the Admin UI and integrates with the Discord bot.

**What you'll build**: A "Hello World" module that responds to a slash command and demonstrates the module lifecycle.

---

## Prerequisites

- FrijoleBot repository cloned locally
- Node.js 20.x installed
- PostgreSQL and Redis running (via Docker Compose or local)
- Discord bot configured and running (see main README.md)
- Familiarity with discord.js and async/await

---

## Step 1: Create Module Directory Structure

All modules live under `modules/` in the repository root.

```bash
cd /path/to/frijolebot
mkdir -p modules/hello-world
cd modules/hello-world
```

Create these files:
```bash
touch HelloWorldModule.js
touch commands.js
touch config.js
touch README.md
```

Your structure should look like:
```
modules/
└── hello-world/
    ├── HelloWorldModule.js  # Main module class
    ├── commands.js           # Slash command definitions
    ├── config.js             # Module configuration schema
    └── README.md             # Module documentation
```

---

## Step 2: Define the Module Class

Create `HelloWorldModule.js`:

```javascript
const ModuleInterface = require('../base/ModuleInterface');
const commands = require('./commands');

class HelloWorldModule extends ModuleInterface {
  constructor(services) {
    // Call parent constructor with module metadata
    super(
      'hello-world',                     // Unique module ID
      'Hello World',                     // Human-readable name
      'A simple example module',         // Description
      []                                 // Dependencies (empty for this example)
    );

    // Store injected services
    this.services = services;  // { postgres, cache, discord, logger, scheduler }
    this.commandHandler = null;
  }

  /**
   * Initialize module resources (called once when bot starts)
   */
  async initialize() {
    this.services.logger.info('[HelloWorld] Module initialized');
  }

  /**
   * Enable module (called when enabled via Admin UI)
   */
  async enable(config) {
    this.services.logger.info('[HelloWorld] Module enabled', { config });

    // Register slash commands with Discord
    await this.registerCommands();

    // Store config if needed
    this.config = config;
  }

  /**
   * Disable module (called when disabled via Admin UI)
   */
  async disable() {
    this.services.logger.info('[HelloWorld] Module disabled');

    // Unregister slash commands
    await this.unregisterCommands();
  }

  /**
   * Cleanup resources (called on bot shutdown)
   */
  async cleanup() {
    this.services.logger.info('[HelloWorld] Module cleanup');
  }

  /**
   * Report health status
   */
  getHealth() {
    return {
      status: 'healthy',
      details: {
        initialized: true,
        commands_registered: this.commandHandler !== null
      }
    };
  }

  /**
   * Handle slash command interactions
   */
  async handleCommand(interaction) {
    const { commandName } = interaction;

    switch (commandName) {
      case 'hello':
        await this.handleHelloCommand(interaction);
        break;
      default:
        await interaction.reply({
          content: 'Unknown command',
          flags: MessageFlags.Ephemeral
        });
    }
  }

  /**
   * Handle /hello command
   */
  async handleHelloCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const username = interaction.user.username;
    const guildName = interaction.guild?.name || 'DM';

    await interaction.editReply({
      content: `Hello, ${username}! You're in server: ${guildName}`,
      flags: MessageFlags.Ephemeral
    });

    this.services.logger.info('[HelloWorld] /hello command executed', {
      user: username,
      guild: guildName
    });
  }

  /**
   * Register commands with Discord
   */
  async registerCommands() {
    // This will be called by ModuleService
    // Commands are defined in commands.js
    this.commandHandler = commands;
  }

  /**
   * Unregister commands
   */
  async unregisterCommands() {
    this.commandHandler = null;
  }

  /**
   * Get command definitions for registration
   */
  getCommands() {
    return commands;
  }
}

module.exports = HelloWorldModule;
```

---

## Step 3: Define Slash Commands

Create `commands.js`:

```javascript
const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  new SlashCommandBuilder()
    .setName('hello')
    .setDescription('Responds with a friendly greeting')
    .toJSON()
];
```

**Key points**:
- Use `SlashCommandBuilder` from discord.js
- Call `.toJSON()` to serialize for registration
- Commands will be automatically registered when module is enabled

---

## Step 4: Define Configuration Schema

Create `config.js`:

```javascript
module.exports = {
  // JSON Schema v7 for module configuration
  schema: {
    type: 'object',
    properties: {
      greeting_prefix: {
        type: 'string',
        description: 'Prefix for greeting message',
        default: 'Hello'
      },
      log_interactions: {
        type: 'boolean',
        description: 'Whether to log command interactions',
        default: true
      }
    }
  },

  // Default configuration values
  defaults: {
    greeting_prefix: 'Hello',
    log_interactions: true
  }
};
```

**Key points**:
- `schema`: JSON Schema definition for validation
- `defaults`: Default config values if none provided via Admin UI
- Admin UI will validate user input against schema before saving

---

## Step 5: Write Module Documentation

Create `README.md`:

```markdown
# Hello World Module

Simple example module demonstrating FrijoleBot module development.

## Description

This module adds a `/hello` slash command that responds with a greeting.

## Commands

- `/hello` - Responds with a friendly greeting mentioning your username and server

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| greeting_prefix | string | "Hello" | Prefix for greeting message |
| log_interactions | boolean | true | Whether to log command interactions |

## Dependencies

None

## Installation

Module is auto-discovered by ModuleService on bot startup.

## Usage

1. Enable module via Admin UI at `/admin/modules`
2. Use `/hello` command in any Discord channel
3. Receive personalized greeting (ephemeral reply)

## Testing

```bash
npm test -- tests/modules/HelloWorld.test.js
```
```

---

## Step 6: Register Module in Database

Add module to `modules` table (this will be automatic in production, but for dev you can seed manually):

```sql
INSERT INTO modules (id, name, description, version, dependencies, config_schema, default_config)
VALUES (
  'hello-world',
  'Hello World',
  'A simple example module',
  '1.0.0',
  '{}',  -- No dependencies
  '{"type": "object", "properties": {"greeting_prefix": {"type": "string", "default": "Hello"}}}'::jsonb,
  '{"greeting_prefix": "Hello", "log_interactions": true}'::jsonb
);
```

Or use the Admin UI's module discovery feature (coming soon).

---

## Step 7: Test the Module

### 7.1 Start the Bot

```bash
npm run dev:all
```

This starts:
- Bot on port 3001
- Admin UI on port 3100
- Gateway on port 3000

### 7.2 Enable Module via Admin UI

1. Navigate to http://localhost:3000/admin/modules
2. Find "Hello World" in the module list
3. Click "Enable" button
4. Optionally configure `greeting_prefix`
5. Click "Save"

Module is now active! No restart required.

### 7.3 Test the Command

In Discord:
1. Type `/hello`
2. Press Enter
3. You should see an ephemeral reply: "Hello, YourUsername! You're in server: ServerName"

### 7.4 Check Logs

```bash
# Bot logs
tail -f logs/bot.log

# Expected output:
[2025-12-11T10:00:00Z] INFO [HelloWorld] Module enabled
[2025-12-11T10:01:00Z] INFO [HelloWorld] /hello command executed user=YourUsername guild=ServerName
```

---

## Step 8: Write Tests

Create `tests/modules/HelloWorld.test.js`:

```javascript
const HelloWorldModule = require('../../modules/hello-world/HelloWorldModule');

describe('HelloWorldModule', () => {
  let module;
  let mockServices;

  beforeEach(() => {
    mockServices = {
      postgres: { query: jest.fn() },
      cache: { get: jest.fn(), set: jest.fn() },
      discord: {},
      logger: {
        info: jest.fn(),
        error: jest.fn()
      },
      scheduler: {}
    };

    module = new HelloWorldModule(mockServices);
  });

  test('initializes successfully', async () => {
    await module.initialize();
    expect(mockServices.logger.info).toHaveBeenCalledWith('[HelloWorld] Module initialized');
  });

  test('enables and registers commands', async () => {
    await module.enable({ greeting_prefix: 'Hi' });
    expect(mockServices.logger.info).toHaveBeenCalledWith(
      '[HelloWorld] Module enabled',
      { config: { greeting_prefix: 'Hi' } }
    );
    expect(module.getCommands()).toHaveLength(1);
  });

  test('disables and unregisters commands', async () => {
    await module.enable({});
    await module.disable();
    expect(mockServices.logger.info).toHaveBeenCalledWith('[HelloWorld] Module disabled');
  });

  test('reports healthy status', () => {
    const health = module.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.details.initialized).toBe(true);
  });

  test('handles /hello command', async () => {
    const mockInteraction = {
      commandName: 'hello',
      user: { username: 'testuser' },
      guild: { name: 'TestGuild' },
      deferReply: jest.fn(),
      editReply: jest.fn()
    };

    await module.handleCommand(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Hello, testuser')
      })
    );
  });
});
```

Run tests:
```bash
npm test -- tests/modules/HelloWorld.test.js
```

---

## Module Lifecycle Summary

```
Bot Startup:
  ↓
ModuleService.loadModules()
  ↓
YourModule.initialize()  ← Called once
  ↓
[Module registered but disabled]

User enables via Admin UI:
  ↓
ModuleService.enableModule(moduleId, config)
  ↓
YourModule.enable(config)  ← Register commands
  ↓
[Module active, commands available]

User uses commands:
  ↓
CommandHandler receives interaction
  ↓
ModuleHandler.routeCommand(interaction)
  ↓
YourModule.handleCommand(interaction)  ← Your logic

User disables via Admin UI:
  ↓
ModuleService.disableModule(moduleId)
  ↓
YourModule.disable()  ← Unregister commands
  ↓
[Module inactive, commands unavailable]

Bot Shutdown:
  ↓
YourModule.cleanup()  ← Called once
```

---

## Advanced Topics

### Adding Database Tables

If your module needs persistent storage:

1. Add schema in `services/PostgreSQLService.js` → `initializeDatabase()`:

```javascript
// In PostgreSQLService.initializeDatabase()
await this.pool.query(`
  CREATE TABLE IF NOT EXISTS helloworld_greetings (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    greeting_count INTEGER DEFAULT 1,
    last_greeted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id, user_id)
  )
`);
```

2. Access in your module:

```javascript
async handleHelloCommand(interaction) {
  const { user, guildId } = interaction;

  // Increment greeting count
  await this.services.postgres.query(`
    INSERT INTO helloworld_greetings (guild_id, user_id, greeting_count)
    VALUES ($1, $2, 1)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
      greeting_count = helloworld_greetings.greeting_count + 1,
      last_greeted_at = CURRENT_TIMESTAMP
  `, [guildId, user.id]);

  // Get count
  const result = await this.services.postgres.query(
    'SELECT greeting_count FROM helloworld_greetings WHERE guild_id = $1 AND user_id = $2',
    [guildId, user.id]
  );

  const count = result.rows[0].greeting_count;
  await interaction.editReply(`Hello! I've greeted you ${count} time(s).`);
}
```

### Module Dependencies

If your module depends on another module:

```javascript
class MyModule extends ModuleInterface {
  constructor(services) {
    super(
      'my-module',
      'My Module',
      'Description',
      ['whatsapp']  // ← Depends on WhatsApp module
    );
  }
}
```

ModuleService will:
- Prevent enabling `my-module` unless `whatsapp` is already enabled
- Prevent disabling `whatsapp` if `my-module` is enabled

### Scheduled Tasks

Use SchedulerService for background jobs:

```javascript
async enable(config) {
  // Schedule daily cleanup job
  this.cleanupJobId = this.services.scheduler.scheduleDaily('cleanup-greetings', async () => {
    await this.services.postgres.query(
      'DELETE FROM helloworld_greetings WHERE last_greeted_at < NOW() - INTERVAL \'90 days\''
    );
    this.services.logger.info('[HelloWorld] Cleanup job completed');
  });
}

async disable() {
  // Cancel scheduled job
  if (this.cleanupJobId) {
    this.services.scheduler.cancelJob(this.cleanupJobId);
  }
}
```

### Caching

Use CacheService for frequently accessed data:

```javascript
async getGreetingCount(guildId, userId) {
  const cacheKey = `greeting:${guildId}:${userId}`;

  // Check cache first
  const cached = await this.services.cache.get(cacheKey);
  if (cached !== null) {
    return parseInt(cached);
  }

  // Query database
  const result = await this.services.postgres.query(
    'SELECT greeting_count FROM helloworld_greetings WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId]
  );

  const count = result.rows[0]?.greeting_count || 0;

  // Cache for 60 seconds
  await this.services.cache.set(cacheKey, count.toString(), 60);

  return count;
}
```

---

## Best Practices

### 1. Guild Isolation

Always scope data by `guild_id` to prevent cross-server data leakage:

```javascript
// ✅ Good - guild-scoped
await this.services.postgres.query(
  'SELECT * FROM my_table WHERE guild_id = $1 AND user_id = $2',
  [guildId, userId]
);

// ❌ Bad - no guild isolation
await this.services.postgres.query(
  'SELECT * FROM my_table WHERE user_id = $1',
  [userId]
);
```

### 2. Ephemeral Replies

Use ephemeral replies for user-private data:

```javascript
// ✅ Good - private reply
await interaction.reply({
  content: 'Your private data here',
  flags: MessageFlags.Ephemeral
});

// ❌ Bad - public reply (visible to all)
await interaction.reply('Your private data here');
```

### 3. Rate Limiting

All commands are automatically rate-limited via `CommandHandler`. No extra work needed!

### 4. Error Handling

Wrap risky operations in try-catch:

```javascript
async handleCommand(interaction) {
  try {
    await this.doSomethingRisky();
  } catch (error) {
    this.services.logger.error('[MyModule] Command error', { error });
    await interaction.editReply({
      content: 'An error occurred. Please try again later.',
      flags: MessageFlags.Ephemeral
    });
  }
}
```

### 5. Parameterized Queries

Always use parameterized queries to prevent SQL injection:

```javascript
// ✅ Good - parameterized
await this.services.postgres.query(
  'SELECT * FROM my_table WHERE id = $1',
  [userId]
);

// ❌ Bad - SQL injection risk
await this.services.postgres.query(
  `SELECT * FROM my_table WHERE id = '${userId}'`
);
```

---

## Troubleshooting

### Module not appearing in Admin UI

1. Check `modules` table has entry for your module
2. Restart bot to trigger module discovery
3. Check bot logs for module loading errors

### Commands not registering

1. Verify `getCommands()` returns array of command definitions
2. Check Discord Developer Portal → Bot → Slash Commands
3. Ensure bot has `applications.commands` scope

### Module enable fails

1. Check console for dependency errors
2. Verify config conforms to `config_schema`
3. Review bot logs for initialization errors

### Tests failing

1. Ensure all services are mocked properly
2. Check for missing `await` on async operations
3. Run with `--verbose` flag: `npm test -- --verbose tests/modules/MyModule.test.js`

---

## Next Steps

- **Read existing modules**: Study `modules/whatsapp/` and `modules/message-tracking/` for real-world examples
- **Explore Admin UI**: Understand how module UI is built in `apps/control-panel/app/admin/modules/`
- **Add API endpoints**: Create REST endpoints for your module under `/api/modules/your-module/`
- **Contribute**: Submit your module as a PR to help grow the ecosystem!

---

## Resources

- [FrijoleBot Constitution](../../.specify/memory/constitution.md) - Architecture principles
- [Data Model](./data-model.md) - Database schema
- [API Contracts](./contracts/) - REST API specifications
- [discord.js Documentation](https://discord.js.org) - Discord bot library
- [Jest Testing Guide](https://jestjs.io/docs/getting-started) - Testing framework

---

**Questions?** Check existing modules or ask in the development Discord channel.

Happy coding! 🎉
