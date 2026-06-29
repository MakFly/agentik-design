package config

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadRequiresExactlyOneAuthMode(t *testing.T) {
	t.Setenv("DAEMON_AUTH_TOKEN", "")
	t.Setenv("DAEMON_USER_TOKEN", "")
	if _, err := LoadWithOptions(Options{SkipConfigFile: true}); err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("expected exactly-one auth error, got %v", err)
	}

	t.Setenv("DAEMON_AUTH_TOKEN", "org-token")
	t.Setenv("DAEMON_USER_TOKEN", "user-token")
	if _, err := LoadWithOptions(Options{SkipConfigFile: true}); err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("expected mixed auth error, got %v", err)
	}
}

func TestLoadPersonalMode(t *testing.T) {
	t.Setenv("DAEMON_AUTH_TOKEN", "")
	t.Setenv("DAEMON_USER_TOKEN", "user-token")
	t.Setenv("RUNTIME_KINDS", "codex, claude")
	t.Setenv("DAEMON_MAX_CONCURRENCY", "3")

	cfg, err := LoadWithOptions(Options{SkipConfigFile: true})
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.UserToken != "user-token" || cfg.AuthToken != "" {
		t.Fatalf("unexpected auth fields: user=%q org=%q", cfg.UserToken, cfg.AuthToken)
	}
	if got := strings.Join(cfg.RuntimeKinds, ","); got != "codex,claude" {
		t.Fatalf("runtime kinds = %q", got)
	}
	if cfg.MaxConcurrent != 3 {
		t.Fatalf("max concurrent = %d", cfg.MaxConcurrent)
	}
}

func TestLoadRejectsInvalidConcurrency(t *testing.T) {
	t.Setenv("DAEMON_AUTH_TOKEN", "org-token")
	t.Setenv("DAEMON_USER_TOKEN", "")
	t.Setenv("DAEMON_MAX_CONCURRENCY", "0")
	if _, err := LoadWithOptions(Options{SkipConfigFile: true}); err == nil || !strings.Contains(err.Error(), "DAEMON_MAX_CONCURRENCY") {
		t.Fatalf("expected concurrency error, got %v", err)
	}
}

func TestLoadReadsPersonalConfigFile(t *testing.T) {
	t.Setenv("DAEMON_AUTH_TOKEN", "")
	t.Setenv("DAEMON_USER_TOKEN", "")
	path := filepath.Join(t.TempDir(), "config.json")
	if err := SaveFile(path, File{
		EngineURL:      "https://engine.example",
		Token:          "dtkn_file",
		Runtimes:       []string{"codex", "claude"},
		WorkRoot:       "/tmp/agentik-file",
		MaxConcurrency: 4,
	}); err != nil {
		t.Fatalf("SaveFile() error = %v", err)
	}

	cfg, err := LoadWithOptions(Options{ConfigPath: path})
	if err != nil {
		t.Fatalf("LoadWithOptions() error = %v", err)
	}
	if cfg.EngineURL != "https://engine.example" || cfg.UserToken != "dtkn_file" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if got := strings.Join(cfg.RuntimeKinds, ","); got != "codex,claude" {
		t.Fatalf("runtime kinds = %q", got)
	}
	if cfg.WorkRoot != "/tmp/agentik-file" || cfg.MaxConcurrent != 4 {
		t.Fatalf("unexpected runtime settings: %+v", cfg)
	}
}

func TestLoadOptionOverridesConfigFile(t *testing.T) {
	t.Setenv("DAEMON_AUTH_TOKEN", "")
	t.Setenv("DAEMON_USER_TOKEN", "")
	path := filepath.Join(t.TempDir(), "config.json")
	if err := SaveFile(path, File{
		EngineURL: "https://engine.example",
		Token:     "dtkn_file",
		Runtimes:  []string{"claude"},
	}); err != nil {
		t.Fatalf("SaveFile() error = %v", err)
	}

	cfg, err := LoadWithOptions(Options{
		ConfigPath:   path,
		EngineURL:    "http://localhost:9999",
		UserToken:    "dtkn_opt",
		RuntimeKinds: "claude,hermes",
	})
	if err != nil {
		t.Fatalf("LoadWithOptions() error = %v", err)
	}
	if cfg.EngineURL != "http://localhost:9999" || cfg.UserToken != "dtkn_opt" {
		t.Fatalf("options did not override file: %+v", cfg)
	}
	if got := strings.Join(cfg.RuntimeKinds, ","); got != "claude,hermes" {
		t.Fatalf("runtime kinds = %q", got)
	}
}
