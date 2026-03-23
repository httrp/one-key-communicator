package server

import (
	"net/http"
	"sync"
	"time"
)

// RateLimiter implements a simple token bucket rate limiter per IP.
type RateLimiter struct {
	mu       sync.Mutex
	clients  map[string]*clientBucket
	rate     int           // Max requests per interval
	interval time.Duration // Time window
	cleanup  time.Duration // Cleanup old entries after this duration
}

type clientBucket struct {
	tokens    int
	lastReset time.Time
	lastSeen  time.Time
}

// NewRateLimiter creates a rate limiter that allows 'rate' requests per 'interval'.
func NewRateLimiter(rate int, interval time.Duration) *RateLimiter {
	rl := &RateLimiter{
		clients:  make(map[string]*clientBucket),
		rate:     rate,
		interval: interval,
		cleanup:  5 * time.Minute,
	}
	go rl.cleanupLoop()
	return rl
}

// Allow checks if a request from the given IP is allowed.
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	bucket, exists := rl.clients[ip]

	if !exists {
		rl.clients[ip] = &clientBucket{
			tokens:    rl.rate - 1,
			lastReset: now,
			lastSeen:  now,
		}
		return true
	}

	bucket.lastSeen = now

	// Reset tokens if interval has passed
	if now.Sub(bucket.lastReset) >= rl.interval {
		bucket.tokens = rl.rate - 1
		bucket.lastReset = now
		return true
	}

	// Check if tokens available
	if bucket.tokens > 0 {
		bucket.tokens--
		return true
	}

	return false
}

// cleanupLoop removes stale entries periodically.
func (rl *RateLimiter) cleanupLoop() {
	ticker := time.NewTicker(rl.cleanup)
	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for ip, bucket := range rl.clients {
			if now.Sub(bucket.lastSeen) > rl.cleanup {
				delete(rl.clients, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// RateLimitMiddleware wraps an http.Handler with rate limiting.
func (rl *RateLimiter) RateLimitMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := getClientIP(r)
		if !rl.Allow(ip) {
			http.Error(w, `{"error":"rate_limit_exceeded"}`, http.StatusTooManyRequests)
			return
		}
		next(w, r)
	}
}
