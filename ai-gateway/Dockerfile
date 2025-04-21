# Stage 1: Build/Dependencies Stage
FROM oven/bun:canary-alpine as builder # Use the full image which might have more build tools if needed
WORKDIR /app

# Create non-root user early (optional in builder but good practice)
RUN groupadd --gid 1001 bun && \
    useradd --uid 1001 --gid 1001 --shell /bin/bash --create-home bun

# Copy dependency definition files
COPY package.json bun.lockb ./

# Install dependencies using frozen lockfile
# This layer is cached if lockfile doesn't change
RUN bun install --frozen-lockfile

# Copy the rest of the application code
COPY index.ts .
# If you had a tsconfig.json, copy it too: COPY tsconfig.json .

# Optional: Change ownership early if needed, though final stage matters more
# RUN chown -R bun:bun /app

# Stage 2: Production Stage
FROM oven/bun:canary-alpine as production # Use the slim image

WORKDIR /app

# Create non-root user and group (must be done in final stage)
RUN groupadd --gid 1001 bun && \
    useradd --uid 1001 --gid 1001 --shell /bin/bash --create-home bun

# Copy installed dependencies from the builder stage
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
# Copy application code from the builder stage
COPY --from=builder --chown=bun:bun /app/index.ts .
# Copy package.json too (sometimes useful for runtime info, though not strictly needed by bun run index.ts)
COPY --from=builder --chown=bun:bun /app/package.json .

# Expose the port the application will listen on
EXPOSE 9000

# Set default environment variables (non-sensitive)
ENV NODE_ENV=production
ENV PORT=9000
ENV LOG_LEVEL=info
# Remember: CF_GATEWAY_URL and CF_API_TOKEN MUST be injected at runtime

# Switch to the non-root user
USER bun

# Define the command to run the application
CMD ["bun", "run", "index.ts"]