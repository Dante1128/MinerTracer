# Imagen de producción: la API sirve también el frontend compilado (web/dist).
# Pensada para Hugging Face Spaces (puerto 7860), pero vale para cualquier host de contenedores.

# 1. Compilar el frontend
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --include=dev
COPY web/ ./
RUN npm run build

# 2. API (tsx ejecuta TypeScript directamente, por eso se instalan también las devDependencies)
FROM node:22-slim
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist

# DATOS_DIR guarda los PDFs (y PGlite si no hay DATABASE_URL). En Spaces el disco no es persistente.
ENV NODE_ENV=production \
    PORT=7860 \
    DATOS_DIR=/tmp/minertrace

# Spaces ejecuta el contenedor con el usuario 1000 (el usuario "node" de la imagen).
USER node
EXPOSE 7860
CMD ["node", "--import", "tsx", "src/index.ts"]
