package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureLayoutCreatesMirror(t *testing.T) {
	base := t.TempDir()
	created, err := EnsureLayout(base)
	if err != nil {
		t.Fatalf("EnsureLayout() error = %v", err)
	}
	if len(created) == 0 {
		t.Fatal("expected files to be created on a fresh base dir")
	}

	want := []string{
		"config.yaml",
		filepath.Join("cron", "jobs.json"),
		filepath.Join("workspace", "SOUL.md"),
		filepath.Join("workspace", "USER.md"),
		filepath.Join("workspace", "AGENTS.md"),
		filepath.Join("workspace", "HEARTBEAT.md"),
		filepath.Join("workspace", "MEMORY.md"),
	}
	for _, rel := range want {
		if _, err := os.Stat(filepath.Join(base, rel)); err != nil {
			t.Errorf("expected %s to exist: %v", rel, err)
		}
	}
	for _, dir := range []string{"credentials", "memory"} {
		if info, err := os.Stat(filepath.Join(base, dir)); err != nil || !info.IsDir() {
			t.Errorf("expected dir %s: %v", dir, err)
		}
	}
}

func TestEnsureLayoutIsIdempotent(t *testing.T) {
	base := t.TempDir()
	if _, err := EnsureLayout(base); err != nil {
		t.Fatalf("first EnsureLayout() error = %v", err)
	}
	// Operator edits a workspace file by hand.
	soul := filepath.Join(base, "workspace", "SOUL.md")
	if err := os.WriteFile(soul, []byte("edited by hand"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	created, err := EnsureLayout(base)
	if err != nil {
		t.Fatalf("second EnsureLayout() error = %v", err)
	}
	if len(created) != 0 {
		t.Fatalf("expected no new files on second run, got %v", created)
	}
	b, err := os.ReadFile(soul)
	if err != nil || string(b) != "edited by hand" {
		t.Fatalf("hand edit was overwritten: %q (%v)", string(b), err)
	}
}

func TestEnsureLayoutMigratesLegacy(t *testing.T) {
	// Point the legacy resolver at a temp ~/.config via XDG_CONFIG_HOME.
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)
	legacy := filepath.Join(xdg, "agentik")
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatalf("mkdir legacy: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "config.json"), []byte(`{"token":"dtkn_old"}`), 0o600); err != nil {
		t.Fatalf("write legacy config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "daemon.id"), []byte("legacy-id\n"), 0o600); err != nil {
		t.Fatalf("write legacy id: %v", err)
	}

	base := t.TempDir() // distinct from legacy
	if _, err := EnsureLayout(base); err != nil {
		t.Fatalf("EnsureLayout() error = %v", err)
	}

	if b, err := os.ReadFile(filepath.Join(base, "agentik.json")); err != nil || string(b) != `{"token":"dtkn_old"}` {
		t.Fatalf("config not migrated: %q (%v)", string(b), err)
	}
	if b, err := os.ReadFile(filepath.Join(base, "daemon.id")); err != nil || string(b) != "legacy-id\n" {
		t.Fatalf("daemon.id not migrated: %q (%v)", string(b), err)
	}
}
