# CarePlus — production image for Cloud Run.
# Multi-stage: install deps -> next build -> slim runtime running `next start` on $PORT.
# Secrets/.env are never copied (see .dockerignore); credentials come from the Cloud Run
# service account / Secret Manager at runtime.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
EXPOSE 8080
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p ${PORT:-8080} -H 0.0.0.0"]
