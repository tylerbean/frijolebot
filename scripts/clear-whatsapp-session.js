const fs = require('fs');
const path = require('path');

async function clearWhatsAppSession() {
    console.log('🧹 Clearing WhatsApp session...');
    
    try {
        // Clear local session files
        const sessionPath = path.join(process.cwd(), '.wwebjs_auth', 'session-frijolebot-whatsapp');
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('✅ Local session files cleared');
        } else {
            console.log('ℹ️  No local session files found');
        }
        
        // Clear any other session-related files
        const authDir = path.join(process.cwd(), '.wwebjs_auth');
        if (fs.existsSync(authDir)) {
            const files = fs.readdirSync(authDir);
            files.forEach(file => {
                if (file.includes('frijolebot')) {
                    const filePath = path.join(authDir, file);
                    fs.rmSync(filePath, { recursive: true, force: true });
                    console.log(`✅ Cleared: ${file}`);
                }
            });
        }
        
        console.log('🎉 WhatsApp session cleared successfully!');
        console.log('📝 Next time you start the bot, it will require fresh authentication.');
        
    } catch (error) {
        console.error('❌ Error clearing session:', error.message);
    }
}

clearWhatsAppSession();
