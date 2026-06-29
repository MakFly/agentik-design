package runtime

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHermesProviderPrefersManagedOpenAIKey(t *testing.T) {
	provider, baseURL, model, key, ok := hermesProvider(map[string]string{
		"OPENAI_API_KEY": "sk-managed",
	})
	if !ok {
		t.Fatal("expected managed key to configure Hermes")
	}
	if provider != "custom" || baseURL != "https://api.openai.com/v1" || model != "gpt-5.4-mini" || key != "sk-managed" {
		t.Fatalf("unexpected provider config: provider=%q baseURL=%q model=%q key=%q", provider, baseURL, model, key)
	}
}

func TestWriteHermesHomeMaterializesIsolatedConfig(t *testing.T) {
	home, model, err := writeHermesHome(t.TempDir(), map[string]string{
		"ANTHROPIC_API_KEY": "an-managed",
	})
	if err != nil {
		t.Fatalf("writeHermesHome: %v", err)
	}
	if home == "" {
		t.Fatal("expected isolated HERMES_HOME")
	}
	if model != "claude-sonnet-4-6" {
		t.Fatalf("model = %q", model)
	}

	configPath := filepath.Join(home, "config.yaml")
	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatalf("stat config.yaml: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("config.yaml perm = %o, want 600", perm)
	}
	b, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config.yaml: %v", err)
	}
	config := string(b)
	for _, want := range []string{
		"provider: anthropic",
		"default: claude-sonnet-4-6",
		`api_key: "an-managed"`,
		`reasoning_effort: "none"`,
	} {
		if !strings.Contains(config, want) {
			t.Fatalf("config.yaml missing %q:\n%s", want, config)
		}
	}
}

func TestWriteHermesHomeNoManagedKeyFallsBackToMachineConfig(t *testing.T) {
	home, model, err := writeHermesHome(t.TempDir(), map[string]string{})
	if err != nil {
		t.Fatalf("writeHermesHome: %v", err)
	}
	if home != "" || model != "" {
		t.Fatalf("expected no isolated config without managed key, got home=%q model=%q", home, model)
	}
}

func TestStripHermesNoticesKeepsAnswer(t *testing.T) {
	got := stripHermesNotices("⚠ security scanner enabled but not available\nFinal answer\n")
	if strings.TrimSpace(got) != "Final answer" {
		t.Fatalf("stripHermesNotices = %q", got)
	}
}
