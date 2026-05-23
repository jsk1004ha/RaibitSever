FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npm prune --omit=dev
RUN chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server.js"]
