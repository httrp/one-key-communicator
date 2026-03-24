// Package crypto provides simple XOR-based text obfuscation.
// This is NOT cryptographically secure, but prevents plaintext storage.
package crypto

import (
	"encoding/base64"
)

// Encrypt obfuscates text using XOR with the given key.
// Returns base64-encoded result.
// Deprecated: Use EncryptText with room ID instead.
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
// Deprecated: Use DecryptText with room ID instead.
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

// EncryptText encrypts text using the server secret and room ID.
// Uses XOR with a derived key (32 bytes from HMAC).
func EncryptText(text, roomID string) string {
	if text == "" {
		return text
	}
	key := DeriveKey(roomID)
	return Encrypt(text, string(key))
}

// DecryptText decrypts text that was encrypted with EncryptText.
func DecryptText(encoded, roomID string) string {
	if encoded == "" {
		return encoded
	}
	key := DeriveKey(roomID)
	return Decrypt(encoded, string(key))
}
