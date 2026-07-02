FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
# Enable hot reloading support for React inside Docker
ENV CHOKIDAR_USEPOLLING=true
CMD ["npm", "start"]
