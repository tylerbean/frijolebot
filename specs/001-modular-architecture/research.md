# Research & Architecture Decisions

**Feature**: Modular Discord Bot with WhatsApp Sync and Message Tracking
**Date**: 2025-12-11
**Purpose**: Document technology choices, architecture patterns, and design decisions

## Overview

This document consolidates research findings for implementing a modular Discord bot with pluggable features. Key decisions focus on module lifecycle management, dynamic loading, and maintaining the existing FrijoleBot architecture while adding extensibility.

## Core Architecture Decisions

### Decision 1: Module System Design

**What was chosen**: Plugin-based architecture with base module interface and dynamic loading

**Rationale**:
- **Module Interface Pattern**: All modules extend `ModuleInterface` base class with standardized lifecycle hooks (initialize, enable, disable, cleanup)
- **Dependency Declaration**: Modules explicitly declare dependencies via `getDependencies()` method for validation before enablement
- **Dynamic Loading**: `moduleLoader.js` utility scans `modules/` directory and instantiates modules based on feature flags
- **Graceful Degradation**: Module failures isolated via try-catch wrappers; failed modules don't crash core bot
- **Health Reporting**: Each module implements `getHealth()` for status monitoring via HealthCheckService

**Alternatives considered**:
- **Microservices approach**: Rejected due to operational complexity (multiple processes, inter-service communication overhead)
- **Separate npm packages**: Rejected because it requires publishing/versioning for internal features
- **Monolith with feature flags only**: Rejected because code coupling makes maintenance difficult as features grow

**Implementation**: `modules/base/ModuleInterface.js` defines contract; `services/ModuleService.js` manages lifecycle

---

### Decision 2: Feature Flag Storage and Caching

**What was chosen**: PostgreSQL-backed feature flags with Redis 60-second cache

**Rationale**:
- **Database as source of truth**: `feature_flags` table stores module enabled/disabled state, persists across restarts
- **Redis caching layer**: 60-second TTL cache in `CacheService` reduces database load for frequent flag checks
- **Cache invalidation**: Explicit cache flush when flags updated via Admin UI
- **Fallback strategy**: If Redis unavailable, fall back to direct PostgreSQL queries (slower but functional)

**Alternatives considered**:
- **Environment variables**: Rejected because requires restart to change; violates FR-003 (no restart requirement)
- **Configuration files**: Rejected because requires deployment for changes; doesn't support runtime updates
- **In-memory only**: Rejected because state lost on restart; violates FR-004 (persist state)

**Implementation**: Extends existing `PostgreSQLService.getFeatureFlagCached()` method; Admin UI updates via API

---

### Decision 3: WhatsApp Integration Architecture

**What was chosen**: Baileys library with local session storage and enhanced WhatsAppService

**Rationale**:
- **whiskeysockets/baileys**: Lightweight, no Chromium dependencies (vs. whatsapp-web.js)
- **Session persistence**: Local filesystem storage in `auth_info_baileys/` Docker volume (existing pattern)
- **QR code flow**: Generate QR PNG via `qrcode` library, post to Discord admin channel as attachment
- **Module isolation**: WhatsApp functionality wrapped in `modules/whatsapp/WhatsAppModule.js`, depends on WhatsAppService
- **Chat mapping storage**: New `whatsapp_chats` table maps WhatsApp chat IDs to Discord channel IDs

**Alternatives considered**:
- **whatsapp-web.js**: Rejected due to Chromium dependency (heavy Docker image, security concerns)
- **Official WhatsApp Business API**: Rejected due to cost and phone number requirements
- **Session in database**: Rejected due to security concerns (credentials at rest); files easier to secure via volume permissions

**Implementation**: Enhance existing `services/WhatsAppService.js` with modular integration; create `WhatsAppModule.js` wrapper

---

### Decision 4: Message Tracking Implementation

**What was chosen**: Database-driven tracking with user preferences and read/unread state

**Rationale**:
- **User preferences table**: `user_tracking_preferences` stores which users each Discord user wants to track (guild-scoped)
- **Message reference table**: `tracked_messages` stores message IDs, not full content (privacy-conscious)
- **Guild isolation**: All tracking scoped by `guild_id` to prevent cross-server data leakage
- **Retention policy**: 30-day retention enforced via SchedulerService cleanup job
- **Module pattern**: Isolated in `modules/message-tracking/MessageTrackingModule.js` for easy disable

**Alternatives considered**:
- **In-memory tracking**: Rejected because state lost on restart
- **Full message storage**: Rejected due to storage costs and privacy concerns
- **Single global tracking list**: Rejected because violates multi-tenant isolation requirements

**Implementation**: New `services/MessageTrackingService.js` for business logic; MessageHandler integration for capture

---

### Decision 5: Admin UI Module Management Pages

**What was chosen**: Next.js App Router with server components for real-time module status

**Rationale**:
- **Server components**: Fetch module status directly from PostgreSQL without client-side API calls (faster page loads)
- **Module control API**: REST endpoints at `/api/modules/{id}/enable` and `/api/modules/{id}/disable` for UI actions
- **Real-time health**: Health status fetched from `HealthCheckService` endpoint, displayed with color-coded badges
- **Form validation**: Module dependency validation on client before enabling (better UX)

**Alternatives considered**:
- **Client-side SPA**: Rejected because adds unnecessary complexity (useState, useEffect, API calls)
- **Polling for status**: Rejected in favor of server components that render latest state on each page load
- **WebSocket updates**: Rejected as overkill for admin-only feature with low traffic

**Implementation**: New pages under `apps/control-panel/app/admin/modules/`; API routes in `apps/control-panel/app/api/modules/`

---

## Technology-Specific Best Practices

### Discord.js Patterns

**Research findings**:
- **Ephemeral replies**: Use `interaction.reply({ ephemeral: true })` for user-private data (tracking lists, module status)
- **Deferred replies**: Use `interaction.deferReply()` for commands that take >3 seconds (QR code generation, module enabling)
- **Slash command registration**: Register module commands dynamically when module enabled; unregister when disabled
- **Rate limiting**: Existing `CommandHandler` rate limiting pattern sufficient; apply to all new module commands

**Implementation**: Module commands registered via `commandHandler.js` delegation to `moduleHandler.js`

---

### Baileys/WhatsApp Integration

**Research findings**:
- **Session restoration**: Baileys auto-restores from `auth_info_baileys/` if present; no manual reload needed
- **QR code generation**: Use `qrcode.toBuffer()` to generate PNG, attach to Discord message
- **Event handling**: Listen for `messages.upsert` event for new messages; `connection.update` for auth status
- **Media downloads**: Baileys provides `downloadMediaMessage()` helper; forward to Discord as attachments
- **Group chat support**: Group chats use format `{group-id}@g.us`; individual chats use `{phone}@c.us`

**Implementation**: Enhance existing `WhatsAppService.js` event handlers; module wrapper delegates to service

---

### PostgreSQL Schema Design

**Research findings**:
- **Feature flags table**: Extend existing `feature_flags` table with `updated_at` timestamp for cache invalidation
- **Indexes**: Create indexes on `guild_id`, `user_id`, `chat_id` for frequently queried columns
- **JSONB config**: Store module-specific config as JSONB column in `feature_flags` table for flexibility
- **Foreign keys**: Use ON DELETE CASCADE for chat mappings when Discord channels deleted
- **Idempotent schema**: Use `CREATE TABLE IF NOT EXISTS` for zero-downtime deployments

**Implementation**: Schema changes in `PostgreSQLService.initializeDatabase()`

---

### Redis Caching Strategy

**Research findings**:
- **TTL-based invalidation**: 60-second TTL for feature flags balances freshness vs. DB load
- **Key naming**: Use prefix pattern `flag:{module_id}` for cache keys
- **Fallback behavior**: Existing `CacheService` already has in-memory Map fallback if Redis unavailable
- **Cache warming**: Pre-populate cache on bot startup by fetching all feature flags

**Implementation**: Use existing `CacheService.get/set` with 60-second TTL

---

## Integration Points

### Existing FrijoleBot Integration

**Identified touchpoints**:
1. **PostgreSQLService**: Extend `initializeDatabase()` with new tables (modules, whatsapp_chats, user_tracking_preferences, tracked_messages)
2. **CommandHandler**: Add module command delegation logic; route module-specific commands to respective modules
3. **MessageHandler**: Hook for message tracking capture when MessageTrackingModule enabled
4. **HealthCheckService**: Add module health status to `/health` endpoint response
5. **Admin UI**: Extend `/admin` section with module management pages

**Backward compatibility**:
- Existing features (link tracking) continue working unchanged
- New modules disabled by default; zero impact until explicitly enabled
- Database migrations idempotent (CREATE IF NOT EXISTS)

---

## Performance Considerations

**Identified optimizations**:
- **Feature flag caching**: 60-second Redis cache reduces DB queries from O(n commands/sec) to O(1 per minute)
- **Module lazy loading**: Modules only instantiated when enabled (memory savings)
- **Database connection pooling**: Existing PostgreSQL pool reused; no new connections per module
- **Indexed queries**: Indexes on guild_id, user_id, chat_id for tracking queries
- **WhatsApp session reuse**: Single Baileys connection shared across chat mappings

**Estimated impact**:
- Module enable/disable: <100ms (single DB write + cache invalidation)
- Feature flag check (cached): <1ms (Redis lookup)
- Message tracking capture: <10ms (single indexed insert)
- WhatsApp message forward: <500ms (Baileys event + Discord API call)

---

## Security Considerations

**Implemented safeguards**:
- **Discord token encryption**: Existing AES-256-GCM via `tokenCrypto.js` with CONFIG_CRYPTO_KEY
- **WhatsApp session protection**: Files in Docker volume with restrictive permissions (600)
- **SQL injection prevention**: Parameterized queries ($1, $2) throughout
- **Guild isolation**: All queries scoped by guild_id to prevent cross-server data access
- **Admin UI access**: No authentication in MVP (assume internal network); document for future enhancement
- **Rate limiting**: Apply to all module commands to prevent abuse

**Security audit checklist**:
- [x] No plain text credentials in database
- [x] No credentials in git (WhatsApp sessions in .gitignore)
- [x] Parameterized SQL queries
- [x] Guild-scoped data queries
- [x] Rate limiting on all user-facing commands

---

## Testing Strategy

**Test categories**:

**Unit tests** (Jest with mocks):
- `ModuleService.test.js`: Module lifecycle, dependency validation, enable/disable logic
- `MessageTrackingService.test.js`: Tracking preferences, read/unread state, retention cleanup
- `moduleLoader.test.js`: Dynamic loading, error handling, graceful degradation

**Integration tests** (with test DB):
- `ModuleLifecycle.test.js`: Enable module → register commands → process events → disable module
- `WhatsAppDiscordSync.test.js`: WhatsApp message → chat mapping lookup → Discord channel post
- `FeatureFlagCache.test.js`: DB write → cache invalidation → flag read

**Contract tests**:
- Module API endpoints return expected schemas
- Module interface implementations conform to base class contract

---

## Module Development Guidelines

**For future module developers**:

**1. Module structure**:
```javascript
modules/
└── my-feature/
    ├── MyFeatureModule.js  // Extends ModuleInterface
    ├── commands.js         // Slash command definitions
    ├── config.js           // Module-specific config schema
    └── README.md           // Feature documentation
```

**2. Module interface implementation**:
```javascript
class MyFeatureModule extends ModuleInterface {
  constructor(services) {
    super('my-feature', 'My Feature Description', ['dependency-module-id']);
    this.services = services; // { postgres, cache, discord, logger }
  }

  async initialize() { /* Setup logic */ }
  async enable() { /* Start processing */ }
  async disable() { /* Stop processing */ }
  async cleanup() { /* Teardown */ }
  getHealth() { /* Return status */ }
}
```

**3. Command registration**:
- Commands defined in `commands.js` as SlashCommandBuilder objects
- Register via `moduleHandler.registerModuleCommands(moduleId, commands)` on enable
- Unregister via `moduleHandler.unregisterModuleCommands(moduleId)` on disable

**4. Database tables**:
- Add schema to `PostgreSQLService.initializeDatabase()`
- Use module ID as table name prefix (e.g., `myfeature_data`)
- Include guild_id for multi-tenant isolation

---

## Deployment Considerations

**Docker changes**:
- No Dockerfile changes required (Node.js 20 base already supports all dependencies)
- WhatsApp session volume already configured: `whatsapp-sessions:/app/auth_info_baileys`
- New modules auto-discovered via filesystem scan (no build step changes)

**Database migrations**:
- Run `PostgreSQLService.initializeDatabase()` on startup (idempotent CREATE IF NOT EXISTS)
- No manual migration scripts needed for MVP

**Environment variables**:
- No new env vars required (module state in database)
- Existing `CONFIG_CRYPTO_KEY`, `POSTGRES_*`, `REDIS_URL` sufficient

---

## Open Questions & Future Enhancements

**Deferred to post-MVP**:
- **Admin UI authentication**: Currently assumes trusted network; add Discord OAuth in v2
- **Module marketplace**: Allow third-party modules; requires code signing/sandboxing
- **Module versioning**: Track module versions for compatibility checking
- **Hot reload**: Reload module code without restart (currently requires restart for code changes)
- **Module permissions**: Fine-grained control over which guilds can enable which modules

**Documented assumptions**:
- Admin UI accessed by trusted administrators only (internal network)
- Modules trusted (no malicious code sandboxing)
- Single bot instance per deployment (no distributed locking for module state)

---

## Summary

This architecture extends FrijoleBot with a robust plugin system while maintaining existing functionality and constitution compliance. Key innovations include dynamic module loading, database-driven feature flags with Redis caching, and graceful module isolation. The design supports unlimited future modules without core code changes, fulfilling FR-022 and SC-002.

**Next steps**: Proceed to Phase 1 (data-model.md, contracts/, quickstart.md)
