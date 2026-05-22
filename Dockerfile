FROM node:20-alpine

# Dependencias de sistema necessarias para Baileys
RUN apk add --no-cache git python3 make g++ 

WORKDIR /app

# Dependencias Node
COPY package*.json ./
RUN npm install --omit=dev

# Codigo
COPY src/ ./src/

# Pasta de autenticacao (persistida via Railway Volume)
RUN mkdir -p /app/auth_info

EXPOSE 3000

CMD ["node", "src/index.js"]
