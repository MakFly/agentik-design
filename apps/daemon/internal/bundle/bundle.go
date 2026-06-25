// Package bundle installs/upgrades/uninstalls agent CLIs on the daemon host.
//
// SECURITY: the engine never sends a command. It sends a validated {kind, action};
// this package maps that to a COMPILE-TIME sequence of installer arg-vectors and
// execs them directly (no shell, no interpolation). Package names and self-update
// commands are constants; only the npm --prefix is derived from the resolved binary
// path on this host. A kind absent from the allowlist cannot be installed.
// Execution is hardened like the runtimes: isolated workdir, env allowlist, hard
// timeout, process-group kill.
package bundle

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
)

type installMethod int

const (
	methodDefault installMethod = iota
	methodBun
	methodNpmPrefix
	methodClaudeSelfUpdate
	methodPip
	methodHermesSelfUpdate
)

// cliSpec describes one installable CLI kind. Package names are compile-time constants.
type cliSpec struct {
	bin            string
	npmPkg         string
	pipPkg         string
	defaultInstall [][]string
	uninstall      [][]string
}

var hermesInstall = [][]string{
	{"curl", "-fsSL", "-o", "install.sh", "https://hermes-agent.nousresearch.com/install.sh"},
	{"bash", "install.sh", "--skip-setup"},
}

// clis IS the allowlist. Only these kinds are installable.
var clis = map[string]cliSpec{
	"claude": {
		bin:            "claude",
		npmPkg:         "@anthropic-ai/claude-code",
		defaultInstall: [][]string{{"bun", "add", "--global", "@anthropic-ai/claude-code@latest"}},
		uninstall:      [][]string{{"bun", "remove", "--global", "@anthropic-ai/claude-code"}},
	},
	"codex": {
		bin:            "codex",
		npmPkg:         "@openai/codex",
		defaultInstall: [][]string{{"bun", "add", "--global", "@openai/codex@latest"}},
		uninstall:      [][]string{{"bun", "remove", "--global", "@openai/codex"}},
	},
	"hermes": {
		bin:            "hermes",
		defaultInstall: hermesInstall,
		uninstall:      [][]string{{"hermes", "uninstall", "--yes"}},
	},
	"gemini": {
		bin:            "gemini",
		npmPkg:         "@google/gemini-cli",
		defaultInstall: [][]string{{"bun", "add", "--global", "@google/gemini-cli@latest"}},
		uninstall:      [][]string{{"bun", "remove", "--global", "@google/gemini-cli"}},
	},
}

// Installable lists the kinds this daemon knows how to install, for diagnostics.
func Installable() []string {
	out := make([]string, 0, len(clis))
	for k := range clis {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// resolveBin finds bin on PATH and returns its fully-resolved path.
func resolveBin(bin string) (real string, found bool) {
	p, err := exec.LookPath(bin)
	if err != nil {
		return "", false
	}
	real, err = filepath.EvalSymlinks(p)
	if err != nil {
		real = p
	}
	return real, true
}

// classify determines how the CLI at real was installed. Pure — no I/O.
func classify(real, kind string) (installMethod, string) {
	if real == "" {
		return methodDefault, ""
	}
	if kind == "hermes" {
		return methodHermesSelfUpdate, ""
	}
	if strings.Contains(real, "site-packages") {
		return methodPip, ""
	}
	if kind == "claude" && strings.Contains(real, "/share/claude/") {
		return methodClaudeSelfUpdate, ""
	}
	if strings.Contains(real, "/.bun/") {
		return methodBun, ""
	}
	if idx := strings.Index(real, "/lib/node_modules/"); idx != -1 {
		return methodNpmPrefix, real[:idx]
	}
	if idx := strings.Index(real, "/node_modules/"); idx != -1 {
		return methodNpmPrefix, real[:idx]
	}
	if kind == "claude" {
		return methodClaudeSelfUpdate, ""
	}
	return methodDefault, ""
}

func npmPrefixFromPath(real string) string {
	if idx := strings.Index(real, "/lib/node_modules/"); idx != -1 {
		return real[:idx]
	}
	if idx := strings.Index(real, "/node_modules/"); idx != -1 {
		return real[:idx]
	}
	return ""
}

func assertPrefixWritable(prefix string) error {
	if prefix == "" {
		return fmt.Errorf("could not derive npm prefix from resolved binary")
	}
	for _, blocked := range []string{"/usr", "/opt", "/sbin", "/bin"} {
		if prefix == blocked || strings.HasPrefix(prefix, blocked+"/") {
			return fmt.Errorf("npm prefix %q needs elevated permissions", prefix)
		}
	}
	fi, err := os.Stat(prefix)
	if err != nil {
		return fmt.Errorf("npm prefix %q: %w", prefix, err)
	}
	if !fi.IsDir() {
		return fmt.Errorf("npm prefix %q is not a directory", prefix)
	}
	// Verify we can write under prefix/lib (where npm global packages land).
	lib := filepath.Join(prefix, "lib")
	if err := os.MkdirAll(lib, 0o755); err != nil {
		return fmt.Errorf("npm prefix %q is not writable: %w", prefix, err)
	}
	return nil
}

func requireOnPath(name string) error {
	if _, err := exec.LookPath(name); err != nil {
		return fmt.Errorf("%s not found on PATH; needed for this install method", name)
	}
	return nil
}

func upgradeResolved(kind string, sp cliSpec, real string) ([][]string, error) {
	method, prefix := classify(real, kind)
	switch method {
	case methodBun:
		if sp.npmPkg == "" {
			return nil, fmt.Errorf("no bun package registered for %q", kind)
		}
		if err := requireOnPath("bun"); err != nil {
			return nil, err
		}
		return [][]string{{"bun", "add", "--global", sp.npmPkg + "@latest"}}, nil

	case methodNpmPrefix:
		if sp.npmPkg == "" {
			return nil, fmt.Errorf("no npm package registered for %q", kind)
		}
		if prefix == "" {
			prefix = npmPrefixFromPath(real)
		}
		if err := assertPrefixWritable(prefix); err != nil {
			return nil, err
		}
		if err := requireOnPath("npm"); err != nil {
			return nil, err
		}
		return [][]string{{"npm", "install", "-g", "--prefix", prefix, sp.npmPkg + "@latest"}}, nil

	case methodClaudeSelfUpdate:
		return [][]string{{"claude", "update"}}, nil

	case methodPip:
		if sp.pipPkg == "" {
			return nil, fmt.Errorf("no pip package registered for %q", kind)
		}
		if err := requireOnPath("python3"); err != nil {
			return nil, err
		}
		return [][]string{{"python3", "-m", "pip", "install", "--user", "--upgrade", sp.pipPkg}}, nil

	case methodHermesSelfUpdate:
		return [][]string{{"hermes", "update", "--yes", "--backup"}}, nil

	default:
		return sp.defaultInstall, nil
	}
}

// buildSteps returns install/upgrade/uninstall arg-vectors and the post-op probe command.
func buildSteps(kind, action string) (steps [][]string, probe []string, err error) {
	sp, ok := clis[kind]
	if !ok {
		return nil, nil, fmt.Errorf("no installer registered for %q (installable: %v)", kind, Installable())
	}
	probe = []string{sp.bin, "--version"}

	switch action {
	case "install", "upgrade":
		real, found := resolveBin(sp.bin)
		if found {
			steps, err = upgradeResolved(kind, sp, real)
			return steps, probe, err
		}
		// CLI absent — fresh install via the kind's default method.
		if len(sp.defaultInstall) == 0 {
			return nil, probe, fmt.Errorf("action %q unavailable for %q", action, kind)
		}
		return sp.defaultInstall, probe, nil

	case "uninstall":
		if len(sp.uninstall) == 0 {
			return nil, probe, fmt.Errorf("action %q unavailable for %q", action, kind)
		}
		if _, found := resolveBin(sp.bin); !found {
			// Already absent on PATH — idempotent no-op.
			return nil, probe, nil
		}
		return sp.uninstall, probe, nil

	default:
		return nil, nil, fmt.Errorf("unknown action %q", action)
	}
}

// Execute runs the requested action for kind and returns a short result summary
// (the post-op version when available) or an error.
func Execute(ctx context.Context, kind, action, workRoot string, timeout time.Duration) (string, error) {
	steps, probe, err := buildSteps(kind, action)
	if err != nil {
		return "", err
	}

	dir, cleanup, err := workdir(workRoot)
	if err != nil {
		return "", err
	}
	defer cleanup()

	before := ""
	if action == "upgrade" && len(probe) > 0 {
		if v, e := run(ctx, dir, 10*time.Second, probe); e == nil {
			before = firstLine(v)
		}
		if before != "" {
			if ui := UpgradeInfoFor(kind, before); ui.Checked && !ui.UpdateAvailable {
				return "already latest: " + before, nil
			}
		}
	}

	out := ""
	for _, argv := range steps {
		out, err = run(ctx, dir, timeout, argv)
		if err != nil {
			return "", err
		}
	}

	after := ""
	if action != "uninstall" && len(probe) > 0 {
		if v, e := run(ctx, dir, 10*time.Second, probe); e == nil {
			after = firstLine(v)
			if after != "" {
				if action == "upgrade" && before != "" && extractSemver(before) == extractSemver(after) {
					InvalidateUpgradeCache(kind)
					return "already latest: " + after, nil
				}
				InvalidateUpgradeCache(kind)
				return after, nil
			}
		}
	}
	if action == "uninstall" {
		InvalidateUpgradeCache(kind)
		return "uninstalled", nil
	}
	if action == "install" || action == "upgrade" {
		InvalidateUpgradeCache(kind)
	}
	return firstLine(out), nil
}

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
	if devNull, err := os.Open(os.DevNull); err == nil {
		cmd.Stdin = devNull
		defer devNull.Close()
	}
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

func allowlistEnv() []string {
	var env []string
	for _, k := range []string{
		"PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER", "NPM_CONFIG_PREFIX",
		"CI", "DEBIAN_FRONTEND", "HERMES_HOME", "BUN_INSTALL",
	} {
		if v := os.Getenv(k); v != "" {
			env = append(env, k+"="+v)
		}
	}
	// Non-interactive defaults for unattended bundle installs.
	if os.Getenv("CI") == "" {
		env = append(env, "CI=1")
	}
	if os.Getenv("DEBIAN_FRONTEND") == "" {
		env = append(env, "DEBIAN_FRONTEND=noninteractive")
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
