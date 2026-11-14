# Node 22 is shared with CI; packageManager pins pnpm to 11.25.0.
FROM node:22-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
# .dockerignore excludes every env file, local dataset and host build artifact.
COPY . .
RUN mkdir -p public && pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node docker/app-entrypoint.sh ./docker/app-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "/app/docker/app-entrypoint.sh"]
CMD ["node", "server.js"]
