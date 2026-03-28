FROM node:20-alpine

# ── Dependências para better-sqlite3 (nativo C++) ──────────────────
RUN apk add --no-cache python3 make g++

# ── Chromium + dependências para Puppeteer no Alpine ───────────────
# Puppeteer não inclui Chrome em Alpine — usa o Chromium do sistema
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-cjk \
    cups-client

# Diz ao Puppeteer para usar o Chromium do sistema (não baixar o próprio)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# ── CUPS: impressão via lp no container ────────────────────────────
# Para impressão silenciosa funcionar, o container precisa ter acesso
# ao socket CUPS do host. Configure no EasyPanel:
#   Volume extra: /var/run/cups → /var/run/cups (bind mount)
# Ou use impressora de rede com: lp -d ipps://IP/printers/nome

WORKDIR /app

# Instala dependências primeiro (cache de layer)
COPY package.json ./
RUN npm install --production

# Copia o código da aplicação (o .dockerignore exclui data/ e *.db)
COPY . .

# Garante que o diretório de dados existe
# ⚠️ SEM declaração VOLUME aqui — o VOLUME no Dockerfile cria volume anônimo
# que conflita com o bind mount configurado no Easypanel!
# O bind mount do Easypanel ( /var/estima-food-data → /app/data ) é suficiente.
RUN mkdir -p /app/data/uploads

EXPOSE 3001

CMD ["node", "server.js"]
