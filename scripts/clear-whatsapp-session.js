const fs = require('fs');
const path = require('path');

async function clearWhatsAppSession() {
    console.log('🧹 Clearing WhatsApp session...');
    
    try {
        // Clear Baileys session files
        const sessionPath = path.join(process.cwd(), 'auth_info_baileys');
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('✅ Baileys session files cleared');
        } else {
            console.log('ℹ️  No Baileys session files found');
        }
        
        // Also clear any old whatsapp-web.js session files if they exist
        const oldSessionPath = path.join(process.cwd(), '.wwebjs_auth');
        if (fs.existsSync(oldSessionPath)) {
            fs.rmSync(oldSessionPath, { recursive: true, force: true });
            console.log('✅ Old whatsapp-web.js session files cleared');
        }
        
        console.log('🎉 WhatsApp session cleared successfully!');
        console.log('📝 Next time you start the bot, it will require fresh authentication.');
        
    } catch (error) {
        console.error('❌ Error clearing session:', error.message);
    }
}

clearWhatsAppSession();
