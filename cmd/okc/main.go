package main

import (
	"log"

	"github.com/dominikhattrup/one-key-communicator/internal/config"
	"github.com/dominikhattrup/one-key-communicator/internal/crypto"
	"github.com/dominikhattrup/one-key-communicator/internal/server"
	"github.com/dominikhattrup/one-key-communicator/internal/storage"
	"github.com/dominikhattrup/one-key-communicator/web"
)

func main() {
	cfg := config.Load()

	// Initialize crypto with server secret
	if err := crypto.Init(cfg.DataDir); err != nil {
		log.Fatalf("Failed to initialize crypto: %v", err)
	}

	db, err := storage.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	srv := server.New(cfg, db, web.LandingFS, web.AppFS)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
