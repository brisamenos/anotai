FROM node:20-alpine

# ── Dependências para better-sqlite3 (nativo C++) ──────────────────
RUN apk add --no-cache python3 make g++

# ── Chromium + CUPS para Puppeteer e impressão silenciosa ───────────
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    cups \
    cups-filters

# Diz ao Puppeteer para usar o Chromium do sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data/uploads

EXPOSE 3001

CMD ["node", "server.js"]
