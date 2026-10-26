FROM node:24-slim AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

# ── Lambda variant of the indexing consumer (docker build --target lambda) ────
# It has its own dependency stage on purpose: native modules built for Node 24 do not load on the
# Node 22 Lambda base image.
FROM public.ecr.aws/lambda/nodejs:22 AS lambda-builder
WORKDIR /build
RUN dnf install -y python3 make gcc-c++ && dnf clean all
COPY package*.json ./
RUN npm ci --omit=dev

FROM public.ecr.aws/lambda/nodejs:22 AS lambda
COPY --from=lambda-builder /build/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY . ${LAMBDA_TASK_ROOT}/
CMD ["src/handlers/indexingLambda.handler"]

# ── ECS runtime: the default target, so it must stay the last stage ───────────
FROM node:24-slim AS runtime
ENV NODE_ENV=production
# Tracing is opt-in: Terraform sets this to false when enable_tracing is on.
ENV OTEL_SDK_DISABLED=true
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {if(r.statusCode !== 200) process.exit(1); else process.exit(0);}).on('error', () => process.exit(1));" || exit 1
CMD ["node", "-r", "./src/tracing.js", "server.js"]
