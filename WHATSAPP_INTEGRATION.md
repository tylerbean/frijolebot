# WhatsApp Integration

This document describes the WhatsApp integration feature for the FrijoleBot Discord bot.

## Overview

The WhatsApp integration allows the bot to:
- Connect to a personal WhatsApp account using WhatsApp Web API
- Monitor specific WhatsApp chats (groups and individual conversations)
- Forward messages from WhatsApp to designated Discord channels
- Handle both text and media messages (images, documents, etc.)
- Store WhatsApp message history in PostgreSQL (sessions stored locally only)
- Send QR codes for authentication to Discord admin channels

## Features

### Message Forwarding
- **Text Messages**: Forwarded with sender name, timestamp, and message content
- **Media Messages**: Images, documents, and other media files are downloaded and forwarded to Discord
- **Group Chat Support**: Properly handles group messages by using the group ID instead of individual sender IDs
- **Message Filtering**: Ignores system notifications (`notification_template` messages)

### Session Management
- **Local Session Storage**: Uses WhatsApp Web's local authentication files
- **Local Only**: Session data is not stored in the database; Baileys multi-file auth is persisted on disk
- **Session Restoration**: Automatically restores sessions when available
- **QR Code Generation**: Sends QR codes to Discord admin channel when authentication is needed
- **Session Validation**: Validates sessions and handles expired/invalid sessions

### Configuration
- **Environment Variables**: All configuration via environment variables
- **Multi-tenant Support**: Uses `discord_guild_id` for multi-tenant deployments
- **Chat Monitoring**: Configurable list of monitored WhatsApp chats via Baserow
- **Message Storage**: Optional storage of WhatsApp messages in Baserow

## Architecture

### Components

1. **WhatsAppService**: Main service class that manages the WhatsApp client
2. **WhatsAppSessionManager**: Handles session creation, restoration, and management
3. **WhatsAppMessageHandler**: Processes incoming WhatsApp messages and forwards to Discord
4. **BaserowService**: Extended with WhatsApp-specific methods for data persistence

### Data Flow

```
WhatsApp Message → WhatsAppService → MessageHandler → Discord Channel
                                      ↓
                                 Baserow (optional storage)
```

## Configuration

### Environment Variables

#### Required (when WhatsApp is enabled)
- `WHATSAPP_ENABLED`: Set to `true` to enable WhatsApp integration
- `BASEROW_WHATSAPP_SESSIONS_TABLE_ID`: Baserow table ID for session storage
- `BASEROW_WHATSAPP_CHATS_TABLE_ID`: Baserow table ID for chat configuration
- `BASEROW_WHATSAPP_MESSAGES_TABLE_ID`: Baserow table ID for message storage

#### Optional
- `WHATSAPP_STORE_MESSAGES`: Set to `true` to store WhatsApp messages in Baserow
- `DISCORD_ADMIN_CHANNEL`: Discord channel ID for QR codes and admin notifications

### Baserow Tables

#### WhatsApp Sessions Table
- `session_id`: Unique session identifier
- `session_data`: Encrypted session data (JSON string)
- `status`: Session status (active, expired, failed)
- `last_used`: Last usage timestamp
- `device_info`: Device information
- `notes`: Additional notes

#### WhatsApp Chats Table
- `chat_id`: WhatsApp chat ID (e.g., `120363404190647543@g.us` for groups, `12147991121@c.us` for individuals)
- `chat_name`: Human-readable chat name
- `discord_channel_id`: Discord channel ID for message forwarding
- `discord_guild_id`: Discord guild ID for multi-tenant support
- `is_active`: Whether the chat is actively monitored

#### WhatsApp Messages Table
- `whatsapp_message_id`: WhatsApp message ID
- `chat_id`: WhatsApp chat ID
- `sender_id`: WhatsApp sender ID
- `message_type`: Message type (chat, image, document, etc.)
- `message_content`: Message content (text or description)
- `has_media`: Whether the message contains media
- `media_type`: Media type (if applicable)
- `timestamp`: Message timestamp
- `discord_message_id`: Discord message ID (if forwarded)
- `discord_guild_id`: Discord guild ID
- `created_at`: Record creation timestamp

## Usage

### Initial Setup

1. **Enable WhatsApp Integration**:
   ```bash
   export WHATSAPP_ENABLED=true
   ```

2. **Configure Baserow Tables**:
   - Create the required tables in Baserow
   - Set the table IDs in environment variables

3. **Add Chat Configuration**:
   - Add entries to the `whatsapp_chats` table for chats you want to monitor
   - Use the correct WhatsApp chat ID format (see below)

### Chat ID Formats

- **Group Chats**: `{group-id}@g.us` (e.g., `120363404190647543@g.us`)
- **Individual Chats**: `{phone-number}@c.us` (e.g., `12147991121@c.us`)

### Authentication

1. **First Time Setup**:
   - Start the bot with WhatsApp enabled
   - Check the Discord admin channel for a QR code
   - Scan the QR code with your WhatsApp mobile app
   - The bot will automatically save the session

2. **Session Restoration**:
   - The bot automatically restores existing sessions
   - If session restoration fails, a new QR code will be generated

### Monitoring Chats

1. **Add Chat to Monitoring**:
   ```sql
   INSERT INTO whatsapp_chats (chat_id, chat_name, discord_channel_id, discord_guild_id, is_active)
   VALUES ('120363404190647543@g.us', 'My Group Chat', '1414626511868264578', '611026701299875853', true);
   ```

2. **Message Formatting**:
   - Messages are formatted as: `**Sender Name** *(timestamp)*\nMessage content`
   - Media messages include: `**Sender Name** *(timestamp)*\n📎 Media type file`

## Troubleshooting

### Common Issues

1. **QR Code Not Appearing**:
   - Check that `DISCORD_ADMIN_CHANNEL` is set correctly
   - Verify the bot has permission to send messages to the admin channel

2. **Messages Not Forwarding**:
   - Verify the chat is added to the `whatsapp_chats` table
   - Check that `is_active` is set to `true`
   - Ensure the Discord channel ID is correct

3. **Session Issues**:
   - Clear local session files: `rm -rf auth_info_baileys/`
   - Restart the bot to generate a new QR code

### Debug Logging

The bot provides extensive debug logging for WhatsApp operations:
- Session restoration attempts
- Message processing
- Discord forwarding
- Baserow operations

## Security Considerations

1. **Session Data**: Session data is stored locally via Baileys multi-file auth
2. **QR Codes**: QR codes are sent only to designated admin channels
3. **Message Content**: Message content is stored in Baserow (if enabled) - consider data retention policies
4. **Access Control**: Only configured chats are monitored and forwarded

## Development

### Testing

Run the test suite:
```bash
npm test
```

WhatsApp-specific tests:
- Unit tests for WhatsAppService
- Integration tests for message flow
- Configuration validation tests

### Adding New Features

1. **New Message Types**: Extend `WhatsAppMessageHandler.processMessage()`
2. **New Session Features**: Modify `WhatsAppSessionManager`
3. **New Baserow Operations**: Add methods to `BaserowService`

## API Reference

### WhatsAppService

Main service class for WhatsApp integration.

```javascript
const whatsappService = new WhatsAppService(config, discordClient);
await whatsappService.initialize();
```

### Methods

- `initialize()`: Initialize the WhatsApp service
- `destroy()`: Clean up resources
- `getConnectionStatus()`: Get current connection status

### Events

- `qr`: QR code generated for authentication
- `ready`: WhatsApp client is ready
- `authenticated`: Authentication successful
- `auth_failure`: Authentication failed
- `disconnected`: Client disconnected
- `message`: New message received
- `message_create`: Message sent by the bot itself

## License

This integration is part of the FrijoleBot project and follows the same license terms.
