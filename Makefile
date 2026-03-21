.PHONY: build run clean dev

BINARY=okc
VERSION?=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

build:
	go build -ldflags="-s -w -X main.version=$(VERSION)" -o $(BINARY) ./cmd/okc

run: build
	./$(BINARY)

dev:
	go run ./cmd/okc

clean:
	rm -f $(BINARY)
	rm -rf data/

# Docker
docker-build:
	docker build -t okc:latest .

docker-run:
	docker run -p 8090:8090 -v okc-data:/data okc:latest

# Cross-compilation
build-linux-amd64:
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o $(BINARY)-linux-amd64 ./cmd/okc

build-linux-arm64:
	GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o $(BINARY)-linux-arm64 ./cmd/okc

build-all: build-linux-amd64 build-linux-arm64
