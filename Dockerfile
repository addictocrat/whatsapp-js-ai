FROM ghcr.io/puppeteer/puppeteer:latest

# Run as root to prevent permission issues with Coolify persistent storage mounts
USER root
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Tell Puppeteer to use the pre-installed Google Chrome in the image
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true


CMD ["npm", "start"]


