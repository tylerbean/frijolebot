# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FrijoleBot is a Discord bot with WhatsApp integration and a Next.js admin control panel. It monitors Discord channels for links, stores them in PostgreSQL, and provides management via Discord DMs and a web UI. The project uses a unified Docker image serving all components on a single port with path-based routing.

## Common Development Commands

### Development
```bash
# Run all services (bot, UI, gateway) in development mode
npm run dev:all

# Run individual components
npm run dev:bot          # Discord/WhatsApp bot (port 3001)
npm run dev:ui           # Next.js control panel (port 3100)
npm run dev:gateway      # Gateway proxy (port varies)

# Production
npm start                # Start the unified app
```

### Testing
```bash
npm test                 # Run Jest test suite
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Generate coverage report
npm run test:ci          # CI mode with coverage
```

### Docker
```bash
docker compose up -d     # Full stack (app + postgres + redis)
docker compose logs -f   # Follow logs
docker compose down      # Stop all services
```

## Architecture

### Core Components

**Main Entry Point**: `discord-link-bot.js` - Single file that orchestrates all services
- Initializes PostgreSQL, Cache, Health Check, and WhatsApp services
- Loads configuration from database (Discord/WhatsApp settings)
- Handles Discord client and message/reaction/command handlers

**Services** (`services/`):
- `PostgreSQLService.js` - Database operations, schema initialization, settings management
- `CacheService.js` - Redis caching layer
- `HealthCheckService.js` - Health checks for Discord/PostgreSQL/memory/uptime
- `WhatsAppService.js` - Baileys-based WhatsApp integration
- `tokenCrypto.js` - Encryption/decryption for Discord tokens stored in DB

**Handlers** (`handlers/`):
- `messageHandler.js` - Processes Discord messages, extracts URLs
- `reactionHandler.js` - Handles Discord reactions for read/unread status
- `commandHandler.js` - Discord slash commands for link management

**Control Panel** (`apps/control-panel/`):
- Next.js 14 application with Tailwind CSS
- Admin interface for configuration and monitoring
- API routes for bot management at `/api/*`

### Configuration Architecture

**Database-Driven Config**: Most runtime settings stored in PostgreSQL `app_settings` table:
- Discord bot token, guild ID, monitored channels
- WhatsApp settings and chat configurations
- Rate limiting and caching preferences
- Timezone and admin notification settings

**Environment Variables**: Only infrastructure settings:
- PostgreSQL connection details
- `ADMIN_NOTIFY_TOKEN` - For admin notifications
- `CONFIG_CRYPTO_KEY` - 32-byte key for encrypting Discord tokens in DB

### Gateway and Health Checks

**Single Port Architecture**: All services accessible through one port (3000) with path routing:
- `/` - Next.js control panel UI
- `/api/bot/*` - Bot admin and health endpoints
- `/health`, `/health/live`, `/health/ready` - Health check endpoints

**Health Check System**: Comprehensive monitoring of Discord, PostgreSQL, Redis, memory, and uptime with detailed JSON responses suitable for Kubernetes probes.

### WhatsApp Integration

**Session Management**: Uses Baileys library with local file-based session storage (`auth_info_baileys/`)
- QR code authentication sent to Discord admin channel
- Persistent sessions across restarts
- No browser dependencies

**Message Flow**: WhatsApp → WhatsAppService → Discord channel forwarding
- Supports text, images, documents, group chats
- Optional message storage in PostgreSQL
- Multi-tenant support via Discord guild isolation

## Database Schema

**Discord Tables**:
- `discord_links` - Stored URLs with read status and metadata
- `discord_dm_mappings` - DM reaction mappings with TTL

**WhatsApp Tables**:
- `whatsapp_chats` - Active chat configurations and Discord channel mappings
- `whatsapp_messages` - Message history (if enabled)

**Configuration Tables**:
- `app_settings` - Key-value store for all runtime configuration
- `monitored_channels` - Discord channel configurations per guild

## Testing

**Jest Configuration**: Uses native V8 coverage, CommonJS modules, 10s timeout
- Test files: `**/*.test.js`, `**/*.spec.js`, `**/__tests__/**/*.js`
- Coverage: `services/`, `handlers/`, `utils/`, `config/`
- Setup: `tests/setup.js`

**Test Categories**:
- Unit tests for services and handlers
- Integration tests for Discord and WhatsApp flows
- Health check endpoint testing

## Deployment

**Docker Compose**: Full stack with PostgreSQL and Redis
- Unified app image with health checks
- Persistent volumes for logs and WhatsApp sessions
- Network isolation with DNS fallbacks

**Kubernetes**: StatefulSet deployment at `~/code/flux/apps/frijolebot/deployment-frijolebot.yaml`
- Uses StatefulSet for persistent WhatsApp session storage
- PVC for WhatsApp auth (`auth_info_baileys/`) and logs
- Init container for permission fixes
- Secret-based configuration management
- Liveness/readiness probes on `/health/live` and `/health/ready`
- Resource limits: 512Mi-1Gi memory, 200m-500m CPU

**CI/CD**: GitHub Actions workflows for testing, Docker builds, and security scanning
- Automated releases with Docker Hub integration
- Multi-architecture builds with SBOM generation
- Security scanning with Trivy and npm audit