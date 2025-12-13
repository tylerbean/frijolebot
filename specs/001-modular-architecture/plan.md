# Implementation Plan: Modular Discord Bot with WhatsApp Sync and Message Tracking

**Branch**: `001-modular-architecture` | **Date**: 2025-12-11 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-modular-architecture/spec.md`

## Summary

Build a modular Discord bot application with web frontend that provides WhatsApp chat synchronization and message tracking capabilities. The system features a plugin-based architecture where all modules are disabled by default and can be enabled/disabled via a Next.js admin UI without server restarts. Core features include WhatsApp-to-Discord message forwarding using the Baileys connector with QR code authentication, and user-specific message tracking. The architecture prioritizes modularity, allowing new features to be added without modifying core bot code.

## Technical Context

**Language/Version**: Node.js 20.x (LTS)
**Primary Dependencies** (with specific versions):
- discord.js v14.25.1+ (Discord bot client) - UPDATE from 14.14.1
- @whiskeysockets/baileys v7.0.0-rc.9+ (WhatsApp connector) - **CRITICAL UPDATE from rc.2 for 405 error fix**
- Next.js 14.2.32+ (Admin UI frontend) - stable on v14, defer v15/16 upgrade
- PostgreSQL client (pg) v8.16.3 (already up to date)
- Redis client (redis) v4.7.0+ (defer v5 upgrade to avoid breaking changes)
- Jest v29.7.0 (Testing framework)
- qrcode v1.5.4+ (QR code generation)

**⚠️ CRITICAL**: Baileys must be updated to v7.0.0-rc.9 or later to fix WhatsApp 405 "Connection Failure" errors. See [Issue #1427](https://github.com/WhiskeySockets/Baileys/issues/1427) and [Issue #2107](https://github.com/WhiskeySockets/Baileys/issues/2107)

**Storage**:
- PostgreSQL (module state, feature flags, chat mappings, tracked messages, user preferences)
- Redis (feature flag cache, query result cache)
- Local filesystem (WhatsApp session credentials in Docker volume)

**Testing**: Jest with V8 coverage provider, integration tests for cross-service interactions

**Target Platform**: Linux server (Docker containerized), Kubernetes-ready with health probes

**Project Type**: Web application (bot backend + Next.js frontend)

**Performance Goals**:
- Discord slash commands respond within 3 seconds
- WhatsApp messages forwarded to Discord within 5 seconds
- Feature flag cache: 60-second TTL
- Support 10+ concurrent WhatsApp chat mappings

**Constraints**:
- Module enable/disable without restart
- WhatsApp session persistence across restarts
- Multi-tenant support (guild isolation)
- Database-driven configuration (minimal env vars)
- Ephemeral Discord replies for user-private data
- Rate limiting on all slash commands

**Scale/Scope**:
- Multi-server Discord bot deployment
- 10+ concurrent WhatsApp chat mappings per instance
- 30-day message tracking retention
- Modular architecture supporting unlimited future modules

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify compliance with FrijoleBot Constitution v1.0.0:

- [x] **Test Coverage & Quality**: Jest test strategy defined; unit tests for all services, integration tests for Discord↔WhatsApp and DB↔Services interactions
- [x] **Service Layer Architecture**: ModuleService, WhatsAppService, MessageTrackingService in services/; handlers delegate to services; PostgreSQLService for all DB access
- [x] **User Experience Consistency**: Discord slash commands use ephemeral replies; rate limiting via CommandHandler; Admin UI for configuration; health endpoints at /health/live and /health/ready
- [x] **Performance & Monitoring**: 3-second response target for commands; feature flags cached 60s; health checks report module status; indexed queries on guild_id, user_id, chat_id
- [x] **Security & Data Protection**: Discord tokens encrypted via tokenCrypto.js; WhatsApp sessions in local files only; parameterized SQL queries; guild_id isolation; CONFIG_CRYPTO_KEY required

**Status**: ✅ All constitution principles satisfied. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-modular-architecture/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output - architecture decisions
├── data-model.md        # Phase 1 output - database schema
├── quickstart.md        # Phase 1 output - developer guide
├── contracts/           # Phase 1 output - API specifications
│   ├── module-api.yaml
│   ├── whatsapp-api.yaml
│   └── tracking-api.yaml
├── checklists/
│   └── requirements.md  # Spec validation checklist
└── spec.md              # Feature specification
```

### Source Code (repository root)

**Selected Structure**: Web application (existing FrijoleBot architecture)

```text
# Discord Bot Backend (Node.js)
config/
└── index.js             # Environment and database config loading

services/
├── PostgreSQLService.js # Database operations, schema, feature flags
├── CacheService.js      # Redis wrapper with in-memory fallback
├── ModuleService.js     # NEW: Module lifecycle, dependency resolution
├── WhatsAppService.js   # ENHANCED: Baileys integration, session mgmt
├── MessageTrackingService.js # NEW: Track messages, read/unread status
├── HealthCheckService.js # Health endpoints, module status reporting
└── SchedulerService.js  # Background task scheduling

handlers/
├── messageHandler.js    # Discord message event processing
├── reactionHandler.js   # DM reaction processing
├── commandHandler.js    # Slash command routing, rate limiting
└── moduleHandler.js     # NEW: Module command delegation

utils/
├── logger.js            # Structured logging
├── rateLimiter.js       # Per-user/command rate limiting
└── moduleLoader.js      # NEW: Dynamic module loading

modules/                 # NEW: Pluggable feature modules
├── base/
│   └── ModuleInterface.js # Base class for all modules
├── whatsapp/
│   ├── WhatsAppModule.js
│   ├── commands.js
│   └── config.js
└── message-tracking/
    ├── MessageTrackingModule.js
    ├── commands.js
    └── config.js

# Next.js Admin UI Frontend
apps/control-panel/
├── app/
│   ├── admin/
│   │   ├── modules/     # NEW: Module management pages
│   │   ├── whatsapp/    # NEW: WhatsApp config pages
│   │   └── tracking/    # NEW: Tracking config pages
│   ├── api/
│   │   └── modules/     # NEW: Module control endpoints
│   ├── lib/
│   │   └── db.ts        # PostgreSQL connection pool
│   └── page.tsx         # Dashboard
├── public/
└── package.json

# Tests
tests/
├── services/
│   ├── ModuleService.test.js
│   ├── MessageTrackingService.test.js
│   └── WhatsAppService.test.js
├── integration/
│   ├── ModuleLifecycle.test.js
│   └── WhatsAppDiscordSync.test.js
├── fixtures/
│   └── mockData.js
└── setup.js

# Gateway (single port proxy)
gateway/
└── server.js            # Routes UI, bot API, health checks

# Deployment
docker-compose.yml       # App + PostgreSQL + Redis
Dockerfile               # Multi-stage build (bot + UI)
```

**Structure Decision**: Extends existing FrijoleBot web application architecture with new `modules/` directory for pluggable features and enhanced `apps/control-panel/app/admin/` for module management UI. Maintains single Docker container with three-process model (bot, UI, gateway).

## Complexity Tracking

No constitution violations. Architecture aligns with all five core principles.

---

## Pre-Implementation Checklist

Before starting implementation, complete these preparatory steps:

### 1. Dependency Updates

**CRITICAL - Must complete first to fix WhatsApp authentication:**

```bash
# Update Baileys to fix 405 error (CRITICAL)
npm install @whiskeysockets/baileys@^7.0.0-rc.9

# Update discord.js for latest features/fixes
npm install discord.js@^14.25.1

# Verify package.json shows correct versions
grep -E "(baileys|discord.js)" package.json
```

**Expected output**:
```json
"@whiskeysockets/baileys": "^7.0.0-rc.9",
"discord.js": "^14.25.1",
```

### 2. Verify Current System State

```bash
# Ensure PostgreSQL and Redis are running
docker compose ps | grep -E "(postgres|redis)"

# Verify existing tables
psql -h localhost -U frijolebot -d frijolebot -c "\dt"

# Check existing WhatsApp session (if any)
ls -la auth_info_baileys/
```

### 3. Review Implementation Documents

Read these files **in order** before coding:

1. **[research.md](research.md)** - Architecture decisions and patterns (30 min read)
2. **[data-model.md](data-model.md)** - Database schema design (20 min read)
3. **[contracts/](contracts/)** - API specifications (15 min read each)
4. **[quickstart.md](quickstart.md)** - Hands-on module tutorial (1 hour)

### 4. Environment Setup

```bash
# Ensure CONFIG_CRYPTO_KEY is set (required for token encryption)
if [ -z "$CONFIG_CRYPTO_KEY" ]; then
  echo "Generating CONFIG_CRYPTO_KEY..."
  export CONFIG_CRYPTO_KEY=$(openssl rand -base64 32)
  echo "CONFIG_CRYPTO_KEY=$CONFIG_CRYPTO_KEY" >> .env
fi

# Verify Node.js version
node --version  # Should be v20.x or higher

# Install all dependencies
npm install
cd apps/control-panel && npm install && cd ../..
```

---

## Implementation Sequence

### Phase 0: Foundation (Day 1-2) - **DO THIS FIRST**

**Objective**: Update dependencies and establish module system foundations

**Tasks**:

1. **Update Dependencies** ⚠️ CRITICAL FIRST STEP
   ```bash
   npm install @whiskeysockets/baileys@^7.0.0-rc.9
   npm install discord.js@^14.25.1
   npm test  # Verify no breaking changes
   ```
   **Reference**: Lines 14-22 above (Technical Context)

   **Success Criteria**:
   - All tests pass
   - WhatsApp 405 error resolved
   - Discord bot connects successfully

2. **Create Module System Base Files**
   ```bash
   mkdir -p modules/base
   touch modules/base/ModuleInterface.js
   touch utils/moduleLoader.js
   ```
   **Reference**: [quickstart.md](quickstart.md) sections "Step 2" and "Module Lifecycle Summary"

   **Implementation**:
   - `ModuleInterface.js`: Base class with lifecycle hooks (initialize, enable, disable, cleanup, getHealth)
   - `moduleLoader.js`: Scans `modules/` directory, instantiates modules, returns array

   **Success Criteria**:
   - ModuleInterface.js exports base class
   - moduleLoader.js successfully scans empty modules/ directory

3. **Extend Database Schema**
   ```bash
   # Add new tables to PostgreSQLService.initializeDatabase()
   ```
   **Reference**: [data-model.md](data-model.md) section "Schema Migration Script"

   **Tables to add**:
   - `modules` (registry)
   - `module_states` (per-guild state)
   - `user_tracking_preferences` (who tracks whom)
   - `tracked_messages` (message references)

   **Implementation**: Copy SQL from data-model.md lines 178-279

   **Success Criteria**:
   - Run bot, check logs for "Table created" or "Table already exists"
   - Query: `psql -c "\dt" | grep -E "(modules|module_states|user_tracking|tracked_messages)"`

---

### Phase 1: Core Services (Day 3-5)

**Objective**: Implement ModuleService and MessageTrackingService

**Tasks**:

4. **Create ModuleService**
   ```bash
   touch services/ModuleService.js
   touch tests/services/ModuleService.test.js
   ```
   **Reference**: [research.md](research.md) section "Decision 1: Module System Design"

   **Key Methods to Implement**:
   - `loadModules()` - Uses moduleLoader.js, calls initialize() on each
   - `enableModule(moduleId, guildId, config)` - Validates dependencies, updates DB, calls enable()
   - `disableModule(moduleId, guildId)` - Checks dependents, updates DB, calls disable()
   - `getModuleHealth(moduleId, guildId)` - Queries module.getHealth()
   - `validateDependencies(moduleId, guildId)` - Checks dependencies are enabled

   **Success Criteria**:
   - Unit tests pass (85%+ coverage)
   - Integration test: Load module → Enable → Disable cycle works

5. **Create MessageTrackingService**
   ```bash
   touch services/MessageTrackingService.js
   touch tests/services/MessageTrackingService.test.js
   ```
   **Reference**: [research.md](research.md) section "Decision 4: Message Tracking Implementation"

   **Key Methods**:
   - `addTrackingPreference(guildId, trackerUserId, trackedUserId)` - Insert into user_tracking_preferences
   - `removeTrackingPreference(guildId, trackerUserId, trackedUserId)` - Delete from user_tracking_preferences
   - `trackMessage(guildId, trackerUserId, messageId, authorId, preview)` - Insert into tracked_messages
   - `getUnreadMessages(guildId, trackerUserId, limit, offset)` - Query with pagination
   - `markAsRead(guildId, trackerUserId, messageId)` - Update read status
   - `cleanupExpiredMessages()` - Delete where expires_at < NOW() (scheduled task)
   - `formatUnreadMessagesForDiscord(messages)` - **NEW**: Format messages into embeds with Discord limit handling

   **Discord Embed Limits** (CRITICAL for /unread command):
   - Total embed characters: 6000 max
   - Fields per embed: 25 max
   - Field name: 256 chars, value: 1024 chars
   - **Must split into multiple messages** if limits exceeded

   **Implementation Notes**:
   - Calculate total character count before sending
   - Split into multiple embeds if total > 5500 chars (safety margin)
   - Each embed should have 10-15 messages max to avoid hitting limits
   - Include "Page X of Y" footer when split across multiple messages

   **Database Queries**: See [data-model.md](data-model.md) section "Data Access Patterns"

   **Success Criteria**:
   - All CRUD operations work
   - Guild isolation enforced (cannot query other guild's data)
   - Tests verify 30-day retention
   - **Message formatting handles 50+ unread messages without hitting Discord limits**

6. **Enhance WhatsAppService**
   ```bash
   # Modify existing services/WhatsAppService.js
   ```
   **Reference**: [research.md](research.md) section "Decision 3: WhatsApp Integration Architecture"

   **Changes Needed**:
   - Update Baileys initialization to use v7.0.0-rc.9 patterns
   - Test QR code generation (should no longer get 405 error)
   - Ensure session persistence works with new version

   **Success Criteria**:
   - QR code generates without 405 error
   - Session restored from `auth_info_baileys/` on restart
   - Messages forwarded to Discord successfully

---

### Phase 2: Module Handlers & Integration (Day 6-8)

**Objective**: Create module handler routing and integrate with Discord bot

**Tasks**:

7. **Create ModuleHandler**
   ```bash
   touch handlers/moduleHandler.js
   touch tests/handlers/ModuleHandler.test.js
   ```
   **Reference**: Plan lines 107 (structure) + [quickstart.md](quickstart.md) "Module Lifecycle Summary"

   **Key Methods**:
   - `registerModuleCommands(moduleId, commands)` - Register slash commands from module
   - `unregisterModuleCommands(moduleId)` - Unregister when disabled
   - `routeCommand(interaction)` - Route to appropriate module based on command name

   **Success Criteria**:
   - Commands registered dynamically when module enabled
   - Commands unregistered when module disabled
   - Routing works correctly

8. **Integrate ModuleService into Bot Startup**
   ```bash
   # Modify discord-link-bot.js main() function
   ```
   **Location**: Add after existing service initialization (after line ~45 in current file)

   **Code to Add**:
   ```javascript
   // Initialize module system
   const ModuleService = require('./services/ModuleService');
   const moduleService = new ModuleService(postgresService, cacheService, discordClient, logger);
   await moduleService.loadModules();
   ```

   **Success Criteria**:
   - Bot starts without errors
   - Logs show "Modules loaded: 0" (empty modules/ dir initially)

9. **Create First Module: WhatsAppModule**
   ```bash
   mkdir -p modules/whatsapp
   touch modules/whatsapp/WhatsAppModule.js
   touch modules/whatsapp/commands.js
   touch modules/whatsapp/config.js
   ```
   **Reference**: [quickstart.md](quickstart.md) - entire tutorial applies

   **Implementation**:
   - Extend ModuleInterface
   - Wrap existing WhatsAppService functionality
   - Define `/whatsapp_auth` and `/whatsapp_chats` commands
   - Use config schema from [data-model.md](data-model.md) module examples

   **Success Criteria**:
   - Module appears in `modules` table
   - Can be enabled/disabled via ModuleService
   - Commands work when enabled, disappear when disabled

10. **Create Second Module: MessageTrackingModule**
    ```bash
    mkdir -p modules/message-tracking
    touch modules/message-tracking/MessageTrackingModule.js
    touch modules/message-tracking/commands.js
    touch modules/message-tracking/config.js
    ```
    **Reference**: [quickstart.md](quickstart.md) - entire tutorial applies

    **Implementation**:
    - Extend ModuleInterface
    - Integrate with MessageTrackingService from task 5
    - Define `/track`, `/untrack`, `/unread`, `/tracked_list` commands
    - **CRITICAL**: `/unread` command MUST handle Discord embed limits (see task 5)

    **Discord Message Splitting Logic**:
    ```javascript
    // In handleUnreadCommand(interaction)
    const messages = await messageTrackingService.getUnreadMessages(...);

    // Split into chunks of 10-15 messages each
    const chunkSize = 12; // Safe number to avoid 6000 char limit
    const chunks = [];
    for (let i = 0; i < messages.length; i += chunkSize) {
      chunks.push(messages.slice(i, i + chunkSize));
    }

    // Send multiple embeds if needed
    for (let i = 0; i < chunks.length; i++) {
      const embed = createUnreadEmbed(chunks[i], i + 1, chunks.length);
      if (i === 0) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    }
    ```

    **Success Criteria**:
    - Module loads and can be enabled/disabled
    - `/unread` command works with 1-100+ messages
    - **No "Invalid Form Body" errors when many results**
    - Messages split across multiple embeds when > 12 messages
    - Each embed stays under 6000 character limit

---

### Phase 3: Admin UI (Day 9-12)

**Objective**: Build module management interface

**Tasks**:

11. **Create Module Management API Endpoints**
    ```bash
    mkdir -p apps/control-panel/app/api/modules
    touch apps/control-panel/app/api/modules/route.ts
    touch apps/control-panel/app/api/modules/[moduleId]/enable/route.ts
    touch apps/control-panel/app/api/modules/[moduleId]/disable/route.ts
    ```
    **Reference**: [contracts/module-api.yaml](contracts/module-api.yaml) - complete OpenAPI spec

    **Endpoints to Implement**:
    - `GET /api/modules?guild_id={id}` - List all modules
    - `POST /api/modules/{moduleId}/enable` - Enable module
    - `POST /api/modules/{moduleId}/disable` - Disable module
    - `GET /api/modules/{moduleId}/health` - Get module health

    **Success Criteria**:
    - API returns data matching OpenAPI schema
    - Enable/disable works without restart
    - Health endpoint returns module status

12. **Create Module Management UI Pages**
    ```bash
    mkdir -p apps/control-panel/app/admin/modules
    touch apps/control-panel/app/admin/modules/page.tsx
    touch apps/control-panel/app/admin/modules/[moduleId]/page.tsx
    ```
    **Reference**: [research.md](research.md) section "Decision 5: Admin UI Module Management Pages"

    **Pages**:
    - `/admin/modules` - List of all modules with enable/disable toggles
    - `/admin/modules/{moduleId}` - Module details and configuration

    **UI Components**:
    - Module card with status badge (enabled/disabled/healthy/unhealthy)
    - Enable/disable toggle button
    - Configuration form (validates against module's config_schema)

    **Success Criteria**:
    - Can see all modules
    - Can enable/disable without refresh
    - Configuration saves correctly

13. **Create WhatsApp Management UI**
    ```bash
    mkdir -p apps/control-panel/app/admin/whatsapp
    touch apps/control-panel/app/admin/whatsapp/page.tsx
    touch apps/control-panel/app/api/whatsapp/chats/route.ts
    ```
    **Reference**: [contracts/whatsapp-api.yaml](contracts/whatsapp-api.yaml) - complete OpenAPI spec

    **Features**:
    - View WhatsApp session status
    - List available chats (from authenticated session)
    - Create/edit/delete chat mappings

    **Success Criteria**:
    - Session status displays correctly
    - Can map WhatsApp chats to Discord channels
    - Mappings persist in database

14. **Create Message Tracking UI**
    ```bash
    mkdir -p apps/control-panel/app/admin/tracking
    touch apps/control-panel/app/admin/tracking/page.tsx
    touch apps/control-panel/app/api/tracking/preferences/route.ts
    touch apps/control-panel/app/api/tracking/messages/route.ts
    ```
    **Reference**: [contracts/tracking-api.yaml](contracts/tracking-api.yaml) - complete OpenAPI spec

    **Features**:
    - Add/remove users to tracking list
    - View unread tracked messages (paginated)
    - Mark messages as read (bulk operation)

    **Success Criteria**:
    - Can add users to tracking
    - Unread messages display with pagination
    - Mark as read updates database

---

### Phase 4: Testing & Documentation (Day 13-15)

**Objective**: Comprehensive testing and documentation updates

**Tasks**:

15. **Write Integration Tests**
    ```bash
    touch tests/integration/ModuleLifecycle.test.js
    touch tests/integration/WhatsAppDiscordSync.test.js
    touch tests/integration/MessageTracking.test.js
    ```
    **Reference**: [research.md](research.md) section "Testing Strategy"

    **Test Scenarios**:
    - ModuleLifecycle: Load → Enable → Process command → Disable → Verify cleanup
    - WhatsAppDiscordSync: Auth → Map chat → Send WhatsApp msg → Verify Discord msg
    - MessageTracking: Add preference → Send tracked message → Verify unread list → Mark read
    - **MessageTrackingLimits**: Test `/unread` with 50+ messages → Verify multiple embeds sent → No errors

    **Success Criteria**:
    - All integration tests pass
    - Coverage >80% for new services
    - **Test confirms `/unread` splits messages across multiple embeds when >12 items**

16. **Update CLAUDE.md**
    **Already completed** - Added modular architecture section

    **Verify**:
    - [ ] Module development guidance present
    - [ ] Database schema updated
    - [ ] New services documented

17. **Update README.md**
    ```bash
    # Add module management section
    ```
    **Sections to Add**:
    - "Module Management" with `/admin/modules` screenshot
    - "Available Modules" list (WhatsApp, Message Tracking)
    - "Creating Custom Modules" with link to quickstart.md

    **Success Criteria**:
    - Users understand module system
    - Clear path to creating modules

---

## Implementation Dependency Graph

```
Phase 0: Foundation
├── 1. Update Dependencies ← START HERE (fixes 405 error)
├── 2. Create Base Files
└── 3. Extend DB Schema
        ↓
Phase 1: Core Services
├── 4. ModuleService (depends on: 2, 3)
├── 5. MessageTrackingService (depends on: 3)
└── 6. Enhance WhatsAppService (depends on: 1)
        ↓
Phase 2: Module Handlers
├── 7. ModuleHandler (depends on: 4)
├── 8. Integrate into Bot (depends on: 4, 7)
├── 9. Create WhatsAppModule (depends on: 4, 6, 7)
└── 10. Create MessageTrackingModule (depends on: 4, 5, 7)
        ↓
Phase 3: Admin UI
├── 11. Module API Endpoints (depends on: 4)
├── 12. Module Management UI (depends on: 11)
├── 13. WhatsApp UI (depends on: 9, 11)
└── 14. Tracking UI (depends on: 5, 10, 11)
        ↓
Phase 4: Testing & Docs
├── 15. Integration Tests (depends on: all above)
├── 16. Update CLAUDE.md (✅ done)
└── 17. Update README.md (depends on: all above)
```

---

## Quick Reference: Where to Find Implementation Details

| What You're Implementing | Look Here | Specific Section |
|--------------------------|-----------|------------------|
| Module base class pattern | [quickstart.md](quickstart.md) | Step 2: Define the Module Class |
| Module lifecycle hooks | [quickstart.md](quickstart.md) | Module Lifecycle Summary |
| Database schema SQL | [data-model.md](data-model.md) | Schema Migration Script (lines 178-279) |
| Module dependencies logic | [research.md](research.md) | Decision 1: Module System Design |
| Feature flag caching | [research.md](research.md) | Decision 2: Feature Flag Storage |
| WhatsApp session management | [research.md](research.md) | Decision 3: WhatsApp Integration |
| Message tracking queries | [data-model.md](data-model.md) | Data Access Patterns |
| API endpoint schemas | [contracts/*.yaml](contracts/) | All OpenAPI specs |
| Module API spec | [contracts/module-api.yaml](contracts/module-api.yaml) | Complete REST API |
| WhatsApp API spec | [contracts/whatsapp-api.yaml](contracts/whatsapp-api.yaml) | Complete REST API |
| Tracking API spec | [contracts/tracking-api.yaml](contracts/tracking-api.yaml) | Complete REST API |
| Testing patterns | [research.md](research.md) | Testing Strategy |
| Best practices | [quickstart.md](quickstart.md) | Best Practices section |

---

## Common Implementation Pitfalls to Avoid

1. **Forgetting guild isolation** - Always scope queries by `guild_id`
2. **Skipping dependency updates** - Must update Baileys first to fix 405 error
3. **Not using ephemeral replies** - User-private data must use `MessageFlags.Ephemeral`
4. **Hardcoding config** - Use module config from database, not env vars
5. **Missing rate limiting** - All slash commands must be rate-limited
6. **SQL injection** - Always use parameterized queries ($1, $2, etc.)
7. **Breaking existing features** - Modules should be isolated; failures shouldn't crash bot
8. **Skipping tests** - Write tests as you go (TDD); don't leave for end
9. **Ignoring Discord message limits** - Embeds have 6000 char limit, 25 field limit; split into multiple messages when needed (see task 10)

---

## Success Metrics

After implementation, verify these outcomes:

- [ ] Baileys version ≥7.0.0-rc.9 (fixes 405 error)
- [ ] WhatsApp QR code generates without errors
- [ ] Can enable/disable modules via Admin UI without restart
- [ ] All integration tests pass (>80% coverage)
- [ ] Module failures isolated (one module fail doesn't crash bot)
- [ ] Admin UI loads in <2 seconds
- [ ] Discord commands respond in <3 seconds
- [ ] WhatsApp messages forward in <5 seconds
- [ ] Database queries use correct indexes (check EXPLAIN)
- [ ] No SQL injection vulnerabilities (parameterized queries)
- [ ] Guild isolation enforced (cannot access other guild's data)
- [ ] Health checks return 200 status
- [ ] **`/unread` command handles 50+ messages without "Invalid Form Body" errors**
- [ ] **Messages automatically split into multiple embeds when >12 unread items**

---

## Next Command

After reviewing this plan and implementation details, proceed to:

```bash
/speckit.tasks
```

This will generate a detailed task list (tasks.md) based on the user stories in spec.md and the architecture defined in this plan.

