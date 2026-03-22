FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /workspace

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @persai/types run build
RUN pnpm --filter @persai/logger run build
RUN pnpm --filter @persai/config run build
RUN pnpm --filter @persai/api run prisma:generate
RUN pnpm --filter @persai/api run build
RUN test -f /workspace/apps/api/dist/apps/api/src/main.js

WORKDIR /workspace/apps/api

EXPOSE 3001

CMD ["node", "dist/apps/api/src/main.js"]
