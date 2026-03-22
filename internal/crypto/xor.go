// Package crypto provides simple XOR-based text obfuscation.
// This is NOT cryptographically secure, but prevents plaintext storage.
package crypto

import (
	"encoding/base64"
)

// Encrypt obfuscates text using XOR with the given key.
// Returns base64-encoded result.
func Encrypt(text, key string) string {
	if text == "" || key == "" {
		return text
	}
	keyBytes := []byte(key)
	textBytes := []byte(text)
	result := make([]byte, len(textBytes))

	for i, b := range textBytes {
		result[i] = b ^ keyBytes[i%len(keyBytes)]
	}

	return base64.StdEncoding.EncodeToString(result)
}

// Decrypt reverses XOR obfuscation using the given key.
// Expects base64-encoded input.
func Decrypt(encoded, key string) string {
	if encoded == "" || key == "" {
		return encoded
	}

	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		// Not base64 encoded - likely plaintext from before encryption was added
		return encoded
	}

	keyBytes := []byte(key)
	result := make([]byte, len(data))

	for i, b := range data {
		result[i] = b ^ keyBytes[i%len(keyBytes)]
	}

	return string(result)
}
