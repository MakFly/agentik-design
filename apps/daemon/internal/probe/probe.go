// Package probe detects which agent CLIs and tools are actually available on the
// daemon host, so the UI can show "who/what/how" we really have access to.
package probe

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type Tool struct {
	Name      string `json:"name"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	Available bool   `json:"available"`
	// Authenticated is true when the CLI already has usable credentials on this host
	// (a saved session file or a relevant API key in the env) — i.e. it can run without
	// the user logging in first. Meaningful only when Available.
	Authenticated bool `json:"authenticated"`
	// AuthSource explains how: "session" (saved login on disk) or "key" (env var).
	AuthSource string `json:"authSource,omitempty"`
}

// Known agent CLIs the daemon can potentially drive. Extend as runtimes are added.
var knownCLIs = []string{"claude", "hermes", "codex", "aider", "goose", "gemini"}

// authSpec describes how to tell whether a CLI is already authenticated on this host:
// any of `files` (relative to $HOME) existing, or any of `env` vars being set.
type authSpec struct {
	files []string
	env   []string
}

var authSpecs = map[string]authSpec{
	"claude": {files: []string{".claude.json", ".claude/.credentials.json"}, env: []string{"ANTHROPIC_API_KEY"}},
	"codex":  {files: []string{".codex/auth.json"}, env: []string{"OPENAI_API_KEY"}},
	"hermes": {files: []string{".hermes/auth.json", ".hermes/config.yaml", ".config/hermes/config.yaml"}, env: []string{"NOUS_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"}},
	"gemini": {files: []string{".gemini/oauth_creds.json", ".config/gemini/oauth_creds.json"}, env: []string{"GEMINI_API_KEY", "GOOGLE_API_KEY"}},
	"aider":  {env: []string{"OPENAI_API_KEY", "ANTHROPIC_API_KEY"}},
}

// Tools probes each known CLI via LookPath + `--version`, and (when present) whether
// it is already authenticated on this host.
func Tools() []Tool {
	out := make([]Tool, 0, len(knownCLIs))
	for _, name := range knownCLIs {
		t := Tool{Name: name}
		if p, err := exec.LookPath(name); err == nil {
			t.Available = true
			t.Path = p
			t.Version = version(name)
			t.Authenticated, t.AuthSource = authStatus(name)
		}
		out = append(out, t)
	}
	return out
}

// authStatus reports whether a CLI already has usable credentials on this host.
func authStatus(name string) (bool, string) {
	spec, ok := authSpecs[name]
	if !ok {
		return false, ""
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		for _, f := range spec.files {
			if _, err := os.Stat(filepath.Join(home, f)); err == nil {
				return true, "session"
			}
		}
	}
	for _, e := range spec.env {
		if os.Getenv(e) != "" {
			return true, "key"
		}
	}
	return false, ""
}

func version(name string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, "--version").Output()
	if err != nil {
		return ""
	}
	line := strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0]
	return line
}

// Host returns identifying info about the daemon host.
func Host() map[string]any {
	h, _ := os.Hostname()
	return map[string]any{
		"host": h,
		"os":   runtime.GOOS,
		"arch": runtime.GOARCH,
		"go":   runtime.Version(),
	}
}
