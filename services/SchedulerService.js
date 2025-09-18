const Logger = require('../utils/logger');

class SchedulerService {
    constructor(postgresService) {
        this.postgresService = postgresService;
        this.scheduledTasks = new Map();
        this.isInitialized = false;

        Logger.info('SchedulerService initialized');
    }

    /**
     * Initialize the scheduler and start daily tasks
     */
    async initialize() {
        if (this.isInitialized) {
            Logger.warning('SchedulerService already initialized');
            return;
        }

        Logger.info('Starting daily scheduled tasks...');

        // Schedule daily cleanup at midnight (00:00)
        this.scheduleDailyTask('whatsapp-cleanup', this.runWhatsAppCleanup.bind(this));

        // Run cleanup once on startup if there are existing records
        setTimeout(() => {
            this.runWhatsAppCleanup();
        }, 5000); // Wait 5 seconds after startup

        this.isInitialized = true;
        Logger.info('SchedulerService initialization complete');
    }

    /**
     * Schedule a task to run daily at midnight
     * @param {string} taskName - Name of the task for logging
     * @param {Function} taskFunction - Function to execute
     */
    scheduleDailyTask(taskName, taskFunction) {
        // Calculate milliseconds until next midnight
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const msUntilMidnight = tomorrow.getTime() - now.getTime();

        Logger.info(`Scheduling daily task '${taskName}' - next run in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);

        // Set initial timeout until midnight
        const initialTimeout = setTimeout(() => {
            this.executeTask(taskName, taskFunction);

            // Then schedule it to repeat every 24 hours
            const dailyInterval = setInterval(() => {
                this.executeTask(taskName, taskFunction);
            }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds

            this.scheduledTasks.set(taskName, { type: 'interval', id: dailyInterval });
        }, msUntilMidnight);

        this.scheduledTasks.set(taskName, { type: 'timeout', id: initialTimeout });
    }

    /**
     * Execute a scheduled task with error handling and logging
     * @param {string} taskName - Name of the task
     * @param {Function} taskFunction - Function to execute
     */
    async executeTask(taskName, taskFunction) {
        try {
            Logger.info(`Executing scheduled task: ${taskName}`);
            const startTime = Date.now();

            const result = await taskFunction();

            const duration = Date.now() - startTime;
            Logger.info(`Scheduled task '${taskName}' completed in ${duration}ms`, result ? { result } : {});
        } catch (error) {
            Logger.error(`Scheduled task '${taskName}' failed:`, error);
        }
    }

    /**
     * Clean up old WhatsApp message records
     */
    async runWhatsAppCleanup() {
        try {
            const deletedCount = await this.postgresService.cleanupOldWhatsAppMessages(90);
            return {
                task: 'whatsapp-cleanup',
                deletedRecords: deletedCount,
                retentionDays: 90
            };
        } catch (error) {
            Logger.error('Failed to run WhatsApp cleanup:', error);
            throw error;
        }
    }

    /**
     * Stop all scheduled tasks
     */
    cleanup() {
        Logger.info('Stopping all scheduled tasks...');

        for (const [taskName, task] of this.scheduledTasks.entries()) {
            if (task.type === 'timeout') {
                clearTimeout(task.id);
            } else if (task.type === 'interval') {
                clearInterval(task.id);
            }
            Logger.info(`Stopped scheduled task: ${taskName}`);
        }

        this.scheduledTasks.clear();
        this.isInitialized = false;
        Logger.info('All scheduled tasks stopped');
    }

    /**
     * Get status of all scheduled tasks
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            taskCount: this.scheduledTasks.size,
            tasks: Array.from(this.scheduledTasks.keys())
        };
    }
}

module.exports = SchedulerService;