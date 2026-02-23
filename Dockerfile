# Multi-stage build for Node.js TypeScript application
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache python3 make g++ ca-certificates

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --audit=false

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build || true

# Stage 2: Runtime
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files from builder
COPY --from=builder --chown=nodejs:nodejs /build/package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --audit=false && \
    npm cache clean --force

# Copy compiled application from builder
COPY --from=builder --chown=nodejs:nodejs /build/dist ./dist

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/gateway.js"]
