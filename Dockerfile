# OWO CRM — один контейнер: Next.js + LibreOffice (PDF договоров из Word-шаблона).
FROM node:22-bookworm-slim AS base
ENV TZ=Europe/Warsaw NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-liberation fonts-dejavu-core tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS run
ENV NODE_ENV=production PORT=3000
COPY --from=build /app ./
RUN useradd -m app && chown -R app /app
USER app
EXPOSE 3000
CMD ["npm", "start"]
