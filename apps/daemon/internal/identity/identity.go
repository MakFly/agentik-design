// Package identity provides a stable machine identifier for daemon registration.
package identity

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// BaseDir is the daemon's on-disk state root — a single dotdir holding the
// config, identity, credentials, workspace and memory (the OpenClaw-style layout,
// branded agentik). Override with $AGENTIK_HOME. Defaults to ~/.agentik, mirroring
// OpenClaw's ~/.openclaw (at $HOME, not under ~/.config).
func BaseDir() string {
	if h := os.Getenv("AGENTIK_HOME"); h != "" {
		return h
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".agentik")
	}
	return filepath.Join(".", ".agentik")
}

// LegacyBaseDir is where pre-mirror builds kept their state ($XDG_CONFIG_HOME/agentik
// or ~/.config/agentik). Used to migrate an existing install into BaseDir() in place.
func LegacyBaseDir() string {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "agentik")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".config", "agentik")
	}
	return ""
}

// IDPath is where the stable daemon UUID is stored.
func IDPath() string {
	return filepath.Join(BaseDir(), "daemon.id")
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
	// Adopt a legacy daemon.id (pre-mirror ~/.config/agentik) so a migrated host
	// keeps its identity instead of registering as a brand-new daemon.
	if legacy := LegacyBaseDir(); legacy != "" {
		if b, err := os.ReadFile(filepath.Join(legacy, "daemon.id")); err == nil {
			if id := strings.TrimSpace(string(b)); id != "" {
				if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
					return "", err
				}
				if err := os.WriteFile(path, []byte(id+"\n"), 0o600); err != nil {
					return "", err
				}
				return id, nil
			}
		}
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

// LegacyDaemonIDs returns identifiers a previous daemon version may have
// registered this machine under, before the stable UUID in daemon.id became the
// identity. Pre-UUID builds used the OS hostname as the register name; the engine
// matches these so a host that upgrades is adopted in place instead of spawning a
// duplicate row (hostname → UUID transition). Best-effort: empty on hostname error.
func LegacyDaemonIDs() []string {
	h, err := os.Hostname()
	if err != nil {
		return []string{}
	}
	return legacyFormsOf(h)
}

// legacyFormsOf returns the distinct, non-empty prior register names derivable
// from a hostname: the raw value and its mDNS ".local"-stripped form.
func legacyFormsOf(host string) []string {
	out := []string{}
	seen := map[string]bool{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	add(host)
	add(strings.TrimSuffix(host, ".local"))
	return out
}
