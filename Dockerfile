# Imagem base do Docker Hub (não do ghcr.io) — evita o timeout de rede
# que estava travando o Nixpacks tentando puxar a imagem dele.
FROM node:20-slim

# Ferramentas de build (better-sqlite3 é um módulo nativo, precisa compilar)
# + bibliotecas de sistema que o Chromium do Puppeteer precisa pra rodar
# (a mesma lista que o Nixpacks já tinha detectado sozinho antes).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates fonts-liberation \
    libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    wget xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia só o package.json primeiro — acelera builds futuros (o Docker só
# reinstala os pacotes se esse arquivo mudar, não a cada alteração de código)
COPY package*.json ./
RUN npm install --production

# Agora copia o resto do código
COPY . .

# Garante que a pasta de dados persistente existe
RUN mkdir -p /app/data/uploads

EXPOSE 3001

CMD ["node", "server.js"]
