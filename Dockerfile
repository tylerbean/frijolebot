# Use Node.js 20 Alpine for Baileys compatibility
FROM node:20-alpine AS base

# Install system dependencies (minimal for Baileys)
RUN apk add --no-cache \
    ca-certificates

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
# Install all deps for building UI as well
RUN npm ci && npm cache clean --force

# Copy application code (excluding test files and dev dependencies)
COPY config/ ./config/
COPY services/ ./services/
COPY handlers/ ./handlers/
COPY utils/ ./utils/
COPY gateway/ ./gateway/
COPY discord-link-bot.js ./
COPY apps/control-panel ./apps/control-panel

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

# Create directories for WhatsApp session persistence
RUN mkdir -p /app/auth_info_baileys

# Change ownership of app directory and WhatsApp directories
RUN chown -R botuser:nodejs /app
USER botuser

# Build the UI if a valid package.json exists, otherwise skip (use prebuilt .next)
WORKDIR /app/apps/control-panel
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --no-audit --no-fund && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/config ./config
COPY --from=base /app/services ./services
COPY --from=base /app/handlers ./handlers
COPY --from=base /app/utils ./utils
COPY --from=base /app/gateway ./gateway
COPY --from=base /app/package*.json ./
COPY --from=base /app/discord-link-bot.js ./
# Copy entire control-panel directory to support dev fallback (includes app/, .next/, node_modules/, public)
# Copy minimal UI artifacts: node_modules and production build only
COPY --from=base /app/apps/control-panel/node_modules ./apps/control-panel/node_modules
COPY --from=base /app/apps/control-panel/.next ./apps/control-panel/.next
COPY --from=base /app/apps/control-panel/public ./apps/control-panel/public
COPY --from=base /app/apps/control-panel/package.json ./apps/control-panel/package.json

# Expose single port
EXPOSE 3000

# Health check via gateway → bot
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/live || exit 1

# Start via entrypoint to forward signals for graceful shutdown
ENV PORT=3000
ENV HEALTH_CHECK_PORT=3001
COPY scripts/start.sh /app/scripts/start.sh
RUN chmod +x /app/scripts/start.sh
CMD ["/app/scripts/start.sh"]
