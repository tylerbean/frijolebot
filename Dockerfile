# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Install system dependencies (minimal for Baileys)
RUN apk add --no-cache \
    ca-certificates

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (production only for smaller image)
RUN npm ci --only=production && npm cache clean --force

# Copy application code (excluding test files and dev dependencies)
COPY config/ ./config/
COPY services/ ./services/
COPY handlers/ ./handlers/
COPY utils/ ./utils/
COPY discord-link-bot.js ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

# Create directories for WhatsApp session persistence
RUN mkdir -p /app/auth_info_baileys

# Change ownership of app directory and WhatsApp directories
RUN chown -R botuser:nodejs /app
USER botuser

# Expose health check port
EXPOSE 3000

# Health check using the built-in health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/live || exit 1

# Start the bot
CMD ["npm", "start"]
