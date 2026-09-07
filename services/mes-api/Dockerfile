FROM node:22-bookworm-slim
ENV NODE_ENV=production
ENV DB_SSL_ROOT_CERT=/app/supabase-ca.crt
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node app.mjs config.mjs server.mjs supabase-ca.crt ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--env-file-if-exists=.env", "server.mjs"]
