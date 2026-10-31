# Multi-target build for the monorepo. Targets: api, web.
#   docker compose up --build          (see docker-compose.yml)
FROM node:22-bookworm-slim AS deps
# Prisma's query engine links against OpenSSL.
RUN (apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*) \
    || echo 'openssl package unavailable; Prisma falls back to its default engine (works, logs a warning)'
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Optional corporate/proxy CA: docker build --secret id=ca,src=/path/ca.pem (ignored when absent).
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; npm ci

FROM deps AS build
# Next resolves rewrites at build time, so the API origin the web server proxies to is a build arg.
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=$API_ORIGIN NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; npm run build

FROM node:22-bookworm-slim AS api
RUN (apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*) \
    || echo 'openssl package unavailable; Prisma falls back to its default engine (works, logs a warning)'
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://localhost:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Applies pending migrations, then serves. Seeding is a separate, explicit, non-production step.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "-p", "3000"]
