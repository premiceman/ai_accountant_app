# syntax=docker/dockerfile:1

FROM node:20-bullseye AS base

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
COPY services/worker/package.json services/worker/tsconfig.json ./services/worker/
RUN npm install --prefix services/worker

FROM deps AS build
COPY services/worker/src ./services/worker/src
RUN npm run --prefix services/worker build

FROM base AS runner
ENV NODE_ENV=production
COPY services/worker/package.json ./services/worker/package.json
COPY --from=build /app/services/worker/dist ./services/worker/dist
RUN npm install --prefix services/worker --omit=dev

CMD ["node", "services/worker/dist/index.js"]
