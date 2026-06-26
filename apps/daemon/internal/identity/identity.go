// Package identity provides a stable machine identifier for daemon registration.
package identity

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

func configDir() string {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "agentik")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".config", "agentik")
	}
	return filepath.Join(".", ".agentik")
}

// IDPath is where the stable daemon UUID is stored.
func IDPath() string {
	return filepath.Join(configDir(), "daemon.id")
}

// LoadOrCreate returns a persistent machine UUID used as the daemon register name.
func LoadOrCreate() (string, error) {
	path := IDPath()
	if b, err := os.ReadFile(path); err == nil {
		id := strings.TrimSpace(string(b))
		if id != "" {
			return id, nil
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	id := hex.EncodeToString(raw[:])
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(id+"\n"), 0o600); err != nil {
		return "", err
	}
	return id, nil
}

// DeviceName returns the OS hostname for display in the UI.
func DeviceName() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "computer"
	}
	return h
}
