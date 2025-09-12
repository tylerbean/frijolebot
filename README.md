# FrijoleBot (Discord Link Bot + WhatsApp + Admin UI)

[![Docker Build](https://github.com/tylerbean/frijolebot/actions/workflows/docker-build.yml/badge.svg)](https://github.com/tylerbean/frijolebot/actions/workflows/docker-build.yml)
[![Tests](https://github.com/tylerbean/frijolebot/actions/workflows/test.yml/badge.svg)](https://github.com/tylerbean/frijolebot/actions/workflows/test.yml)
[![Security Scan](https://github.com/tylerbean/frijolebot/actions/workflows/security.yml/badge.svg)](https://github.com/tylerbean/frijolebot/actions/workflows/security.yml)

Unified app image that serves a Next.js Admin UI at `/`, proxies bot endpoints at `/api/bot/*`, and exposes health checks at `/health`. Configuration (Discord, WhatsApp, Rate Limiting, Caching, Timezone) is managed in PostgreSQL via the Admin UI.

## Features

### Core Discord Features
- **Multi-channel monitoring**: Configure multiple channels to monitor within a single Discord server
- **URL detection**: Automatically detects HTTP/HTTPS URLs in messages
- **Database storage**: Stores detected links in PostgreSQL database with metadata
- **DM link management**: Users can view and manage unread links via DM interactions
- **Reaction-based interface**: Toggle read/unread status using Discord reactions
- **Multi-server support**: Works across multiple Discord servers with proper access control
- **Rate limiting**: Built-in rate limiting for slash commands to prevent abuse
- **Health monitoring**: Built-in health check endpoints for Kubernetes deployments
- **Configurable**: Easy setup via environment variables
- **Error handling**: Robust error handling + logging

### WhatsApp Integration (NEW!)
- **WhatsApp Web connection**: Connect to personal WhatsApp accounts via Baileys library (no browser required!)
- **Message forwarding**: Forward messages from WhatsApp chats to Discord channels
- **Media support**: Handle text messages, images, documents, and other media files
- **Group chat support**: Monitor both individual and group WhatsApp conversations
- **Session management**: Persistent session storage via local WhatsApp auth files
- **QR code authentication**: Automatic QR code generation and Discord notifications
- **Multi-tenant ready**: Support for multiple Discord servers with proper isolation
- **Lightweight**: No Chromium dependencies - uses pure Node.js WebSocket connections

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable the following bot permissions:
   - Read Messages/View Channels
   - Send Messages
   - Create Public Threads
   - Add Reactions
   - Manage Messages

### 3. Environment Variables

Use `.env.example` as a template. Most runtime settings are stored in the database and configured via the Admin UI. Locally, you typically set:

```
POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE
REDIS_URL
ADMIN_NOTIFY_TOKEN
```

### 4. Add Bot to Server

1. In Discord Developer Portal, go to OAuth2 > URL Generator
2. Select scopes: `bot`
3. Select permissions: `Read Messages`, `Send Messages`, `Create Public Threads`, `Add Reactions`, `Manage Messages`
4. Use generated URL to add bot to your server

### 5. Database Setup

The bot automatically initializes the PostgreSQL database schema when it starts. The database includes the following tables:

#### Discord Tables
- **discord_links**: Stores Discord message links with read status and metadata
- **discord_dm_mappings**: Stores DM reaction mappings with expiration times

#### WhatsApp Tables  
- **whatsapp_chats**: Stores active WhatsApp chat configurations
- **whatsapp_messages**: Stores WhatsApp messages linked to Discord messages

### 6. WhatsApp Integration Setup (Optional)

If you want to enable WhatsApp integration:

1. **Configure WhatsApp chats**:
   - Add entries to the `whatsapp_chats` table for chats you want to monitor
   - Use the correct WhatsApp chat ID format (see documentation below)

3. 

4. **Set up admin channel**:
   - Create a Discord channel for QR codes and admin notifications
   - Add the channel ID to `DISCORD_ADMIN_CHANNEL`

### 6. Run the App

```bash
# Production
npm start

# Development (with auto-restart)
npm run dev

# Docker (unified app + postgres + redis)
docker compose up -d

# Docker (manual build)
docker build -t frijolebot .
docker run -d --name frijolebot --env-file .env frijolebot
```

## CI/CD with GitHub Actions

The project includes comprehensive GitHub Actions workflows for automated testing, building, and deployment:

### Automated Workflows

- **🧪 Testing**: Unit tests, syntax checking, and Docker build testing on every PR
- **🐳 Docker Build**: Multi-architecture Docker images with automatic tagging
- **🔒 Security**: Weekly vulnerability scans and dependency audits
- **📦 Releases**: Automatic GitHub releases with Docker images for tags

### Features

- **Multi-architecture builds** (linux/amd64, linux/arm64)
- **Security scanning** with Trivy and npm audit
- **Health check testing** for every build
- **Automatic Docker Hub pushes** for main branch and releases
- **Software Bill of Materials** (SBOM) generation

See [`.github/workflows/README.md`](.github/workflows/README.md) for detailed setup instructions.

### Quick Setup for Docker Hub Integration

1. **Create Docker Hub Access Token**:
   - Go to [Docker Hub](https://hub.docker.com/) → Account Settings → Security
   - Create new access token with "Read, Write, Delete" permissions

2. **Add GitHub Secrets**:
   - Go to your GitHub repository → Settings → Secrets and variables → Actions
   - Add secrets:
     - `DOCKERHUB_USERNAME`: Your Docker Hub username
     - `DOCKERHUB_TOKEN`: Your Docker Hub access token

3. **Automatic Builds**:
   - Push to `main` branch → Docker image built and pushed to Docker Hub
   - Create a tag (e.g., `v1.0.0`) → GitHub release created with Docker image

### Helper Scripts

Use the included scripts to set up and test Docker Hub integration:

```bash
# Setup guide for Docker Hub integration
./scripts/setup-dockerhub.sh

# Test Docker build and health checks locally
./scripts/test-dockerhub.sh
```

## Docker Deployment (Single image)

The unified app image includes the Next.js Admin UI, Discord/WhatsApp services, and gateway on a single port:

### Docker Compose (Recommended)

```bash
docker compose up -d
docker compose logs -f
docker compose down
```

### Docker Features

- **Health Checks**: Built-in health check endpoints at `/health/live` and `/health/ready`
- **Rate Limiting**: Configurable rate limiting for slash commands
- **Security**: Runs as non-root user
- **Monitoring**: Exposes port 3000 for health check monitoring
- **Logging**: Logs directory mounted for persistence
- **WhatsApp Support**: Lightweight Baileys integration (no browser required)
- **Session Persistence**: WhatsApp session data persisted via Docker volumes

### Single Port Gateway

- UI: `/`
- Bot API: `/api/bot/*`
- Health: `/health`, `/health/live`, `/health/ready`

Reverse proxies (NGINX/Traefik) can route on path prefixes to the single service.

## Adding More Channels

To monitor additional channels:

1. Get the channel ID (right-click channel > Copy ID)
2. Add environment variable in `.env`:
   ```
   DISCORD_CHANNEL_NEW_CHANNEL=your_channel_id_here
   ```
3. Uncomment or add the channel in `discord-link-bot.js` config:
   ```javascript
   channelsToMonitor: [
       process.env.DISCORD_CHANNEL_SHARES_FOOD,
       process.env.DISCORD_CHANNEL_NEW_CHANNEL,
       // Add more here...
   ].filter(Boolean)
   ```

## Data Storage

The bot stores the following data in PostgreSQL for each detected URL:

```json
{
  "url": "https://example.com",
  "content": "message content with https://example.com",
  "channel_id": "1409952645346758676",
  "channel_name": "shares-food",
  "user": "username",
  "user_id": "user_id",
  "message_id": "message_id",
  "timestamp": "2025-09-03T20:45:00.000Z",
  "read": false
}
```

## Health Monitoring and Gateway

The gateway serves UI at `/`, bot admin/health at `/health` and `/api/bot/*`. Useful for reverse proxies in front.

### Health Check Endpoints

- **`GET /health/live`** - Liveness probe (process is alive)
- **`GET /health/ready`** - Readiness probe (ready to serve requests)
- **`GET /health`** - Combined health status with detailed information

### Example Health Check Response

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": 3600000,
  "uptime_human": "1h 0m",
  "version": "1.0.0",
  "node_version": "v18.17.0",
  "checks": {
    "discord": {
      "connected": true,
      "status": "connected",
      "guilds": 2,
      "user": "FrijoleBot#1234"
    },
    "postgres": {
      "connected": true,
      "status": "connected",
      "response_time": 15
    },
    "memory": {
      "status": "ok",
      "usage": {
        "rss": 45,
        "heapTotal": 20,
        "heapUsed": 15,
        "external": 5
      },
      "unit": "MB"
    },
    "uptime": {
      "status": "ok",
      "uptime": 3600000,
      "uptime_human": "1h 0m"
    }
  },
  "ready": true
}
```

### Kubernetes Deployment

See `k8s-deployment.yaml` for a complete Kubernetes deployment example with:
- Liveness and readiness probes
- Resource limits and requests
- ConfigMap and Secret management
- Health check service configuration

### Environment Variables

- **`HEALTH_CHECK_PORT`** - Port for health check server (default: 3000)
- **`RATE_LIMIT_ENABLED`** - Enable/disable rate limiting (default: true)
- **`RATE_LIMIT_WINDOW_MS`** - Rate limit window in milliseconds (default: 60000)
- **`RATE_LIMIT_MAX_REQUESTS`** - Maximum requests per window (default: 5)
- **`RATE_LIMIT_CLEANUP_INTERVAL`** - Cleanup interval in milliseconds (default: 300000)

## Rate Limiting

The bot includes built-in rate limiting for slash commands to prevent abuse and ensure fair usage:

### Features

- **Per-user limits**: Each user has independent rate limits
- **Per-command limits**: Different commands can have separate limits
- **Configurable windows**: Adjustable time windows and request limits
- **Automatic cleanup**: Expired rate limit entries are automatically removed
- **User-friendly messages**: Clear error messages with retry information

### Default Configuration

- **Window**: 1 minute (60,000ms)
- **Limit**: 5 requests per window
- **Cleanup**: Every 5 minutes

### Rate Limit Response

When a user exceeds the rate limit, they receive a message like:

```
⏰ Rate Limited

You've used this command too many times. Please try again in 45 seconds.

*You can use this command 5 times per minute.*
```

### Configuration Examples

**Stricter limits (3 requests per 2 minutes):**
```bash
RATE_LIMIT_WINDOW_MS=120000
RATE_LIMIT_MAX_REQUESTS=3
```

**More lenient limits (10 requests per 30 seconds):**
```bash
RATE_LIMIT_WINDOW_MS=30000
RATE_LIMIT_MAX_REQUESTS=10
```

**Disable rate limiting:**
```bash
RATE_LIMIT_ENABLED=false
```

## WhatsApp Integration

The bot includes comprehensive WhatsApp integration for forwarding messages from WhatsApp chats to Discord channels, powered by the Baileys library for reliable, browser-free operation.

### Features

- **Message Forwarding**: Forward text and media messages from WhatsApp to Discord
- **Group Chat Support**: Monitor both individual and group WhatsApp conversations
- **Session Management**: Persistent session storage with automatic restoration
- **QR Code Authentication**: Automatic QR code generation for WhatsApp Web authentication
- **Media Handling**: Support for images, documents, and other media files
- **Multi-tenant Ready**: Support for multiple Discord servers with proper isolation
- **Lightweight**: No browser dependencies - uses pure Node.js WebSocket connections via Baileys

### Setup

1. **Enable WhatsApp Integration**:
   ```bash
   WHATSAPP_ENABLED=true
   ```

2. **Configure WhatsApp Tables (PostgreSQL)**:
   - Create entries in the `whatsapp_chats` table for chats you want to monitor

3. **Add Chat Configuration**:
   - Add entries to the `whatsapp_chats` table for monitored chats
   - Use correct WhatsApp chat ID format (see below)

### Chat ID Formats

- **Group Chats**: `{group-id}@g.us` (e.g., `120363404190647543@g.us`)
- **Individual Chats**: `{phone-number}@c.us` (e.g., `12147991121@c.us`)

### Docker Volume Mapping

For WhatsApp session persistence in Docker, map the session directories:

```bash
docker run -d \
  --name frijolebot \
  --env-file .env \
  -v frijolebot-whatsapp-sessions:/app/.wwebjs_auth \
  -v frijolebot-whatsapp-cache:/app/.wwebjs_cache \
  frijolebot
```

Or in `docker-compose.yml`:

```yaml
services:
  frijolebot:
    volumes:
      - whatsapp-sessions:/app/.wwebjs_auth
      - whatsapp-cache:/app/.wwebjs_cache

volumes:
  whatsapp-sessions:
  whatsapp-cache:
```

### Authentication Flow

1. **First Time Setup**:
   - Start the bot with WhatsApp enabled
   - Check Discord admin channel for QR code
   - Scan QR code with WhatsApp mobile app
   - Session is automatically saved

2. **Session Restoration**:
   - Bot automatically restores existing sessions
   - If restoration fails, new QR code is generated

### Message Formatting

Messages are formatted as:
- **Text**: `**Sender Name** *(timestamp)*\nMessage content`
- **Media**: `**Sender Name** *(timestamp)*\n📎 Media type file`

### Troubleshooting WhatsApp

- **QR Code Not Appearing**: Check `DISCORD_ADMIN_CHANNEL` configuration
- **Messages Not Forwarding**: Verify chat is in `whatsapp_chats` table with `is_active=true`
- **Session Issues**: Clear local session files and restart bot
- **Media Not Working**: Check Docker volume permissions and Chromium installation

For detailed WhatsApp integration documentation, see [WHATSAPP_INTEGRATION.md](WHATSAPP_INTEGRATION.md).

## Troubleshooting

- **Bot not responding**: Check bot token and permissions
- **Channel not monitored**: Verify channel ID in environment variables
- **Database errors**: Check PostgreSQL connectivity
- **Missing messages**: Ensure bot has MESSAGE_CONTENT intent enabled
- **Health check failures**: Check Discord API connectivity and PostgreSQL access
- **Kubernetes probe failures**: Verify health check port is accessible and endpoints respond correctly
- **WhatsApp QR code not appearing**: Check `DISCORD_ADMIN_CHANNEL` configuration and bot permissions
- **WhatsApp messages not forwarding**: Verify chat configuration in PostgreSQL `whatsapp_chats` table
