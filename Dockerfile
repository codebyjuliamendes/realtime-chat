# syntax=docker/dockerfile:1

# ---- build: install all deps and compile the CSS bundle ----------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tailwind.config.cjs ./
COPY client ./client
COPY public ./public
RUN npm run build:css

# ---- runtime deps only ----------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- runtime --------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3003 \
    DB_PATH=/data/chat.db
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --from=build --chown=node:node /app/public ./public

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node

EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3003)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# exec form: node is PID 1 and receives SIGTERM for the graceful shutdown
CMD ["node", "server/index.js"]
