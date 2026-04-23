# ─── Stage 1: install deps ────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Copy manifests first to maximize Docker layer caching
COPY package.json package-lock.json* ./
RUN npm ci

# ─── Stage 2: build ──────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js telemetry opt-out during build
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Keep only production dependencies for the runner stage
RUN npm prune --omit=dev

# ─── Stage 3: runtime ────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs

EXPOSE 3000

CMD ["npm", "start"]
