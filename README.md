# Discord Link Bot

A Discord bot that monitors specified channels for messages containing URLs and forwards them to an n8n webhook for processing.

## Features

- **Multi-channel monitoring**: Configure multiple channels to monitor within a single Discord server
- **URL detection**: Automatically detects HTTP/HTTPS URLs in messages
- **n8n integration**: Sends detected links to n8n webhook for further processing
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

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:
- `DISCORD_BOT_TOKEN`: Your bot token from Discord Developer Portal
- `DISCORD_GUILD_ID`: Your Discord server ID (Frijoleville: 611026701299875853)
- `DISCORD_CHANNEL_*`: Channel IDs to monitor (uncomment and add more as needed)
- `N8N_WEBHOOK_URL`: Your n8n webhook endpoint

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

## Payload Structure

The bot sends this payload to the n8n webhook:

```json
{
  "content": "message content with https://example.com",
  "channel_id": "1409952645346758676",
  "channel_name": "shares-food",
  "guild_id": "611026701299875853",
  "author": {
    "username": "username",
    "id": "user_id",
    "displayName": "Display Name"
  },
  "id": "message_id",
  "timestamp": "2025-09-03T20:45:00.000Z",
  "urls": ["https://example.com"]
}
```

## Troubleshooting

- **Bot not responding**: Check bot token and permissions
- **Channel not monitored**: Verify channel ID in environment variables
- **n8n not receiving**: Check webhook URL and n8n workflow status
- **Missing messages**: Ensure bot has MESSAGE_CONTENT intent enabled
