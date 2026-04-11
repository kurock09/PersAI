FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /workspace

RUN corepack enable
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @persai/types run build
RUN pnpm --filter @persai/logger run build
RUN pnpm --filter @persai/config run build
RUN pnpm --filter @persai/provider-gateway run build
RUN test -f /workspace/apps/provider-gateway/dist/apps/provider-gateway/src/main.js

WORKDIR /workspace/apps/provider-gateway

EXPOSE 3011

CMD ["node", "dist/apps/provider-gateway/src/main.js"]
