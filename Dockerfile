FROM node:18-alpine

# Dependências para compilar better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copia e instala dependências
COPY package.json .
RUN npm install --production

# Copia todos os arquivos estáticos e o servidor
COPY . .

# Diretório de dados persistentes (mapeado como volume no Easypanel)
RUN mkdir -p /app/data/uploads
VOLUME ["/app/data"]

EXPOSE 3001
CMD ["node", "server.js"]
