# Build context: repository root, after pnpm nx run web:build.
# Unprivileged nginx (runs as uid 101, listens on 8080) serves the static
# bundle and proxies API paths to $API_URL so the browser stays same-origin.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY dist/apps/web/ /usr/share/nginx/html/
ENV API_URL=http://localhost:3000
EXPOSE 8080
