FROM node:24-slim
WORKDIR /app
COPY client/package*.json client/
RUN npm --prefix client ci
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev
COPY . .
RUN npm --prefix client run build
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server/index.js"]
