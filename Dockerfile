FROM node:20

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data/uploads

EXPOSE 3001

CMD ["node", "server.js"]
