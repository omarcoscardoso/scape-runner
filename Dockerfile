FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

RUN npm ci --omit=dev

# Bundle app source
COPY . .

# Cloud Run injects the PORT environment variable. We expose 8080 by default.
ENV PORT=8080
EXPOSE 8080

CMD [ "npm", "start" ]
