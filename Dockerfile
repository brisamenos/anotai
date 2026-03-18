FROM node:20-alpine

# Ferramentas necessárias para compilar better-sqlite3 (módulo nativo C++)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data /app/data/uploads

EXPOSE 3001

CMD ["node", "server.js"]
