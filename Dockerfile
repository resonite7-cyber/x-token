# syntax=docker/dockerfile:1

FROM node:22-alpine AS base

# =====================================================
# DEPENDENCIES
# =====================================================
FROM base AS deps
WORKDIR /app

# Native deps (usb, utf-8-validate, bufferutil, etc.) need a build toolchain
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev libusb-dev pkgconfig

# The lockfile requires npm >=11's resolver
RUN npm install -g npm@11

COPY package.json package-lock.json ./
RUN npm ci

# =====================================================
# BUILD
# =====================================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_SOLANA_RPC_URL
ENV NEXT_PUBLIC_SOLANA_RPC_URL=${NEXT_PUBLIC_SOLANA_RPC_URL}

RUN npm run build

# =====================================================
# RUNTIME
# =====================================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
