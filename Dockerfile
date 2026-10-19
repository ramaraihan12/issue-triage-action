# Runs the local dry-run script (pnpm triage:local) in a container, for trying
# the triage logic without installing Node. The action itself runs on node24.
FROM node:24-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY examples ./examples

ENTRYPOINT ["pnpm", "-s", "triage:local"]
