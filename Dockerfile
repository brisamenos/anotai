FROM node:20

# ── Dependências para better-sqlite3 (nativo C++) ──────────────────
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends

# ── Chromium + CUPS para Puppeteer e impressão silenciosa ───────────
RUN apt-get install -y \
    chromium \
    cups \
    cups-filters \
    fonts-freefont-ttf \
    fonts-noto \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Diz ao Puppeteer para usar o Chromium do sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data/uploads

EXPOSE 3001

CMD ["node", "server.js"]
