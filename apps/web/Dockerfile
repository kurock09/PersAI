FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /workspace

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile

ARG PERSAI_WEB_API_PROXY_TARGET="http://api:3001/api/v1"
ENV PERSAI_WEB_API_PROXY_TARGET=${PERSAI_WEB_API_PROXY_TARGET}

RUN pnpm --filter @persai/web run build

WORKDIR /workspace/apps/web

EXPOSE 3000

CMD ["pnpm", "start"]
