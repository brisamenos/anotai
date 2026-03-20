FROM node:20-alpine

# Ferramentas necessárias para compilar better-sqlite3 (módulo nativo C++)
RUN apk add --no-cache python3 make g++

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
