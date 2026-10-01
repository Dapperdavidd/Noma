FROM node:22-alpine AS web-build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
RUN npm run build

FROM rust:1-bookworm AS api-build
WORKDIR /workspace
COPY Cargo.toml Cargo.lock ./
COPY apps/api apps/api
RUN cargo build --locked --release -p noma-api

FROM debian:bookworm-slim AS api
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 noma
COPY --from=api-build /workspace/target/release/noma-api /usr/local/bin/noma-api
USER noma
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8080/ready >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/noma-api"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
