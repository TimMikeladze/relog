# -- Dependencies --
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY app/package.json app/bun.lock ./app/
RUN bun install --frozen-lockfile --ignore-scripts
RUN cd app && bun install --frozen-lockfile --ignore-scripts

# -- Build --
FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/app/node_modules ./app/node_modules
COPY . .
RUN bun run build

# -- Production deps only --
FROM oven/bun:1 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# -- Runtime --
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 3485

CMD ["bun", "run", "dist/cli.js", "start", "--db", "/data/relog.db", "--no-open"]
