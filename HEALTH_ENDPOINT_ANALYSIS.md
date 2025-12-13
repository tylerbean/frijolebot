# Health Endpoint Analysis

## Overview

FrijoleBot exposes three health check endpoints for monitoring and Kubernetes probes. This document details each endpoint and enumerates all conditions that could cause failures.

## Health Endpoints

### 1. `/health/live` - Liveness Probe
**Location:** `services/HealthCheckService.js:349`

**Purpose:** Kubernetes liveness probe - confirms the bot process is alive.

**Success Conditions:**
- Process is running

**Failure Conditions:**
- **NONE** - This endpoint always returns 200 OK

**Response:**
```json
{
  "status": "alive",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": 123456,
  "uptime_human": "2h 3m"
}
```

---

### 2. `/health/ready` - Readiness Probe
**Location:** `services/HealthCheckService.js:365`

**Purpose:** Kubernetes readiness probe - confirms the bot is ready to serve traffic.

**Success Conditions:**
- PostgreSQL connection is healthy (`checks.postgres.connected === true`)
- Service initialization complete (`this.isReady === true`)

**Failure Conditions (Returns 503):**

#### PostgreSQL Connection Failures:
1. **Database connection pool unavailable**
   - Pool not initialized
   - Network connectivity issues to PostgreSQL host
   - Firewall blocking connection

2. **Authentication failures**
   - Invalid credentials (POSTGRES_USER, POSTGRES_PASSWORD)
   - User doesn't exist or lacks permissions

3. **Database issues**
   - Database doesn't exist (POSTGRES_DATABASE)
   - PostgreSQL service down or restarting

4. **Query timeouts**
   - `SELECT NOW()` query fails
   - `SELECT COUNT(*) FROM discord_links` fails
   - `SELECT COUNT(*) FROM discord_dm_mappings` fails

5. **Table access errors**
   - Tables don't exist (schema not initialized)
   - Permission denied on tables

#### Service Readiness:
6. **Startup grace period not elapsed**
   - First 5 seconds after process start (`this.isReady === false`)
   - Allows Discord client time to initialize

**Response (Ready):**
```json
{
  "status": "ready",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "checks": {
    "postgres": { "connected": true, "status": "connected", "response_time": 12 },
    "discord": { "connected": true, "status": "connected", "guilds": 1 },
    "memory": { "status": "ok", "usage": { "rss": 120, "heapUsed": 80 } },
    "uptime": { "status": "ok", "uptime": 123456 }
  },
  "ready": true
}
```

**Response (Not Ready):**
```json
{
  "status": "not_ready",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "checks": {
    "postgres": { "connected": false, "status": "error", "error": "Connection timeout" },
    ...
  },
  "ready": false
}
```

---

### 3. `/health` - Combined Health Check
**Location:** `services/HealthCheckService.js:384`

**Purpose:** Detailed health status with all service checks and metrics.

**Success Conditions:**
- PostgreSQL connection is healthy
- Discord connection is healthy (ONLY if Discord is required)
- Service initialization complete

**Discord Required Determination** (`services/HealthCheckService.js:423`):
1. Check `config.discord.enabled` (from database `app_settings` table)
2. Fallback to `LINK_TRACKER_ENABLED` feature flag
3. Default to `false` if both unavailable

**Failure Conditions (Returns 503):**

#### All conditions from `/health/ready`, PLUS:

#### Discord Connection Failures (Only when Discord is required):
7. **Discord client not initialized**
   - `this.discordClient` is `null` or `undefined`

8. **Discord client not ready**
   - `this.discordClient.isReady()` returns `false`
   - Bot token invalid or expired
   - Discord API connectivity issues
   - Network issues reaching Discord servers

9. **Discord token decryption failure**
   - `CONFIG_CRYPTO_KEY` environment variable missing
   - `CONFIG_CRYPTO_KEY` doesn't match key used during encryption
   - Encrypted token corrupted in database

10. **Guild cache access failure**
    - Exception when accessing `this.discordClient.guilds.cache`
    - Invalid guild ID in configuration

**Response (Healthy):**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": 123456,
  "uptime_human": "2h 3m",
  "version": "1.0.0",
  "node_version": "v20.10.0",
  "checks": {
    "discord": {
      "connected": true,
      "status": "connected",
      "guilds": 1,
      "user": "FrijoleBot#1234"
    },
    "postgres": {
      "connected": true,
      "status": "connected",
      "response_time": 12,
      "tables": {
        "links": {
          "connected": true,
          "response_time": 8,
          "database": "frijolebot",
          "data_count": 42
        },
        "dmMapping": {
          "connected": true,
          "response_time": 6,
          "database": "frijolebot",
          "data_count": 15
        }
      }
    },
    "memory": {
      "status": "ok",
      "usage": {
        "rss": 120,
        "heapTotal": 100,
        "heapUsed": 80,
        "external": 5
      },
      "unit": "MB"
    },
    "uptime": {
      "status": "ok",
      "uptime": 123456,
      "uptime_human": "2h 3m"
    }
  },
  "ready": true
}
```

**Response (Unhealthy):**
```json
{
  "status": "unhealthy",
  ...
  "checks": {
    "discord": {
      "connected": false,
      "status": "not_ready",
      "error": "Discord client not ready"
    },
    ...
  }
}
```

---

## Services NOT Checked (By Design)

### Redis / CacheService
**Status:** NOT included in health checks

**Behavior:**
- Redis connection failures are logged but do NOT affect health status
- Application automatically falls back to in-memory cache
- See `services/CacheService.js:36-43`

**Rationale:**
- Caching is a performance optimization, not a critical dependency
- Application remains functional without Redis
- Health checks should only fail for critical dependencies

**Connection Monitoring:**
- Visual status indicator available in Admin UI (`/admin`)
- Polls every 5 seconds when caching is enabled
- Red/green LED shows connection state
- Does not affect overall application health

---

### WhatsAppService
**Status:** NOT included in health checks

**Behavior:**
- WhatsApp connection state is independent of health status
- WhatsApp can be disabled without affecting bot health
- QR code authentication failures don't trigger health failures

**Rationale:**
- WhatsApp is an optional feature (can be disabled via Admin UI)
- Discord bot functionality is independent of WhatsApp status

---

### Memory Usage
**Status:** Monitored but never fails

**Behavior:**
- Always returns `status: 'ok'`
- No memory threshold defined
- Provides informational metrics only

**Future Enhancement:**
- Could add memory threshold alerts
- Could fail health check if memory exceeds limit

---

### Uptime
**Status:** Monitored but never fails

**Behavior:**
- Always returns `status: 'ok'`
- Provides uptime in milliseconds and human-readable format

---

## Common Failure Scenarios

### PostgreSQL Connection Issues
**Symptoms:**
- `/health/ready` returns 503
- `/health` returns 503
- Bot cannot track links or process commands

**Causes:**
1. PostgreSQL container not running
2. Network issues between bot and database
3. Invalid database credentials in `.env`
4. Database schema not initialized
5. Connection pool exhausted

**Resolution:**
- Check PostgreSQL is running: `docker compose ps`
- Verify connection params in `.env`
- Check logs: `docker compose logs postgres`
- Test direct connection: `psql -h localhost -U frijolebot -d frijolebot`

---

### Discord Connection Issues (When Required)
**Symptoms:**
- `/health` returns 503
- `/health/ready` returns 200 (Discord not checked)
- Bot appears offline in Discord

**Causes:**
1. Invalid or expired Discord bot token
2. `CONFIG_CRYPTO_KEY` mismatch (can't decrypt token)
3. Discord API connectivity issues
4. Bot lacks required intents (MESSAGE_CONTENT)
5. Bot not invited to guild specified in configuration

**Resolution:**
- Check `app_settings` table for `discord.enabled = true`
- Verify `CONFIG_CRYPTO_KEY` matches key used during encryption
- Test Discord connection via Admin UI (`/admin` → Test Connection)
- Check Discord Developer Portal for token validity
- Enable MESSAGE_CONTENT intent in Discord Developer Portal

---

### Startup Readiness Window
**Symptoms:**
- `/health/ready` returns 503 for first 5 seconds
- `/health` returns 503 for first 5 seconds
- Then both return 200

**Cause:**
- Intentional delay to allow Discord client initialization
- See `services/HealthCheckService.js:34-37`

**Resolution:**
- Normal behavior, no action needed
- Kubernetes should configure `initialDelaySeconds: 10` for readiness probe

---

## Kubernetes Probe Configuration

### Recommended Liveness Probe
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3
```

### Recommended Readiness Probe
```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 2
```

**Note:** Use `/health/live` for liveness, `/health/ready` for readiness. The `/health` endpoint is for manual inspection and monitoring dashboards.

---

## Monitoring and Alerting

### Critical Alerts
- `/health/ready` returns 503 for >1 minute → PostgreSQL issue
- `/health` returns 503 (when Discord required) → Discord connection issue

### Warning Alerts
- PostgreSQL response time >100ms → Database performance degradation
- Memory usage >80% of container limit → Potential OOM

### Informational Metrics
- Uptime (for tracking restarts)
- Guild count (for Discord connectivity validation)
- Table row counts (for data growth monitoring)

---

## Testing Health Endpoints

### Via curl
```bash
# Liveness probe
curl http://localhost:3001/health/live

# Readiness probe
curl http://localhost:3001/health/ready

# Combined health check
curl http://localhost:3001/health
```

### Via Admin UI
- Navigate to `/admin`
- Use "Test Connection" for Discord
- Use "Test Redis" for Redis (does not affect health)

### Via Gateway Proxy
```bash
# Through the gateway on port 3000
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
curl http://localhost:3000/health
```

**Note:** Gateway routes `/health/*` to the bot service on port 3001 (see `gateway/server.js`).

---

## Summary

### What Causes Health Check Failures?

**Critical Dependencies (Always Checked):**
- ✗ PostgreSQL connection failure
- ✗ Service not ready (first 5 seconds)

**Conditional Dependencies (Checked if Required):**
- ✗ Discord connection failure (only if `discord.enabled` or `LINK_TRACKER_ENABLED`)

### What Does NOT Cause Health Check Failures?

**Non-Critical Services:**
- ✓ Redis connection failure (falls back to in-memory cache)
- ✓ WhatsApp connection failure (optional feature)
- ✓ High memory usage (no threshold defined)
- ✓ Process age/uptime (no maximum defined)

This design ensures health checks only fail for truly critical issues that prevent the bot from functioning, while allowing graceful degradation for optional features like caching and WhatsApp integration.
