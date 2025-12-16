FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

ENV PORT=2000
ENV DB_PATH=/data/wishpool.sqlite

EXPOSE 3000

CMD ["npm", "start"]
