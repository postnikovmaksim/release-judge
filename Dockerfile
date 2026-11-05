FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache mediainfo ffmpeg tini
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config/rules.example.yaml ./config/rules.example.yaml
ENV NODE_ENV=production PORT=3100 DATA_DIR=/state CONFIG_DIR=/config
EXPOSE 3100
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3100/health || exit 1
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","dist/index.js"]
