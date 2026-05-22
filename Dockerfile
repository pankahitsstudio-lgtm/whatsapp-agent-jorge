FROM node:20-alpine

WORKDIR /app

# Dependencias
COPY package*.json ./
RUN npm install --omit=dev

# Codigo
COPY src/ ./src/

# Pasta de autenticacao (persistida via Railway Volume)
RUN mkdir -p /app/auth_info

EXPOSE 3000

CMD ["node", "src/index.js"]
