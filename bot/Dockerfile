FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Jakarta
RUN apk add --no-cache tzdata
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "--import", "tsx", "src/server.ts"]
