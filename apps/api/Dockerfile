# Образ api (C3, C6, ADR 0004, 0009). Контекст сборки — корень репозитория: lock-файл workspace лежит там.
#   docker build -f apps/api/Dockerfile -t cpt-api .
# Три стадии: build (TypeScript → dist), cmc-stub (только для compose и e2e), runtime (без devDependencies).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
# --ignore-scripts: prepare ставит git-хуки husky, в образе им не место
RUN npm ci --ignore-scripts
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/src apps/api/src
RUN npm run build -w @cpt/api

# Стаб CoinMarketCap: Node 24 запускает .ts без сборки, зависимостей у стаба нет
FROM node:24-alpine AS cmc-stub
WORKDIR /stub
COPY apps/api/scripts/cmc-stub.ts apps/api/scripts/cmc-stub-server.ts ./
RUN echo '{"type":"module"}' > package.json
ENV PORT=4010
EXPOSE 4010
USER node
# Любой HTTP-ответ (даже 401 без ключа) значит, что стаб слушает порт
HEALTHCHECK --interval=5s --timeout=2s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT).then(()=>process.exit(0),()=>process.exit(1))"]
CMD ["node", "cmc-stub-server.ts"]

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
# Только runtime-зависимости из ТЗ (C7): express, axios, swagger-ui-express
RUN npm ci --omit=dev --ignore-scripts -w @cpt/api && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
# БД — в volume, вне слоёв образа; каталог заранее отдан пользователю node (не root)
RUN mkdir /data && chown node:node /data
ENV PORT=3000 DATABASE_PATH=/data/cpt.db
VOLUME /data
EXPOSE 3000
USER node
# server.ts ищет migrations от рабочего каталога
WORKDIR /app/apps/api
# Readiness, а не liveness: контейнер healthy, когда БД открыта и миграции применены
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# exec-форма: node — прямой потомок init и получает SIGTERM сам (npm start сигнал не передаёт)
CMD ["node", "dist/server.js"]
