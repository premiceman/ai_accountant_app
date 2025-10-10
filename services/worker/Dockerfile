# syntax=docker/dockerfile:1

FROM node:20-bullseye AS base
# Build context MUST be the repo root (contains /shared and /services)

WORKDIR /app

# Install system dependencies for PDF parsing and OCR ahead of later steps
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
ENV NODE_ENV=development
# Copy manifests first for better caching
COPY shared/extraction ./shared/extraction
COPY services/worker/package.json services/worker/tsconfig.json ./services/worker/
RUN npm install --prefix services/worker

FROM deps AS build
COPY services/worker/src ./services/worker/src
# Type declarations are already referenced via tsconfig include.
# Shared JS is runtime-loaded; presence in deps stage is enough for build context.
RUN npm run --prefix services/worker build

FROM base AS runner
ENV NODE_ENV=production
COPY services/worker/package.json ./services/worker/package.json
COPY --from=build /app/services/worker/dist ./services/worker/dist
## Ensure shared extractors exist at runtime for dynamic imports
COPY shared/extraction ./shared/extraction
RUN npm install --prefix services/worker --omit=dev

CMD ["node", "services/worker/dist/index.js"]
