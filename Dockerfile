FROM node:20-alpine

# Instala dependências de sistema necessárias para pacotes nativos (ex: better-sqlite3)
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Copia os manifestos de dependências primeiro para otimizar o cache de camadas do Docker
COPY package*.json ./

# Instala todas as dependências (incluindo devDependencies para vite build e tsx)
RUN npm install --include=dev

# Copia o restante do código-fonte da aplicação
COPY . .

# Executa o build de produção do frontend (Vite) e empacotamento
RUN npm run build

# Define variáveis de ambiente padrão de produção e porta
ENV PORT=3000
ENV NODE_ENV=production

# Expõe a porta 3000 para o EasyPanel / proxy reverso
EXPOSE 3000

# Inicia o servidor Express diretamente via tsx
CMD ["npx", "tsx", "server.ts"]
