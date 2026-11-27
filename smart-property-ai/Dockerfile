FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm install prisma
COPY . .
RUN npx prisma generate
EXPOSE 4000
CMD ["node", "src/server.js"]
