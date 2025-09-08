const axios = require('axios');
require('dotenv').config();

async function addWhatsAppChat() {
    const baserowApiUrl = `${process.env.BASEROW_API_URL}${process.env.BASEROW_WHATSAPP_CHATS_TABLE_ID}/`;
    const headers = {
        'Authorization': `Token ${process.env.BASEROW_API_TOKEN}`,
        'Content-Type': 'application/json'
    };

    // Chat configuration for testing
    const chatConfig = {
        chat_id: 'test-chat-id', // This will be updated when you get the real WhatsApp chat ID
        chat_name: 'Test WhatsApp Chat',
        discord_channel_id: '1414626511868264578',
        is_active: true,
        description: 'Test chat for WhatsApp integration development'
    };

    try {
        console.log('Adding WhatsApp chat configuration...');
        console.log('Configuration:', chatConfig);
        
        const response = await axios.post(`${baserowApiUrl}?user_field_names=true`, chatConfig, { headers });
        
        console.log('✅ WhatsApp chat configuration added successfully!');
        console.log('Response:', response.data);
        
        console.log('\n📝 Next steps:');
        console.log('1. Start the bot and scan the QR code');
        console.log('2. Get the real WhatsApp chat ID from the logs');
        console.log('3. Update the chat_id in Baserow with the real value');
        
    } catch (error) {
        console.error('❌ Error adding WhatsApp chat configuration:', error.response?.data || error.message);
    }
}

addWhatsAppChat();
