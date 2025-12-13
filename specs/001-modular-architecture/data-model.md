# Data Model

**Feature**: Modular Discord Bot with WhatsApp Sync and Message Tracking
**Date**: 2025-12-11
**Purpose**: Define database schema, entities, relationships, and validation rules

## Overview

This data model extends the existing FrijoleBot PostgreSQL schema with tables for module management, WhatsApp chat mappings, and message tracking. All tables follow existing patterns (serial PKs, timestamps, guild isolation) and use `CREATE TABLE IF NOT EXISTS` for idempotent schema initialization.

---

## Entity Definitions

### 1. Module Registry

**Entity**: `modules`

**Purpose**: Registry of all available modules with metadata and configuration

**Fields**:
- `id` (VARCHAR(50), PRIMARY KEY): Unique module identifier (e.g., 'whatsapp', 'message-tracking')
- `name` (VARCHAR(100), NOT NULL): Human-readable module name
- `description` (TEXT): Module purpose and functionality description
- `version` (VARCHAR(20)): Module version (semantic versioning)
- `dependencies` (TEXT[]): Array of module IDs this module depends on
- `config_schema` (JSONB): JSON Schema definition for module configuration
- `default_config` (JSONB): Default configuration values
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)

**Relationships**:
- One-to-many with `module_states` (one module can be enabled/disabled per guild)

**Validation Rules**:
- `id` must match pattern `^[a-z0-9-]+$` (lowercase alphanumeric with hyphens)
- `dependencies` must reference valid module IDs (enforced in application layer)
- `config_schema` must be valid JSON Schema v7

**Indexes**:
- PRIMARY KEY on `id`

**Example Row**:
```json
{
  "id": "whatsapp",
  "name": "WhatsApp Integration",
  "description": "Sync WhatsApp chats to Discord channels",
  "version": "1.0.0",
  "dependencies": [],
  "config_schema": {
    "type": "object",
    "properties": {
      "adminChannelId": {"type": "string"},
      "maxChatMappings": {"type": "number", "default": 10}
    }
  },
  "default_config": {"maxChatMappings": 10}
}
```

---

### 2. Module State

**Entity**: `module_states`

**Purpose**: Track enabled/disabled state per guild with module-specific configuration

**Fields**:
- `id` (SERIAL, PRIMARY KEY)
- `module_id` (VARCHAR(50), NOT NULL, REFERENCES modules(id) ON DELETE CASCADE)
- `guild_id` (VARCHAR(20), NOT NULL): Discord guild (server) ID
- `enabled` (BOOLEAN, DEFAULT FALSE): Whether module is active for this guild
- `config` (JSONB): Guild-specific module configuration (overrides default_config)
- `enabled_by` (VARCHAR(20)): Discord user ID who enabled the module
- `enabled_at` (TIMESTAMP WITH TIME ZONE): When module was last enabled
- `disabled_at` (TIMESTAMP WITH TIME ZONE): When module was last disabled
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)

**Relationships**:
- Many-to-one with `modules` (foreign key on `module_id`)

**Validation Rules**:
- `config` must conform to `modules.config_schema` for the referenced module (application layer)
- UNIQUE constraint on (`module_id`, `guild_id`) - one state record per module per guild

**Indexes**:
- PRIMARY KEY on `id`
- UNIQUE INDEX on (`module_id`, `guild_id`)
- INDEX on `guild_id` for guild-scoped queries
- INDEX on `enabled` for filtering active modules

**State Transitions**:
```
disabled (enabled=false) → enabled (enabled=true) → disabled
                          ↑                       ↓
                          └─── enable() ─────────┘
```

**Example Row**:
```json
{
  "id": 1,
  "module_id": "whatsapp",
  "guild_id": "123456789012345678",
  "enabled": true,
  "config": {"adminChannelId": "987654321098765432"},
  "enabled_by": "111222333444555666",
  "enabled_at": "2025-12-11T10:00:00Z"
}
```

---

### 3. WhatsApp Chat Mappings

**Entity**: `whatsapp_chats` (extends existing table)

**Purpose**: Map WhatsApp chats to Discord channels for message forwarding

**Fields**:
- `id` (SERIAL, PRIMARY KEY)
- `guild_id` (VARCHAR(20), NOT NULL): Discord guild ID
- `chat_id` (VARCHAR(100), NOT NULL): WhatsApp chat ID (format: `{id}@c.us` or `{id}@g.us`)
- `discord_channel_id` (VARCHAR(20), NOT NULL): Target Discord channel ID
- `chat_name` (VARCHAR(255)): WhatsApp chat display name
- `chat_type` (VARCHAR(20), CHECK IN ('individual', 'group')): Chat type
- `is_active` (BOOLEAN, DEFAULT TRUE): Whether forwarding is active
- `sync_media` (BOOLEAN, DEFAULT TRUE): Whether to forward media attachments
- `last_message_at` (TIMESTAMP WITH TIME ZONE): Timestamp of last forwarded message
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)

**Relationships**:
- Many-to-one with Discord channels (via `discord_channel_id`)

**Validation Rules**:
- `chat_id` must match pattern `^[0-9]+@(c|g)\.us$`
- `discord_channel_id` must be valid snowflake ID (19 digits)
- UNIQUE constraint on (`guild_id`, `chat_id`) - one mapping per chat per guild

**Indexes**:
- PRIMARY KEY on `id`
- UNIQUE INDEX on (`guild_id`, `chat_id`)
- INDEX on `guild_id` for guild-scoped queries
- INDEX on `is_active` for filtering active mappings

**Example Row**:
```json
{
  "id": 1,
  "guild_id": "123456789012345678",
  "chat_id": "5511998765432@c.us",
  "discord_channel_id": "987654321098765432",
  "chat_name": "John Doe",
  "chat_type": "individual",
  "is_active": true,
  "sync_media": true,
  "last_message_at": "2025-12-11T09:30:00Z"
}
```

---

### 4. WhatsApp Session Metadata

**Entity**: `whatsapp_sessions` (extends existing table)

**Purpose**: Track WhatsApp session status (credentials stored in filesystem)

**Fields**:
- `id` (SERIAL, PRIMARY KEY)
- `guild_id` (VARCHAR(20), UNIQUE, NOT NULL): Discord guild ID (one session per guild)
- `session_id` (VARCHAR(100), NOT NULL): Unique session identifier
- `status` (VARCHAR(20), CHECK IN ('disconnected', 'connecting', 'connected', 'failed')): Connection status
- `phone_number` (VARCHAR(20)): Authenticated WhatsApp phone number (for display only)
- `device_info` (TEXT): Device information string
- `last_connected_at` (TIMESTAMP WITH TIME ZONE): Last successful connection
- `last_qr_generated_at` (TIMESTAMP WITH TIME ZONE): Last QR code generation
- `qr_retry_count` (INTEGER, DEFAULT 0): Number of QR code retries
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)

**Relationships**:
- One-to-one with guild (one WhatsApp session per guild)

**Validation Rules**:
- UNIQUE constraint on `guild_id`
- `phone_number` must match pattern `^\+[0-9]{10,15}$` if present

**Indexes**:
- PRIMARY KEY on `id`
- UNIQUE INDEX on `guild_id`
- INDEX on `status` for connection health queries

**State Transitions**:
```
disconnected → connecting → connected
     ↑              ↓            ↓
     └──── failed ←─────────────┘
```

**Example Row**:
```json
{
  "id": 1,
  "guild_id": "123456789012345678",
  "session_id": "wa-session-123456",
  "status": "connected",
  "phone_number": "+5511998765432",
  "device_info": "WhatsApp/2.23.24",
  "last_connected_at": "2025-12-11T08:00:00Z"
}
```

---

### 5. User Tracking Preferences

**Entity**: `user_tracking_preferences`

**Purpose**: Define which users each Discord user wants to track

**Fields**:
- `id` (SERIAL, PRIMARY KEY)
- `guild_id` (VARCHAR(20), NOT NULL): Discord guild ID (for isolation)
- `tracker_user_id` (VARCHAR(20), NOT NULL): Discord user ID doing the tracking
- `tracked_user_id` (VARCHAR(20), NOT NULL): Discord user ID being tracked
- `tracked_username` (VARCHAR(100)): Cached username for display (may be stale)
- `notification_enabled` (BOOLEAN, DEFAULT FALSE): Whether to DM notifications for new messages
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)

**Relationships**:
- Many-to-one with Discord users (via `tracker_user_id` and `tracked_user_id`)

**Validation Rules**:
- UNIQUE constraint on (`guild_id`, `tracker_user_id`, `tracked_user_id`) - no duplicate tracking entries
- `tracker_user_id` ≠ `tracked_user_id` (cannot track yourself)

**Indexes**:
- PRIMARY KEY on `id`
- UNIQUE INDEX on (`guild_id`, `tracker_user_id`, `tracked_user_id`)
- INDEX on (`guild_id`, `tracker_user_id`) for user's tracking list queries
- INDEX on `tracked_user_id` for reverse lookups

**Example Row**:
```json
{
  "id": 1,
  "guild_id": "123456789012345678",
  "tracker_user_id": "111222333444555666",
  "tracked_user_id": "999888777666555444",
  "tracked_username": "alice#1234",
  "notification_enabled": false
}
```

---

### 6. Tracked Messages

**Entity**: `tracked_messages`

**Purpose**: Store references to messages from tracked users with read/unread status

**Fields**:
- `id` (SERIAL, PRIMARY KEY)
- `guild_id` (VARCHAR(20), NOT NULL): Discord guild ID
- `tracker_user_id` (VARCHAR(20), NOT NULL): User who is tracking
- `message_id` (VARCHAR(20), NOT NULL): Discord message ID
- `channel_id` (VARCHAR(20), NOT NULL): Discord channel ID where message was sent
- `author_id` (VARCHAR(20), NOT NULL): Discord user ID who sent the message (tracked user)
- `author_username` (VARCHAR(100)): Cached username for display
- `message_preview` (VARCHAR(200)): First 200 chars of message content (for preview)
- `read` (BOOLEAN, DEFAULT FALSE): Whether message has been marked as read
- `read_at` (TIMESTAMP WITH TIME ZONE): When message was marked as read
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP): When message was sent
- `expires_at` (TIMESTAMP WITH TIME ZONE, NOT NULL): When message should be purged (created_at + 30 days)

**Relationships**:
- Many-to-one with `user_tracking_preferences` (via guild_id, tracker_user_id, author_id)

**Validation Rules**:
- UNIQUE constraint on (`guild_id`, `tracker_user_id`, `message_id`) - no duplicate tracking
- `expires_at` must be future date (enforced as `created_at + INTERVAL '30 days'`)

**Indexes**:
- PRIMARY KEY on `id`
- UNIQUE INDEX on (`guild_id`, `tracker_user_id`, `message_id`)
- INDEX on (`guild_id`, `tracker_user_id`, `read`) for unread message queries
- INDEX on `expires_at` for retention cleanup job
- INDEX on (`guild_id`, `author_id`) for messages from specific tracked user

**Retention Policy**:
- Messages automatically deleted after 30 days via SchedulerService cleanup job
- Cleanup query: `DELETE FROM tracked_messages WHERE expires_at < NOW()`

**Example Row**:
```json
{
  "id": 1,
  "guild_id": "123456789012345678",
  "tracker_user_id": "111222333444555666",
  "message_id": "1234567890123456789",
  "channel_id": "987654321098765432",
  "author_id": "999888777666555444",
  "author_username": "alice#1234",
  "message_preview": "Hey, did you see the latest update on the project? We need to discuss...",
  "read": false,
  "created_at": "2025-12-11T10:00:00Z",
  "expires_at": "2026-01-10T10:00:00Z"
}
```

---

## Relationship Diagram

```
┌─────────────┐
│   modules   │
│  (registry) │
└──────┬──────┘
       │ 1:N
       ↓
┌──────────────┐      ┌────────────────────┐
│module_states │      │whatsapp_sessions   │
│ (per guild)  │      │  (per guild)       │
└──────────────┘      └────────────────────┘

┌────────────────────┐
│ whatsapp_chats     │
│ (chat→channel map) │
└────────────────────┘

┌──────────────────────┐      1:N      ┌──────────────────┐
│user_tracking_prefs   │───────────────→│tracked_messages  │
│  (who tracks whom)   │                │ (message refs)   │
└──────────────────────┘                └──────────────────┘
```

**Key**:
- Solid lines: Foreign key relationships
- Dashed lines: Application-level associations
- 1:N = One-to-many relationship

---

## Schema Migration Script

**Location**: `services/PostgreSQLService.js` → `initializeDatabase()`

```sql
-- Modules registry
CREATE TABLE IF NOT EXISTS modules (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  version VARCHAR(20),
  dependencies TEXT[],
  config_schema JSONB,
  default_config JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Module state per guild
CREATE TABLE IF NOT EXISTS module_states (
  id SERIAL PRIMARY KEY,
  module_id VARCHAR(50) NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  guild_id VARCHAR(20) NOT NULL,
  enabled BOOLEAN DEFAULT FALSE,
  config JSONB,
  enabled_by VARCHAR(20),
  enabled_at TIMESTAMP WITH TIME ZONE,
  disabled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(module_id, guild_id)
);
CREATE INDEX idx_module_states_guild ON module_states(guild_id);
CREATE INDEX idx_module_states_enabled ON module_states(enabled);

-- WhatsApp chat mappings (extends existing table)
-- Already exists in current schema, adding new columns if needed
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS sync_media BOOLEAN DEFAULT TRUE;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_guild ON whatsapp_chats(guild_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_active ON whatsapp_chats(is_active);

-- WhatsApp sessions (extends existing table)
ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS guild_id VARCHAR(20);
ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS qr_retry_count INTEGER DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_sessions_guild ON whatsapp_sessions(guild_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_status ON whatsapp_sessions(status);

-- User tracking preferences
CREATE TABLE IF NOT EXISTS user_tracking_preferences (
  id SERIAL PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  tracker_user_id VARCHAR(20) NOT NULL,
  tracked_user_id VARCHAR(20) NOT NULL,
  tracked_username VARCHAR(100),
  notification_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guild_id, tracker_user_id, tracked_user_id),
  CHECK (tracker_user_id != tracked_user_id)
);
CREATE INDEX idx_tracking_prefs_tracker ON user_tracking_preferences(guild_id, tracker_user_id);
CREATE INDEX idx_tracking_prefs_tracked ON user_tracking_preferences(tracked_user_id);

-- Tracked messages
CREATE TABLE IF NOT EXISTS tracked_messages (
  id SERIAL PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  tracker_user_id VARCHAR(20) NOT NULL,
  message_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  author_id VARCHAR(20) NOT NULL,
  author_username VARCHAR(100),
  message_preview VARCHAR(200),
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  UNIQUE(guild_id, tracker_user_id, message_id)
);
CREATE INDEX idx_tracked_msgs_unread ON tracked_messages(guild_id, tracker_user_id, read);
CREATE INDEX idx_tracked_msgs_expires ON tracked_messages(expires_at);
CREATE INDEX idx_tracked_msgs_author ON tracked_messages(guild_id, author_id);
```

---

## Data Access Patterns

### 1. Check if Module Enabled

```javascript
// Query
const result = await pool.query(
  'SELECT enabled FROM module_states WHERE module_id = $1 AND guild_id = $2',
  [moduleId, guildId]
);
const enabled = result.rows[0]?.enabled || false;

// Index used: idx_module_states_guild (partial match)
// Expected performance: <1ms (indexed lookup)
```

### 2. Get Unread Tracked Messages for User

```javascript
// Query
const result = await pool.query(
  `SELECT message_id, channel_id, author_username, message_preview, created_at
   FROM tracked_messages
   WHERE guild_id = $1 AND tracker_user_id = $2 AND read = FALSE
   ORDER BY created_at DESC
   LIMIT 50`,
  [guildId, trackerUserId]
);

// Index used: idx_tracked_msgs_unread
// Expected performance: <5ms (indexed query + sort + limit)
```

### 3. Get WhatsApp Chat Mappings

```javascript
// Query
const result = await pool.query(
  'SELECT chat_id, discord_channel_id FROM whatsapp_chats WHERE guild_id = $1 AND is_active = TRUE',
  [guildId]
);

// Index used: idx_whatsapp_chats_active + idx_whatsapp_chats_guild
// Expected performance: <2ms (indexed lookup)
```

### 4. Cleanup Expired Tracked Messages

```javascript
// Query (run by SchedulerService every 24 hours)
const result = await pool.query(
  'DELETE FROM tracked_messages WHERE expires_at < NOW() RETURNING id'
);
console.log(`Deleted ${result.rowCount} expired messages`);

// Index used: idx_tracked_msgs_expires
// Expected performance: <100ms (indexed delete)
```

---

## Validation Rules Summary

| Entity                 | Rule                                        | Enforcement          |
|------------------------|---------------------------------------------|----------------------|
| modules                | ID matches `^[a-z0-9-]+$`                   | Application layer    |
| modules                | Dependencies reference valid module IDs     | Application layer    |
| module_states          | Config conforms to module's config_schema   | Application layer    |
| module_states          | UNIQUE (module_id, guild_id)                | Database constraint  |
| whatsapp_chats         | chat_id matches WhatsApp ID pattern         | Application layer    |
| whatsapp_chats         | UNIQUE (guild_id, chat_id)                  | Database constraint  |
| whatsapp_sessions      | UNIQUE guild_id                             | Database constraint  |
| user_tracking_prefs    | tracker_user_id ≠ tracked_user_id           | Database CHECK       |
| user_tracking_prefs    | UNIQUE (guild_id, tracker, tracked)         | Database constraint  |
| tracked_messages       | expires_at = created_at + 30 days           | Application layer    |
| tracked_messages       | UNIQUE (guild_id, tracker_user_id, msg_id)  | Database constraint  |

---

## Summary

This data model supports modular architecture with:
- **Module registry**: Central catalog of available modules with metadata
- **Per-guild module state**: Isolated enable/disable state with custom config
- **WhatsApp integration**: Chat-to-channel mappings with session tracking
- **Message tracking**: User preferences and message references with 30-day retention

All tables include guild isolation, appropriate indexes for performance, and validation rules for data integrity. Schema is idempotent for zero-downtime deployments.

**Next step**: Generate API contracts (contracts/)
