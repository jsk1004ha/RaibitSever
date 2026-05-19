FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
RUN npm install --omit=dev
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server.js"]
