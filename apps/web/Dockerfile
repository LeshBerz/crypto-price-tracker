# Образ web (ADR 0016). Контекст сборки — корень репозитория: lock-файл workspace лежит там.
#   docker build -f apps/web/Dockerfile -t cpt-web .
# Две стадии: build (next build → .next/standalone) и runtime (только собранный сервер, без npm и исходников).

FROM node:24-alpine AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
# --ignore-scripts: prepare ставит git-хуки husky, в образе им не место
RUN npm ci --ignore-scripts
COPY apps/web apps/web
# Сборке не нужны ни ключи api, ни адрес api: конфиг читается при старте сервера, а не при сборке
RUN npm run build -w @cpt/web

FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# output: standalone — сервер и только те файлы node_modules, которые он импортирует
COPY --from=build /app/apps/web/.next/standalone ./
# Статику standalone не включает: её отдаёт тот же сервер из .next/static
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
# БД сессий — в volume, вне слоёв образа; каталог заранее отдан пользователю node (не root)
RUN mkdir /data && chown node:node /data
# HOSTNAME: без него сервер слушал бы только имя контейнера, и healthcheck по 127.0.0.1 не проходил бы
ENV PORT=3000 HOSTNAME=0.0.0.0 WEB_DATABASE_PATH=/data/web.db
VOLUME /data
EXPOSE 3000
USER node
# Готовность самого web: конфиг прочитан, БД открыта. Доступность api в проверку не входит
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# exec-форма: node — прямой потомок init и получает SIGTERM сам
CMD ["node", "apps/web/server.js"]
