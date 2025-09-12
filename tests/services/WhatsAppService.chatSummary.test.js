const WhatsAppService = require('../../services/WhatsAppService');

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

function createMockDiscord(adminChannelId = 'admin123', channelMap = {}) {
  const send = jest.fn();
  return {
    isReady: () => true,
    channels: {
      cache: {
        get: (id) => {
          if (id === adminChannelId) {
            return { send };
          }
          const ch = channelMap[id];
          return ch ? { name: ch } : undefined;
        },
      },
    },
    __send: send,
  };
}

describe('WhatsAppService chat summary and display name', () => {
  test('getChatDisplayName returns DB name and falls back to ID', async () => {
    const postgresService = {
      getChatById: jest.fn()
        .mockResolvedValueOnce({ chat_name: 'Nice Chat' })
        .mockResolvedValueOnce(null),
    };

    const svc = new WhatsAppService({ discord: {}, whatsapp: {} }, null, postgresService);

    await expect(svc.getChatDisplayName('123@g.us')).resolves.toBe('Nice Chat');
    await expect(svc.getChatDisplayName('456@g.us')).resolves.toBe('456@g.us');
  });

  test('sendChatMonitoringSummary builds and sends summary with channel names', async () => {
    const adminChannelId = 'admin123';
    const discord = createMockDiscord(adminChannelId, {
      'chan-1': 'general',
      'chan-2': 'random',
    });

    const svc = new WhatsAppService({ discord: { adminChannelId }, whatsapp: {} }, discord, null);

    const activeChats = [
      { chat_id: '111@g.us', chat_name: 'Alpha', discord_channel_id: 'chan-1' },
      { chat_id: '222@g.us', chat_name: 'Beta', discord_channel_id: 'chan-2' },
    ];

    await svc.sendChatMonitoringSummary(activeChats);

    expect(discord.__send).toHaveBeenCalledTimes(1);
    const [message] = discord.__send.mock.calls[0];
    expect(message).toContain('WhatsApp Chat Monitoring Summary');
    expect(message).toContain('Monitoring **2** WhatsApp chat(s):');
    expect(message).toContain('• **Alpha**');
    expect(message).toContain('`111@g.us`');
    expect(message).toContain('#general');
    expect(message).toContain('• **Beta**');
    expect(message).toContain('`222@g.us`');
    expect(message).toContain('#random');
  });

  test('sendChatMonitoringSummary no chats path', async () => {
    const adminChannelId = 'admin123';
    const discord = createMockDiscord(adminChannelId, {});

    const svc = new WhatsAppService({ discord: { adminChannelId }, whatsapp: {} }, discord, null);
    await svc.sendChatMonitoringSummary([]);

    expect(discord.__send).toHaveBeenCalledTimes(1);
    const [message] = discord.__send.mock.calls[0];
    expect(message).toContain('No WhatsApp chats are currently being monitored.');
  });

  test('sendChatMonitoringSummary bails if no admin channel configured', async () => {
    const discord = createMockDiscord('admin123', {});
    const svc = new WhatsAppService({ discord: { adminChannelId: undefined }, whatsapp: { sessionEncryptionKey: 'test-key-32-characters________' } }, discord, null);

    await svc.sendChatMonitoringSummary([{ chat_id: '1', chat_name: 'A', discord_channel_id: 'x' }]);

    expect(discord.__send).not.toHaveBeenCalled();
  });
});
