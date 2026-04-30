FROM node:20

WORKDIR /app

# Instala CUPS durante o build (não em runtime)
RUN apt-get update -qq && \
    apt-get install -y cups cups-filters printer-driver-cups-pdf --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data/uploads

EXPOSE 3001

CMD ["node", "server.js"]
