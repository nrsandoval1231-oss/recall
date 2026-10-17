FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
RUN --mount=type=secret,id=build_ca,target=/tmp/build-ca.pem \
    if [ -f /tmp/build-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/build-ca.pem; fi; \
    npm ci --ignore-scripts --workspace @recall/desktop --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/api-client packages/api-client
COPY packages/design-tokens packages/design-tokens
COPY apps/desktop apps/desktop
RUN npm run build -w @recall/desktop
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY infra/megraph/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/apps/desktop/dist /usr/share/nginx/html
EXPOSE 8080
