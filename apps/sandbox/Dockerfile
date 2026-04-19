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
RUN pnpm --filter @persai/config run build
RUN pnpm --filter @persai/api run prisma:generate
RUN pnpm --filter @persai/sandbox run build
RUN test -f /workspace/apps/sandbox/dist/apps/sandbox/src/main.js

WORKDIR /workspace/apps/sandbox

EXPOSE 3013

CMD ["node", "dist/apps/sandbox/src/main.js"]
