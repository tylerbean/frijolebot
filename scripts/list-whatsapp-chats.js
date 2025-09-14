const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// DEPRECATED: Use Admin UI and health endpoints for current chat visibility.
class WhatsAppChatLister {
  constructor() {
    this.sock = null;
  }

  async initialize() {
    console.log('🚀 Initializing WhatsApp client to list chats...');
    
    try {
      // Initialize Baileys auth state
      const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
      
      // Create WhatsApp socket with Baileys
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: {
          level: 'silent',
          child: () => ({ 
            level: 'silent',
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            fatal: () => {}
          }),
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          fatal: () => {}
        }
      });

      // Handle credential updates
      this.sock.ev.on('creds.update', saveCreds);

      // Connection updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          console.log('📱 QR Code generated - scan with your phone to authenticate');
          
          try {
            const qrBuffer = await QRCode.toBuffer(qr, { type: 'png', width: 512, margin: 2 });
            const qrPath = path.join(process.cwd(), 'whatsapp-qr.png');
            fs.writeFileSync(qrPath, qrBuffer);
            console.log(`💾 QR code saved to: ${qrPath}`);
          } catch (error) {
            console.error('❌ Failed to save QR code:', error);
          }
        }
        
        if (connection === 'open') {
          console.log('✅ WhatsApp client is ready!');
          await this.listChats();
          await this.sock.logout();
          process.exit(0);
        } else if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            console.log('🔄 Attempting to reconnect...');
          } else {
            console.log('🔌 WhatsApp client disconnected');
            process.exit(1);
          }
        }
      });

    } catch (error) {
      console.error('❌ Failed to initialize WhatsApp client:', error);
      process.exit(1);
    }
  }

  async listChats() {
    try {
      console.log('\n📋 Listing all available WhatsApp chats:\n');
      
      // Get all chats from Baileys
      const chats = await this.sock.store.chats.all();
      
      console.log(`Found ${chats.length} chats:\n`);
      
      chats.forEach((chat, index) => {
        const chatInfo = {
          index: index + 1,
          id: chat.id,
          name: chat.name || 'Unknown',
          type: chat.id.endsWith('@g.us') ? 'Group' : 'Individual',
          participants: chat.id.endsWith('@g.us') ? (chat.participants?.length || 0) : 'N/A'
        };
        
        console.log(`${chatInfo.index}. ${chatInfo.name}`);
        console.log(`   ID: ${chatInfo.id}`);
        console.log(`   Type: ${chatInfo.type}`);
        if (chatInfo.type === 'Group') {
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
