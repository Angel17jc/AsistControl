# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci -w @asistcontrol/shared -w @asistcontrol/web --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @asistcontrol/shared && npm run build -w @asistcontrol/web

# Static files served by nginx, which also reverse-proxies the API and WebSocket so the
# browser talks to a single origin (no CORS, SameSite=strict cookies keep working).
FROM nginx:1.29-alpine AS runtime
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
