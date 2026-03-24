package config

import (
	"flag"
	"fmt"
	"os"
	"strconv"
)

// Config holds all application configuration.
type Config struct {
	Port       int
	BaseURL    string
	DataDir    string
	StatsToken string
}

// Load reads configuration from flags and environment variables.
func Load() *Config {
	cfg := &Config{}

	flag.IntVar(&cfg.Port, "port", envInt("OKC_PORT", 8090), "Port to listen on")
	flag.StringVar(&cfg.BaseURL, "base-url", envStr("OKC_BASE_URL", ""), "Public base URL")
	flag.StringVar(&cfg.DataDir, "data-dir", envStr("OKC_DATA_DIR", "data"), "Directory for SQLite database")
	flag.StringVar(&cfg.StatsToken, "stats-token", envStr("OKC_STATS_TOKEN", ""), "Token to protect /api/stats (leave empty to disable protection)")
	flag.Parse()

	if cfg.BaseURL == "" {
		cfg.BaseURL = fmt.Sprintf("http://localhost:%d", cfg.Port)
	}

	return cfg
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}
