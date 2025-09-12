const logLevel = (process.env.LOG_LEVEL || '').toLowerCase();
const debugLogs = String(process.env.DEBUG_LOGS || '').toLowerCase();
const isVerboseLogging = logLevel === 'debug' || debugLogs === 'true' || process.env.NODE_ENV === 'development';

class Logger {
    static getTimestamp() {
        return new Date().toISOString();
    }

    static formatMessage(emoji, message, ...args) {
        const timestamp = this.getTimestamp();
        return [`${emoji} [${timestamp}] ${message}`, ...args];
    }

    static info(message, ...args) {
        if (isVerboseLogging) {
            console.log(...this.formatMessage('ℹ️ ', message, ...args));
        }
    }

    static success(message, ...args) {
        if (isVerboseLogging) {
            console.log(...this.formatMessage('✅', message, ...args));
        }
    }

    static warning(message, ...args) {
        if (isVerboseLogging) {
            console.log(...this.formatMessage('⚠️ ', message, ...args));
        }
    }

    static error(message, ...args) {
        // Always log errors, even in production
        console.error(...this.formatMessage('❌', message, ...args));
    }

    static debug(message, ...args) {
        if (isVerboseLogging) {
            console.log(...this.formatMessage('🔍', message, ...args));
        }
    }

    static startup(message, ...args) {
        // Always log startup messages
        console.log(...this.formatMessage('🚀', message, ...args));
    }

    static shutdown(message, ...args) {
        // Always log shutdown messages
        console.log(...this.formatMessage('🛑', message, ...args));
    }
}

module.exports = Logger;
