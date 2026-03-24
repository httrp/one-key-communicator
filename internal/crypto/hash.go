// Package crypto provides cryptographic utilities for One-Key-Communicator.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/crypto/bcrypt"
)

// serverSecret holds the loaded server secret (set by Init)
var serverSecret []byte

// Init loads or creates the server secret. Must be called at startup.
func Init(dataDir string) error {
	secret, err := loadOrCreateSecret(dataDir)
	if err != nil {
		return err
	}
	serverSecret = secret
	return nil
}

// HashPIN creates a bcrypt hash of the PIN.
// Cost is set to 10 (good balance of security and speed for 4-digit PINs).
func HashPIN(pin string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(pin), 10)
	if err != nil {
		return "", fmt.Errorf("hash PIN: %w", err)
	}
	return string(hash), nil
}

// VerifyPIN checks if a PIN matches a bcrypt hash.
func VerifyPIN(pin, hash string) bool {
	// Handle legacy unhashed PINs (plain 4-digit strings)
	if len(hash) <= 6 && hash == pin {
		return true
	}
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(pin))
	return err == nil
}

// EncryptPIN encrypts a PIN using AES-GCM with the server secret.
// Returns base64-encoded ciphertext.
func EncryptPIN(pin string) (string, error) {
	if serverSecret == nil {
		return pin, nil // Fallback if not initialized
	}

	block, err := aes.NewCipher(serverSecret)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(pin), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// DecryptPIN decrypts a PIN that was encrypted with EncryptPIN.
func DecryptPIN(encrypted string) (string, error) {
	if serverSecret == nil {
		return encrypted, nil // Fallback
	}

	// Check if it's a legacy plain PIN (4-6 digits)
	if len(encrypted) <= 6 {
		return encrypted, nil
	}

	ciphertext, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		// Not base64, probably legacy plain PIN
		return encrypted, nil
	}

	block, err := aes.NewCipher(serverSecret)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	if len(ciphertext) < gcm.NonceSize() {
		return encrypted, nil // Too short, probably legacy
	}

	nonce := ciphertext[:gcm.NonceSize()]
	ciphertext = ciphertext[gcm.NonceSize():]

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return encrypted, nil // Decryption failed, return as-is (legacy?)
	}

	return string(plaintext), nil
}

// DeriveKey derives a room-specific encryption key from the server secret.
func DeriveKey(roomID string) []byte {
	if serverSecret == nil {
		return []byte(roomID) // Fallback
	}
	h := sha256.New()
	h.Write(serverSecret)
	h.Write([]byte(roomID))
	return h.Sum(nil)
}

// loadOrCreateSecret loads the server secret from file, or creates one if it doesn't exist.
func loadOrCreateSecret(dataDir string) ([]byte, error) {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	secretPath := filepath.Join(dataDir, ".secret")

	// Try to load existing secret
	data, err := os.ReadFile(secretPath)
	if err == nil {
		// Decode hex
		decoded, err := hex.DecodeString(string(data))
		if err == nil && len(decoded) == 32 {
			return decoded, nil
		}
		// If not valid hex, use first 32 bytes
		if len(data) >= 32 {
			return data[:32], nil
		}
	}

	// Generate new 32-byte secret
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("generate secret: %w", err)
	}

	// Store as hex for easier debugging/backup
	hexSecret := hex.EncodeToString(secret)
	if err := os.WriteFile(secretPath, []byte(hexSecret), 0600); err != nil {
		return nil, fmt.Errorf("save secret: %w", err)
	}

	return secret, nil
}
