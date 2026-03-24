// Package crypto provides encryption utilities for One-Key-Communicator text content.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
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

// EncryptText encrypts text using AES-GCM with a room-derived key.
func EncryptText(text, roomID string) string {
	if text == "" {
		return text
	}
	key := DeriveKey(roomID)
	block, err := aes.NewCipher(key)
	if err != nil {
		return text
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return text
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return text
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(text), nil)
	return base64.StdEncoding.EncodeToString(ciphertext)
}

// DecryptText decrypts text that was encrypted with EncryptText.
// Returns "" on failure (e.g. legacy XOR-encoded data) so the writer can simply re-enter the text.
func DecryptText(encoded, roomID string) string {
	if encoded == "" {
		return encoded
	}
	key := DeriveKey(roomID)
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "" // legacy or corrupt — return empty
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	if len(data) < gcm.NonceSize() {
		return "" // too short — legacy or corrupt
	}
	nonce := data[:gcm.NonceSize()]
	ciphertext := data[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "" // decryption failed — likely old XOR data
	}
	return string(plaintext)
}
