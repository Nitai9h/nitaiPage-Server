FROM node:22-slim AS deps

# better-sqlite3 是原生模块，装上编译链以兜住没有预编译产物的情况
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund


FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# 运行期要现场拉取并构建前端，所以镜像里得带 git
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts

# 前端源码与产物、数据库都落在这里
# 先建好并交给 node 用户，新建数据卷继承该属主，避免挂卷后写不进去
RUN mkdir -p /app/data/files /app/frontend \
    && chown -R node:node /app

USER node

# 页面端口与 API 端口
EXPOSE 11123 11125

# 先准备前端产物再起服务；PREPARE_FRONTEND=false 可跳过
CMD ["sh", "-c", "node scripts/prepare-frontend.mjs && node src/index.js"]
