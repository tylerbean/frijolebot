# Discord Link Bot

[![Docker Build](https://github.com/tylerbean/frijolebot/actions/workflows/docker-build.yml/badge.svg)](https://github.com/tylerbean/frijolebot/actions/workflows/docker-build.yml)
[![Tests](https://github.com/tylerbean/frijolebot/actions/workflows/test.yml/badge.svg)](https://github.com/tylerbean/frijolebot/actions/workflows/test.yml)
[![Security Scan](https://github.com/tylerbean/frijolebot/actions/workflows/security.yml/badge.svg)](https://github.com/tylerbean/frijolebot/actions/workflows/security.yml)

A Discord bot that monitors specified channels for messages containing URLs and stores them in a Baserow database for link management and read status tracking.

## Features

- **Multi-channel monitoring**: Configure multiple channels to monitor within a single Discord server
- **URL detection**: Automatically detects HTTP/HTTPS URLs in messages
- **Database storage**: Stores detected links in Baserow database with metadata
- **DM link management**: Users can view and manage unread links via DM interactions
- **Reaction-based interface**: Toggle read/unread status using Discord reactions
- **Multi-server support**: Works across multiple Discord servers with proper access control
- **Rate limiting**: Built-in rate limiting for slash commands to prevent abuse
- **Health monitoring**: Built-in health check endpoints for Kubernetes deployments
- **Configurable**: Easy setup via environment variables
- **Error handling**: Robust error handling and logging

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

### 3. Configure Environment Variables

Create a `.env` file with the following variables:

```bash
# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_guild_id_here
DISCORD_CHANNELS_TO_MONITOR=channel_id_1,channel_id_2,channel_id_3

# Baserow API Configuration
BASEROW_API_TOKEN=your_baserow_api_token_here
BASEROW_API_URL=https://your-baserow-instance.com/api/database/table/123/

# Health Check Configuration
HEALTH_CHECK_PORT=3000

# Rate Limiting Configuration
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=5
RATE_LIMIT_CLEANUP_INTERVAL=300000

# Application Configuration
NODE_ENV=production
```

### 4. Add Bot to Server

1. In Discord Developer Portal, go to OAuth2 > URL Generator
2. Select scopes: `bot`
3. Select permissions: `Read Messages`, `Send Messages`, `Create Public Threads`, `Add Reactions`, `Manage Messages`
4. Use generated URL to add bot to your server

### 5. Run the Bot

```bash
# Production
npm start

# Development (with auto-restart)
npm run dev

# Docker
docker-compose up -d

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

## Docker Deployment

The bot includes Docker support for easy deployment:

### Docker Compose (Recommended)

```bash
# Start the bot
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the bot
docker-compose down
```

### Docker Features

- **Health Checks**: Built-in health check endpoints at `/health/live` and `/health/ready`
- **Rate Limiting**: Configurable rate limiting for slash commands
- **Security**: Runs as non-root user
- **Monitoring**: Exposes port 3000 for health check monitoring
- **Logging**: Logs directory mounted for persistence

### Docker Environment Variables

All environment variables from the `.env` file are automatically loaded. You can also override them in `docker-compose.yml`:

```yaml
environment:
  - RATE_LIMIT_MAX_REQUESTS=10
  - HEALTH_CHECK_PORT=3000
```

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

The bot stores the following data in Baserow for each detected URL:

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

## Health Monitoring

The bot includes built-in health check endpoints for monitoring and Kubernetes deployments:

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
    "baserow": {
      "connected": true,
      "status": "connected",
      "response_time": 150,
      "api_url": "https://your-baserow.com/api/database/table/123/"
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

## Troubleshooting

- **Bot not responding**: Check bot token and permissions
- **Channel not monitored**: Verify channel ID in environment variables
- **Database errors**: Check Baserow API token and URL configuration
- **Missing messages**: Ensure bot has MESSAGE_CONTENT intent enabled
- **Health check failures**: Check Discord API connectivity and Baserow API access
- **Kubernetes probe failures**: Verify health check port is accessible and endpoints respond correctly
