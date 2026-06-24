// Package probe detects which agent CLIs and tools are actually available on the
// daemon host, so the UI can show "who/what/how" we really have access to.
package probe

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type Tool struct {
	Name      string `json:"name"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	Available bool   `json:"available"`
}

// Known agent CLIs the daemon can potentially drive. Extend as runtimes are added.
var knownCLIs = []string{"claude", "hermes", "codex", "aider", "goose", "gemini"}

// Tools probes each known CLI via LookPath + `--version`.
func Tools() []Tool {
	out := make([]Tool, 0, len(knownCLIs))
	for _, name := range knownCLIs {
		t := Tool{Name: name}
		if p, err := exec.LookPath(name); err == nil {
			t.Available = true
			t.Path = p
			t.Version = version(name)
		}
		out = append(out, t)
	}
	return out
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
