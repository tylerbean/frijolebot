const isDevelopment = process.env.NODE_ENV === 'development';

class Logger {
    static info(message, ...args) {
        if (isDevelopment) {
            console.log(`ℹ️  ${message}`, ...args);
        }
    }

    static success(message, ...args) {
        if (isDevelopment) {
            console.log(`✅ ${message}`, ...args);
        }
    }

    static warning(message, ...args) {
        if (isDevelopment) {
            console.log(`⚠️  ${message}`, ...args);
        }
    }

    static error(message, ...args) {
        // Always log errors, even in production
        console.error(`❌ ${message}`, ...args);
    }

    static debug(message, ...args) {
        if (isDevelopment) {
            console.log(`🔍 ${message}`, ...args);
        }
    }

    static startup(message, ...args) {
        // Always log startup messages
        console.log(`🚀 ${message}`, ...args);
    }
}

module.exports = Logger;
