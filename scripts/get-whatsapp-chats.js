const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const axios = require('axios');
require('dotenv').config();

const BASEROW_API_TOKEN = process.env.BASEROW_API_TOKEN;
const BASEROW_API_URL = process.env.BASEROW_API_URL;
const WHATSAPP_CHATS_TABLE_ID = process.env.BASEROW_WHATSAPP_CHATS_TABLE_ID;

if (!BASEROW_API_TOKEN || !BASEROW_API_URL || !WHATSAPP_CHATS_TABLE_ID) {
    console.error('Missing required Baserow environment variables.');
    process.exit(1);
}

const apiUrl = `${BASEROW_API_URL}${WHATSAPP_CHATS_TABLE_ID}/`;
const headers = {
    'Authorization': `Token ${BASEROW_API_TOKEN}`,
    'Content-Type': 'application/json'
};

// DEPRECATED: Informational helper; not used by production app. Use Admin UI for visibility.
async function getWhatsAppChats() {
    console.log('🔍 Getting WhatsApp chat information...');
    
    try {
        // Initialize Baileys auth state
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
        
        // Create WhatsApp socket with Baileys
        const sock = makeWASocket({
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
        sock.ev.on('creds.update', saveCreds);

        // Connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('📱 QR Code generated. Please scan with your phone to authenticate.');
                console.log('QR Code:', qr);
            }
            
            if (connection === 'open') {
                console.log('✅ WhatsApp client is ready!');
                
                try {
                    // Get all chats from Baileys
                    const chats = await sock.store.chats.all();
                    console.log(`\n📋 Found ${chats.length} WhatsApp chats:`);
                    
                    chats.forEach((chat, index) => {
                        console.log(`\n${index + 1}. Chat ID: ${chat.id}`);
                        console.log(`   Name: ${chat.name || 'No name'}`);
                        console.log(`   Type: ${chat.id.endsWith('@g.us') ? 'Group' : 'Individual'}`);
                        console.log(`   Participants: ${chat.id.endsWith('@g.us') ? (chat.participants?.length || 0) : 'N/A'}`);
                    });
                    
                    // Update the Baserow record with the first chat (or you can choose which one)
                    if (chats.length > 0) {
                        const firstChat = chats[0];
                        console.log(`\n🔄 Updating Baserow record with chat: ${firstChat.name || firstChat.id}`);
                        
                        // Get the current record from Baserow
                        const getResponse = await axios.get(`${apiUrl}?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"chat_id","type":"text","value":"test-chat-id"}]}`, { headers });
                        
                        if (getResponse.data.results.length > 0) {
                            const record = getResponse.data.results[0];
                            const recordId = record.id;
                            
                            // Update the record with real chat information
                            const updateData = {
                                chat_id: firstChat.id,
                                chat_name: firstChat.name || `Chat ${firstChat.id}`,
                                description: `Real WhatsApp chat - ${firstChat.id.endsWith('@g.us') ? 'Group' : 'Individual'} chat`
                            };
                            
                            const updateResponse = await axios.patch(`${apiUrl}${recordId}/?user_field_names=true`, updateData, { headers });
                            console.log('✅ Baserow record updated successfully!');
                            console.log('Updated data:', updateResponse.data);
                        } else {
                            console.log('❌ No record found with chat_id "test-chat-id"');
                        }
                    }
                    
                } catch (error) {
                    console.error('❌ Error getting chats:', error.message);
                }
                
                await sock.logout();
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

getWhatsAppChats();
