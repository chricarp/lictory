FROM oven/bun:1.4.2-alpine AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile

FROM dependencies AS development
COPY . .
EXPOSE 3000
CMD ["bun", "run", "dev", "--hostname", "0.0.0.0"]

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG LICTORY_PUBLIC_ORIGIN=http://localhost:3000
RUN BETTER_AUTH_URL=$LICTORY_PUBLIC_ORIGIN \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=container-build-placeholder-not-for-runtime \
    bun run build

FROM base AS production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/LICENSE ./LICENSE
COPY --from=builder /app/NOTICE ./NOTICE
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/.next ./.next
COPY --from=builder /app/public ./public
# The same image supports explicit one-shot migrations and the job worker.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/instrumentation.ts ./instrumentation.ts
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
