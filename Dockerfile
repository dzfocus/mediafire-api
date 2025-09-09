FROM node:20-bullseye-slim

# Install dependencies required by Chrome
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates fonts-liberation libxss1 lsb-release \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1 libgtk-3-0 libxcomposite1 libxrandr2 libasound2 \
    libpangocairo-1.0-0 libgbm1 libpango-1.0-0 libxdamage1 libxfixes3 \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install Google Chrome stable
RUN wget -q -O /tmp/google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y /tmp/google-chrome-stable_current_amd64.deb \
    && rm -f /tmp/google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Ensure Puppeteer can download/use the expected Chromium during build
ENV PUPPETEER_CACHE_DIR=/usr/local/share/.cache/puppeteer
RUN mkdir -p ${PUPPETEER_CACHE_DIR}
RUN npx puppeteer@24.19.0 install --product=chrome --path=${PUPPETEER_CACHE_DIR}

# Copy source
COPY . .

EXPOSE 10000
CMD ["node", "server.js"]
