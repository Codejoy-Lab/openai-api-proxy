# Stage 1: Build/Dependencies Stage
FROM oven/bun:canary-alpine AS builder
WORKDIR /app

# User 'bun' and group 'bun' are likely pre-created in the base image.
# We don't need to create them.

# Copy dependency definition files
COPY package.json bun.lock* ./

# Install dependencies using frozen lockfile
RUN bun install --frozen-lockfile

# Copy the rest of the application source code
COPY index.ts .
# COPY tsconfig.json . # If you have one

# Stage 2: Production Stage
FROM oven/bun:canary-alpine AS production

WORKDIR /app

# User 'bun' and group 'bun' are pre-created in the base image.

# Copy installed dependencies from the builder stage, ensuring ownership by 'bun'
# Docker needs the user/group to exist for --chown to work, which it does in the base image.
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
# Copy application code from the builder stage, ensuring ownership by 'bun'
COPY --from=builder --chown=bun:bun /app/index.ts .
# Copy package.json too, ensuring ownership by 'bun'
COPY --from=builder --chown=bun:bun /app/package.json .

# Expose the port the application will listen on
EXPOSE 9000

# Set default environment variables (non-sensitive)
ENV NODE_ENV=production
ENV PORT=9000
ENV LOG_LEVEL=info
# Remember: CF_GATEWAY_URL_* and CF_API_TOKEN MUST be injected at runtime

# Switch to the pre-existing non-root user 'bun'
USER bun

# Healthcheck (Optional but recommended)
# Ensure curl is available in the base image (it usually is in Alpine)
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/healthz || exit 1

# Define the command to run the application
CMD ["bun", "run", "index.ts"]