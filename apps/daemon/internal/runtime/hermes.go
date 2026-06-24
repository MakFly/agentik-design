package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"agentik/daemon/internal/protocol"
)

// Hermes runs the Nous Research "hermes" CLI in single-query quiet mode (`-q -Q`)
// and maps its final answer onto a task message. Like Claude it can execute
// arbitrary code, so it is hardened identically: isolated work dir, env allowlist,
// hard timeout, and process-group kill on cancel. Hermes authenticates via its own
// ~/.hermes config (provider key / OAuth), so no API key flows through the engine.
type Hermes struct {
	WorkRoot  string
	Model     string
	TimeoutMs int
}

func (Hermes) Kind() string { return "hermes" }

// stripHermesNotices drops leading CLI warning lines (e.g. the tirith security
// scanner notice) that Hermes prints to stdout before the actual answer.
func stripHermesNotices(s string) string {
	lines := strings.Split(s, "\n")
	kept := lines[:0]
	for _, l := range lines {
		t := strings.TrimSpace(l)
		if strings.HasPrefix(t, "⚠") || strings.Contains(t, "security scanner enabled but not available") {
			continue
		}
		kept = append(kept, l)
	}
	return strings.Join(kept, "\n")
}

// hermesProvider derives an isolated Hermes model config from the managed key the
// engine injected, so a run is driven entirely from keys set in the web UI — no
// `hermes auth`, no edits to the machine's ~/.hermes. Returns the provider block
// (provider/base_url/default) and the api key, or ok=false when no key is present.
func hermesProvider(env map[string]string) (provider, baseURL, model, key string, ok bool) {
	switch {
	case env["OPENAI_API_KEY"] != "":
		return "custom", "https://api.openai.com/v1", "gpt-4o-mini", env["OPENAI_API_KEY"], true
	case env["OPENROUTER_API_KEY"] != "":
		return "openrouter", "https://openrouter.ai/api/v1", "openai/gpt-4o-mini", env["OPENROUTER_API_KEY"], true
	case env["ANTHROPIC_API_KEY"] != "":
		return "anthropic", "", "claude-3-5-sonnet-latest", env["ANTHROPIC_API_KEY"], true
	case env["GOOGLE_API_KEY"] != "" || env["GEMINI_API_KEY"] != "":
		k := env["GOOGLE_API_KEY"]
		if k == "" {
			k = env["GEMINI_API_KEY"]
		}
		return "gemini", "", "gemini-2.0-flash", k, true
	}
	return "", "", "", "", false
}

// writeHermesHome materializes an isolated HERMES_HOME with a config.yaml built
// from the injected key, and returns its path (empty when no managed key, so the
// run falls back to the machine's own ~/.hermes). Quotes the key as a YAML string.
func writeHermesHome(dir string, env map[string]string) (string, string, error) {
	provider, baseURL, model, key, ok := hermesProvider(env)
	if !ok {
		return "", "", nil
	}
	home := filepath.Join(dir, "hermes-home")
	if err := os.MkdirAll(home, 0o700); err != nil {
		return "", "", err
	}
	var b strings.Builder
	b.WriteString("model:\n")
	fmt.Fprintf(&b, "  provider: %s\n", provider)
	if baseURL != "" {
		fmt.Fprintf(&b, "  base_url: %s\n", baseURL)
	}
	fmt.Fprintf(&b, "  default: %s\n", model)
	fmt.Fprintf(&b, "  api_key: %q\n", key)
	// Disable reasoning: encrypted reasoning items aren't supported by non-reasoning
	// models (e.g. gpt-4o-mini) and trip "Encrypted content is not supported".
	b.WriteString("agent:\n  reasoning_effort: \"none\"\n")
	if err := os.WriteFile(filepath.Join(home, "config.yaml"), []byte(b.String()), 0o600); err != nil {
		return "", "", err
	}
	return home, model, nil
}

// hermesMaxTurns bounds tool-calling iterations so a server-side run can't loop.
const hermesMaxTurns = "30"

// hermesEnv is the minimal environment Hermes needs: PATH/HOME to find the CLI and
// its ~/.hermes config + .env, plus any provider creds passed to the daemon.
func hermesEnv() []string {
	var env []string
	for _, k := range []string{"PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER"} {
		if v := os.Getenv(k); v != "" {
			env = append(env, k+"="+v)
		}
	}
	for _, e := range os.Environ() {
		if strings.HasPrefix(e, "HERMES_") || strings.HasPrefix(e, "OPENROUTER_") ||
			strings.HasPrefix(e, "OPENAI_") || strings.HasPrefix(e, "ANTHROPIC_") ||
			strings.HasPrefix(e, "NOUS_") || strings.HasPrefix(e, "GEMINI_") ||
			strings.HasPrefix(e, "GOOGLE_") {
			env = append(env, e)
		}
	}
	return env
}

func (c Hermes) Run(ctx context.Context, task protocol.ClaimedTask, emit Emit) (any, error) {
	var in protocol.TaskInput
	_ = json.Unmarshal(task.Input, &in)
	prompt := strings.TrimSpace(in.Prompt)
	if prompt == "" {
		return nil, fmt.Errorf("empty prompt")
	}

	// Isolated work dir, removed on completion.
	dir := filepath.Join(c.WorkRoot, task.ID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("workdir: %w", err)
	}
	defer os.RemoveAll(dir)

	timeout := 5 * time.Minute
	if c.TimeoutMs > 0 {
		timeout = time.Duration(c.TimeoutMs) * time.Millisecond
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Materialize an isolated HERMES_HOME from the org's managed key so the run is
	// driven entirely by keys set in the web UI — no `hermes auth`, no machine config.
	home, model, err := writeHermesHome(dir, task.Env)
	if err != nil {
		return nil, fmt.Errorf("hermes config: %w", err)
	}

	// `-Q` = programmatic mode (final response only, no banner/spinner); `--yolo`
	// auto-approves since there is no TTY to confirm dangerous actions on the server.
	args := []string{"chat", "-q", prompt, "-Q", "--yolo", "--max-turns", hermesMaxTurns}
	if c.Model != "" {
		args = append(args, "--model", c.Model)
	} else if model != "" {
		args = append(args, "--model", model)
	}
	cmd := exec.CommandContext(runCtx, "hermes", args...)
	cmd.Dir = dir
	cmd.Env = withTaskEnv(hermesEnv(), task.Env)
	if home != "" {
		cmd.Env = append(cmd.Env, "HERMES_HOME="+home)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // own process group
	// Kill the whole group (CLI + any children it spawned), not just the leader.
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
	cmd.WaitDelay = 5 * time.Second

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	out := strings.TrimSpace(stripHermesNotices(stdout.String()))
	if runErr != nil {
		if runCtx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("hermes timed out after %s", timeout)
		}
		if ctx.Err() == context.Canceled {
			return nil, context.Canceled
		}
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = out
		}
		return nil, fmt.Errorf("hermes exited: %v: %s", runErr, detail)
	}

	if out != "" {
		emit(protocol.TaskMessage{Type: "text", Content: out})
	}
	return map[string]any{"result": out}, nil
}
