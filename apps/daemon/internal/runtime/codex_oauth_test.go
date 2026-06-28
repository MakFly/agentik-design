package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteCodexHomeMaterializesAuthJSON(t *testing.T) {
	dir := t.TempDir()
	env := map[string]string{
		"AGENTIK_CODEX_AUTH": `{"access_token":"at","refresh_token":"rt","id_token":"it","account_id":"acc_1"}`,
	}
	home, err := writeCodexHome(dir, env)
	if err != nil {
		t.Fatalf("writeCodexHome: %v", err)
	}
	if home == "" {
		t.Fatal("expected an isolated home dir")
	}
	b, err := os.ReadFile(filepath.Join(home, ".codex", "auth.json"))
	if err != nil {
		t.Fatalf("read auth.json: %v", err)
	}
	var parsed struct {
		Tokens struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			AccountID    string `json:"account_id"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		t.Fatalf("unmarshal auth.json: %v", err)
	}
	if parsed.Tokens.AccessToken != "at" || parsed.Tokens.RefreshToken != "rt" || parsed.Tokens.AccountID != "acc_1" {
		t.Fatalf("unexpected tokens: %+v", parsed.Tokens)
	}
}

// TestWriteCodexHomeAuthJSONContract locks the exact auth.json shape the codex CLI
// expects. This file is reverse-engineered from the CLI (no published schema), so a
// refactor that renames/drops a field would silently break authentication at runtime
// rather than at build time. If the CLI changes its format, update this test together
// with codexPinnedVersion in bundle/bundle.go — deliberately, not by accident.
func TestWriteCodexHomeAuthJSONContract(t *testing.T) {
	dir := t.TempDir()
	env := map[string]string{
		"AGENTIK_CODEX_AUTH": `{"access_token":"at","refresh_token":"rt","id_token":"it","account_id":"acc_1"}`,
	}
	home, err := writeCodexHome(dir, env)
	if err != nil {
		t.Fatalf("writeCodexHome: %v", err)
	}
	authPath := filepath.Join(home, ".codex", "auth.json")

	info, err := os.Stat(authPath)
	if err != nil {
		t.Fatalf("stat auth.json: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("auth.json perm = %o, want 600 (tokens on disk must not be world-readable)", perm)
	}

	b, err := os.ReadFile(authPath)
	if err != nil {
		t.Fatalf("read auth.json: %v", err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatalf("unmarshal auth.json: %v", err)
	}
	for _, key := range []string{"OPENAI_API_KEY", "tokens", "last_refresh"} {
		if _, ok := doc[key]; !ok {
			t.Fatalf("auth.json missing top-level key %q (codex CLI contract)", key)
		}
	}
	if string(doc["OPENAI_API_KEY"]) != "null" {
		t.Fatalf("OPENAI_API_KEY = %s, want null (OAuth session, not an API key)", doc["OPENAI_API_KEY"])
	}
	var tokens map[string]json.RawMessage
	if err := json.Unmarshal(doc["tokens"], &tokens); err != nil {
		t.Fatalf("unmarshal tokens: %v", err)
	}
	for _, key := range []string{"id_token", "access_token", "refresh_token", "account_id"} {
		if _, ok := tokens[key]; !ok {
			t.Fatalf("tokens missing key %q (codex CLI contract)", key)
		}
	}
}

func TestWriteCodexHomeNoOAuthReturnsEmpty(t *testing.T) {
	home, err := writeCodexHome(t.TempDir(), map[string]string{})
	if err != nil {
		t.Fatalf("writeCodexHome: %v", err)
	}
	if home != "" {
		t.Fatalf("expected empty home without OAuth, got %q", home)
	}
}
