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
// hard timeout, and process-group kill on cancel. Auth: when the engine injects a
// managed provider API key, it is written into an isolated HERMES_HOME/config.yaml;
// otherwise the run falls back to the machine's own ~/.hermes config. Note: unlike
// Codex, Hermes has no ChatGPT-OAuth path — it consumes API keys only.
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
		return "custom", "https://api.openai.com/v1", "gpt-5.4-mini", env["OPENAI_API_KEY"], true
	case env["OPENROUTER_API_KEY"] != "":
		return "openrouter", "https://openrouter.ai/api/v1", "openrouter/auto", env["OPENROUTER_API_KEY"], true
	case env["ANTHROPIC_API_KEY"] != "":
		return "anthropic", "", "claude-sonnet-4-6", env["ANTHROPIC_API_KEY"], true
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
	// Disable reasoning: encrypted reasoning items aren't supported by some routed
	// models and can trip "Encrypted content is not supported".
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

	dir, cleanup, err := taskWorkDir(c.WorkRoot, task)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	timeout := 5 * time.Minute
	if c.TimeoutMs > 0 {
		timeout = time.Duration(c.TimeoutMs) * time.Millisecond
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	configDir := dir
	if task.Workspace != nil {
		tempDir, err := os.MkdirTemp("", "agentik-hermes-home-*")
		if err != nil {
			return nil, fmt.Errorf("hermes temp home: %w", err)
		}
		defer os.RemoveAll(tempDir)
		configDir = tempDir
	}
	// Materialize an isolated HERMES_HOME from the org's managed key so the run is
	// driven entirely by keys set in the web UI — no `hermes auth`, no machine config.
	home, model, err := writeHermesHome(configDir, task.Env)
	if err != nil {
		return nil, fmt.Errorf("hermes config: %w", err)
	}

	// The agent's persona/skill is its system prompt. Hermes `chat -q` has no
	// system-prompt flag, so prepend it to the query as a delimited block.
	query := prompt
	if sp := strings.TrimSpace(in.SystemPrompt); sp != "" {
		query = sp + "\n\n---\n\n" + prompt
	}
	// `-Q` = programmatic mode (final response only, no banner/spinner); `--yolo`
	// auto-approves since there is no TTY to confirm dangerous actions on the server.
	args := []string{"chat", "-q", query, "-Q", "--yolo", "--max-turns", hermesMaxTurns}
	if m := pick(in.Model, c.Model, model); m != "" {
		args = append(args, "--model", m)
	}
	// Preload the agent's native Hermes skills (its "own skill", multica-style).
	if len(in.Skills) > 0 {
		args = append(args, "--skills", strings.Join(in.Skills, ","))
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
