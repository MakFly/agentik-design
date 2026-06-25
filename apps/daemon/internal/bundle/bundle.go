// Package bundle installs/upgrades/uninstalls agent CLIs on the daemon host.
//
// SECURITY: the engine never sends a command. It sends a validated {kind, action};
// this package maps that to a COMPILE-TIME sequence of installer arg-vectors from
// `registry` and execs them directly (no shell, no interpolation — even the Hermes
// curl|bash installer is split into a fixed `curl -o` + `bash` against a hardcoded
// official URL). A kind absent from the registry cannot be installed. Execution is
// hardened like the runtimes: isolated workdir, env allowlist, hard timeout,
// process-group kill.
package bundle

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"syscall"
	"time"
)

// spec holds the fixed install steps for one CLI kind. Each action is a SEQUENCE of
// arg-vectors run in order in the same workdir (stop on first error). No field is
// ever derived from engine input — they are constants selected by a validated kind.
type spec struct {
	install   [][]string
	upgrade   [][]string
	uninstall [][]string
	probe     []string // reads the installed version after the op (best-effort)
}

// hermesInstall is the official Nous installer, split to avoid a shell pipe:
// download the script to the isolated workdir, then run it. URL is a constant.
var hermesInstall = [][]string{
	{"curl", "-fsSL", "-o", "install.sh", "https://hermes-agent.nousresearch.com/install.sh"},
	{"bash", "install.sh"},
}

// registry IS the allowlist. Only these kinds are installable.
var registry = map[string]spec{
	"claude": {
		install:   [][]string{{"npm", "install", "-g", "@anthropic-ai/claude-code@latest"}},
		upgrade:   [][]string{{"npm", "install", "-g", "@anthropic-ai/claude-code@latest"}},
		uninstall: [][]string{{"npm", "uninstall", "-g", "@anthropic-ai/claude-code"}},
		probe:     []string{"claude", "--version"},
	},
	"codex": {
		install:   [][]string{{"npm", "install", "-g", "@openai/codex@latest"}},
		upgrade:   [][]string{{"npm", "install", "-g", "@openai/codex@latest"}},
		uninstall: [][]string{{"npm", "uninstall", "-g", "@openai/codex"}},
		probe:     []string{"codex", "--version"},
	},
	"hermes": {
		// The official installer is idempotent, so upgrade == install (re-run it).
		install: hermesInstall,
		upgrade: hermesInstall,
		// No supported uninstall path — left empty → reported as unavailable.
		probe: []string{"hermes", "--version"},
	},
	"gemini": {
		install:   [][]string{{"npm", "install", "-g", "@google/gemini-cli@latest"}},
		upgrade:   [][]string{{"npm", "install", "-g", "@google/gemini-cli@latest"}},
		uninstall: [][]string{{"npm", "uninstall", "-g", "@google/gemini-cli"}},
		probe:     []string{"gemini", "--version"},
	},
	"aider": {
		install:   [][]string{{"python3", "-m", "pip", "install", "--user", "--upgrade", "aider-chat"}},
		upgrade:   [][]string{{"python3", "-m", "pip", "install", "--user", "--upgrade", "aider-chat"}},
		uninstall: [][]string{{"python3", "-m", "pip", "uninstall", "-y", "aider-chat"}},
		probe:     []string{"aider", "--version"},
	},
}

// Installable lists the kinds this daemon knows how to install, for diagnostics.
func Installable() []string {
	out := make([]string, 0, len(registry))
	for k := range registry {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Execute runs the requested action for kind and returns a short result summary
// (the post-op version when available) or an error.
func Execute(ctx context.Context, kind, action, workRoot string, timeout time.Duration) (string, error) {
	sp, ok := registry[kind]
	if !ok {
		return "", fmt.Errorf("no installer registered for %q (installable: %v)", kind, Installable())
	}
	var steps [][]string
	switch action {
	case "install":
		steps = sp.install
	case "upgrade":
		steps = sp.upgrade
	case "uninstall":
		steps = sp.uninstall
	default:
		return "", fmt.Errorf("unknown action %q", action)
	}
	if len(steps) == 0 {
		return "", fmt.Errorf("action %q unavailable for %q", action, kind)
	}

	dir, cleanup, err := workdir(workRoot)
	if err != nil {
		return "", err
	}
	defer cleanup()

	out := ""
	for _, argv := range steps {
		out, err = run(ctx, dir, timeout, argv)
		if err != nil {
			return "", err
		}
	}
	// Best-effort: report the resulting version so the UI can confirm the op landed.
	if action != "uninstall" && len(sp.probe) > 0 {
		if v, e := run(ctx, dir, 10*time.Second, sp.probe); e == nil {
			if line := firstLine(v); line != "" {
				return line, nil
			}
		}
	}
	if action == "uninstall" {
		return "uninstalled", nil
	}
	return firstLine(out), nil
}

// workdir makes an isolated temp dir under workRoot and returns a cleanup func.
func workdir(workRoot string) (string, func(), error) {
	if err := os.MkdirAll(workRoot, 0o700); err != nil {
		return "", func() {}, fmt.Errorf("workroot: %w", err)
	}
	dir, err := os.MkdirTemp(workRoot, "bundle-")
	if err != nil {
		return "", func() {}, fmt.Errorf("workdir: %w", err)
	}
	return dir, func() { os.RemoveAll(dir) }, nil
}

func run(ctx context.Context, dir string, timeout time.Duration, argv []string) (string, error) {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Env = allowlistEnv()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
	cmd.WaitDelay = 5 * time.Second

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if runCtx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("%s timed out after %s", argv[0], timeout)
		}
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = strings.TrimSpace(stdout.String())
		}
		return "", fmt.Errorf("%s exited: %v: %s", argv[0], err, truncate(detail, 500))
	}
	return stdout.String(), nil
}

// allowlistEnv passes only what a package manager / installer needs — no inherited
// secrets. HOME/PATH let installers write to ~/.local and find tools.
func allowlistEnv() []string {
	var env []string
	for _, k := range []string{"PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER", "NPM_CONFIG_PREFIX"} {
		if v := os.Getenv(k); v != "" {
			env = append(env, k+"="+v)
		}
	}
	return env
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i != -1 {
		return strings.TrimSpace(s[:i])
	}
	return s
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
