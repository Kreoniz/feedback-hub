# syntax=docker/dockerfile:1
FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS web
WORKDIR /src
RUN npm install --global pnpm@12.5.1
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM golang:1.27.3-alpine@sha256:f2c872bcee949b7be9c490efd02b48a8a2fbf947cdf533f1c58525ec9d8170fd AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend/ ./
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /feedback-hub ./cmd/feedback-hub

FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app
COPY --from=backend /feedback-hub /usr/local/bin/feedback-hub
COPY --from=web /src/dist /app/web
# Public assets must remain readable after a restrictive source-export umask.
RUN chmod -R a+rX /app/web
USER 10001:10001
WORKDIR /app
ENV STATIC_DIR=/app/web LISTEN_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["feedback-hub"]
