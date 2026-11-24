# Stage 1: Build desktop & mobile frontends
FROM node:22-alpine AS frontend
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/desktop apps/desktop
COPY apps/mobile apps/mobile
RUN pnpm build

# Stage 2: Build Go backend
FROM golang:1.24-alpine AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /scripta-server ./cmd/server

# Stage 3: Minimal runtime image
FROM alpine:3.21
WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY --from=backend /scripta-server /app/scripta-server
COPY --from=frontend /app/apps/desktop/dist /app/dist/desktop
COPY --from=frontend /app/apps/mobile/dist /app/dist/mobile

ENV STATIC_DIR=/app/dist
ENV PORT=8080
EXPOSE 8080

CMD ["/app/scripta-server"]
