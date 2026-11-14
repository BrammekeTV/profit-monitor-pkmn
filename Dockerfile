# Profit Monitor – self-hosted image (static app + small Node server).
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    PUID=99 \
    PGID=100 \
    BACKUP_KEEP=30 \
    TZ=Europe/Amsterdam

WORKDIR /app

# tzdata so TZ is honoured (daily backup file names follow local time)
RUN apk add --no-cache tzdata

COPY server.mjs index.html profit-monitor-core.mjs card-images.mjs ./
COPY assets ./assets
COPY data ./data

VOLUME ["/data"]
EXPOSE 8080

# Starts as root only to give /data to PUID:PGID, then drops to that user.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

CMD ["node", "server.mjs"]
