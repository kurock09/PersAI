FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /workspace

RUN corepack enable
# ADR-123 Slice 7 — ripgrep (rg) + fd-find back the inline grep/glob workspace
# tools, which run as TRUSTED PersAI-owned control-plane subprocesses against
# the hydrated workspace (NOT in an exec pod). Mirrors the exec-image install
# (apps/sandbox/exec-image/Dockerfile); Debian installs fd as `fdfind`, so we
# symlink it to `fd` as the exec image does.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ripgrep fd-find \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd \
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
