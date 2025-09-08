const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

class WhatsAppChatLister {
  constructor() {
    this.client = null;
  }

  async initialize() {
    console.log('🚀 Initializing WhatsApp client to list chats...');
    
    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'frijolebot-whatsapp'
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    this.client.on('qr', async (qr) => {
      console.log('📱 QR Code generated - scan with your phone to authenticate');
      
      try {
        const qrBuffer = await QRCode.toBuffer(qr, { type: 'png', width: 512, margin: 2 });
        const qrPath = path.join(process.cwd(), 'whatsapp-qr.png');
        fs.writeFileSync(qrPath, qrBuffer);
        console.log(`💾 QR code saved to: ${qrPath}`);
      } catch (error) {
        console.error('❌ Failed to save QR code:', error);
      }
    });

    this.client.on('ready', async () => {
      console.log('✅ WhatsApp client is ready!');
      await this.listChats();
      await this.client.destroy();
      process.exit(0);
    });

    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp authentication successful');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp authentication failed:', msg);
      process.exit(1);
    });

    this.client.on('disconnected', (reason) => {
      console.log('🔌 WhatsApp client disconnected:', reason);
    });

    try {
      await this.client.initialize();
    } catch (error) {
      console.error('❌ Failed to initialize WhatsApp client:', error);
      process.exit(1);
    }
  }

  async listChats() {
    try {
      console.log('\n📋 Listing all available WhatsApp chats:\n');
      
      const chats = await this.client.getChats();
      
      console.log(`Found ${chats.length} chats:\n`);
      
      chats.forEach((chat, index) => {
        const chatInfo = {
          index: index + 1,
          id: chat.id._serialized,
          name: chat.name || 'Unknown',
          type: chat.isGroup ? 'Group' : 'Individual',
          participants: chat.isGroup ? chat.participants.length : 'N/A'
        };
        
        console.log(`${chatInfo.index}. ${chatInfo.name}`);
        console.log(`   ID: ${chatInfo.id}`);
        console.log(`   Type: ${chatInfo.type}`);
        if (chat.isGroup) {
          console.log(`   Participants: ${chatInfo.participants}`);
        }
        console.log('');
      });
      
      console.log('💡 To add a chat to monitoring, use the chat ID (e.g., "12147991121@c.us" or "JVMAHcNfKDiJbUsYE1w7sP@g.us")');
      console.log('💡 Update your Baserow whatsapp_chats table with the correct chat_id values');
      
    } catch (error) {
      console.error('❌ Failed to list chats:', error);
    }
  }
}

// Run the chat lister
const lister = new WhatsAppChatLister();
lister.initialize().catch(console.error);
