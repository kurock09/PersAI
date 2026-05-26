FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /workspace

RUN corepack enable
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @persai/types run build
RUN pnpm --filter @persai/logger run build
RUN pnpm --filter @persai/config run build
RUN pnpm --filter @persai/api run prisma:generate
RUN rm -rf apps/api/dist \
  && pnpm --filter @persai/api run build \
  && test -f /workspace/apps/api/dist/apps/api/src/main.js \
  && node /workspace/apps/api/scripts/assert-compiled-preview-fresh.cjs

WORKDIR /workspace/apps/api

EXPOSE 3001

CMD ["sh", "-c", "node scripts/assert-compiled-preview-fresh.cjs && exec node dist/apps/api/src/main.js"]
