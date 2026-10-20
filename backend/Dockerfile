# NOTE for Apple Silicon (M1/M2/M3): Docker builds for your host architecture by
# default, producing an arm64 image. AWS App Runner and ECS Fargate run x86_64
# unless configured otherwise, and an arm64 image fails there with a confusing
# "exec format error". Build with:
#   docker build --platform linux/amd64 -t motion-api .
FROM node:18-alpine

WORKDIR /app

# npm ci installs exactly what's in package-lock.json — reproducible builds.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# App Runner defaults to 8080; override with the PORT env var if needed.
ENV PORT=4000
EXPOSE 4000

# Lets the orchestrator restart the container if the app wedges.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
