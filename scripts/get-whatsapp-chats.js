const { Client, LocalAuth } = require('whatsapp-web.js');
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

async function getWhatsAppChats() {
    console.log('🔍 Getting WhatsApp chat information...');
    
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'frijolebot'
        })
    });

    client.on('qr', (qr) => {
        console.log('📱 QR Code generated. Please scan with your phone to authenticate.');
        console.log('QR Code:', qr);
    });

    client.on('ready', async () => {
        console.log('✅ WhatsApp client is ready!');
        
        try {
            // Get all chats
            const chats = await client.getChats();
            console.log(`\n📋 Found ${chats.length} WhatsApp chats:`);
            
            chats.forEach((chat, index) => {
                console.log(`\n${index + 1}. Chat ID: ${chat.id._serialized}`);
                console.log(`   Name: ${chat.name || 'No name'}`);
                console.log(`   Type: ${chat.isGroup ? 'Group' : 'Individual'}`);
                console.log(`   Participants: ${chat.participants ? chat.participants.length : 'N/A'}`);
            });
            
            // Update the Baserow record with the first chat (or you can choose which one)
            if (chats.length > 0) {
                const firstChat = chats[0];
                console.log(`\n🔄 Updating Baserow record with chat: ${firstChat.name || firstChat.id._serialized}`);
                
                // Get the current record from Baserow
                const getResponse = await axios.get(`${apiUrl}?user_field_names=true&filters={"filter_type":"AND","filters":[{"field":"chat_id","type":"text","value":"test-chat-id"}]}`, { headers });
                
                if (getResponse.data.results.length > 0) {
                    const record = getResponse.data.results[0];
                    const recordId = record.id;
                    
                    // Update the record with real chat information
                    const updateData = {
                        chat_id: firstChat.id._serialized,
                        chat_name: firstChat.name || `Chat ${firstChat.id._serialized}`,
                        description: `Real WhatsApp chat - ${firstChat.isGroup ? 'Group' : 'Individual'} chat`
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
        
        await client.destroy();
        process.exit(0);
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ Authentication failed:', msg);
        process.exit(1);
    });

    client.initialize();
}

getWhatsAppChats();
