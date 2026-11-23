FROM node:22-bookworm-slim
WORKDIR /opt/qvac
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgomp1 libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs sensor.mjs ./
COPY ui ./ui
RUN mkdir -p /home/node/.qvac && chown -R node:node /home/node/.qvac
ENV HOME=/home/node
ENV HOST=0.0.0.0
EXPOSE 8765
USER node
CMD ["node", "server.mjs"]
