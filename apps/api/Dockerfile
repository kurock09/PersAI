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
RUN rm -rf apps/api/dist
RUN pnpm --filter @persai/api run build
RUN test -f /workspace/apps/api/dist/apps/api/src/main.js \
  && node -e 'const fs = require("node:fs"); const file = "/workspace/apps/api/dist/apps/api/src/modules/workspace-management/application/preview-assistant-setup.service.js"; if (!fs.existsSync(file)) { throw new Error(`Missing compiled preview setup service: ${file}`); } const text = fs.readFileSync(file, "utf8"); if (!text.includes("ResolveActiveAssistantService")) { throw new Error("Compiled preview setup service is missing ResolveActiveAssistantService."); } if (text.includes("findByUserId")) { throw new Error("Compiled preview setup service still references findByUserId."); }'

WORKDIR /workspace/apps/api

EXPOSE 3001

CMD ["node", "dist/apps/api/src/main.js"]
