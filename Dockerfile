FROM golang:1.23-alpine AS builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /okc ./cmd/okc

FROM alpine:3.19
RUN apk add --no-cache ca-certificates sqlite-libs
COPY --from=builder /okc /usr/local/bin/okc
EXPOSE 8090
VOLUME /data
ENV OKC_DATA_DIR=/data
CMD ["okc"]
