FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run prisma:generate && npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
