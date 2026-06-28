package runtime

import (
	"bufio"
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

// Codex runs OpenAI's "codex" CLI non-interactively (`codex exec`). Like the other
// real runtimes it is hardened: isolated work dir, env allowlist, hard timeout, and
// process-group kill on cancel. Auth precedence: subscription OAuth injected by the
// engine (AGENTIK_CODEX_AUTH → an isolated ~/.codex/auth.json) wins; otherwise the
// run falls back to the machine's own ~/.codex session or an injected OPENAI_API_KEY.
type Codex struct {
	WorkRoot  string
	Model     string
	TimeoutMs int
}

func (Codex) Kind() string { return "codex" }

// codexEnv is the minimal environment Codex needs: PATH/HOME to find the CLI and its
// ~/.codex auth, plus any OpenAI/Codex creds the engine injected for this task.
func codexEnv() []string {
	var env []string
	for _, k := range []string{"PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER"} {
		if v := os.Getenv(k); v != "" {
			env = append(env, k+"="+v)
		}
	}
	for _, e := range os.Environ() {
		if strings.HasPrefix(e, "OPENAI_") || strings.HasPrefix(e, "CODEX_") {
			env = append(env, e)
		}
	}
	return env
}

// writeCodexHome materializes an isolated HOME with a ~/.codex/auth.json built
// from the subscription OAuth tokens the engine injected (AGENTIK_CODEX_AUTH), so
// a run authenticates from the team's connected ChatGPT account instead of the
// machine's own ~/.codex. Returns the home path (empty when no OAuth was injected,
// so the run falls back to the machine session or OPENAI_API_KEY).
func writeCodexHome(dir string, env map[string]string) (string, error) {
	raw := env["AGENTIK_CODEX_AUTH"]
	if raw == "" {
		return "", nil
	}
	var blob struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		IDToken      string `json:"id_token"`
		AccountID    string `json:"account_id"`
	}
	if err := json.Unmarshal([]byte(raw), &blob); err != nil {
		return "", fmt.Errorf("parse codex oauth: %w", err)
	}
	if blob.AccessToken == "" {
		return "", nil
	}
	home := filepath.Join(dir, "codex-home")
	codexDir := filepath.Join(home, ".codex")
	if err := os.MkdirAll(codexDir, 0o700); err != nil {
		return "", err
	}
	authFile := map[string]any{
		"OPENAI_API_KEY": nil,
		"tokens": map[string]any{
			"id_token":      blob.IDToken,
			"access_token":  blob.AccessToken,
			"refresh_token": blob.RefreshToken,
			"account_id":    blob.AccountID,
		},
		"last_refresh": time.Now().UTC().Format(time.RFC3339),
	}
	b, err := json.Marshal(authFile)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(codexDir, "auth.json"), b, 0o600); err != nil {
		return "", err
	}
	return home, nil
}

func (c Codex) Run(ctx context.Context, task protocol.ClaimedTask, emit Emit) (any, error) {
	var in protocol.TaskInput
	_ = json.Unmarshal(task.Input, &in)
	prompt := strings.TrimSpace(in.Prompt)
	if prompt == "" {
		return nil, fmt.Errorf("empty prompt")
	}
	// The agent's persona/skill is its system prompt. `codex exec` has no system-prompt
	// flag, so prepend it to the prompt as a delimited block.
	if sp := strings.TrimSpace(in.SystemPrompt); sp != "" {
		prompt = sp + "\n\n---\n\n" + prompt
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

	// `-o` captures Codex's final assistant message without truncation while `--json`
	// streams progress events we can persist as the run timeline.
	lastMsgFile, err := os.CreateTemp("", "agentik-codex-last-message-*")
	if err != nil {
		return nil, fmt.Errorf("codex output file: %w", err)
	}
	lastMsg := lastMsgFile.Name()
	_ = lastMsgFile.Close()
	defer os.Remove(lastMsg)
	args := []string{"exec", "--sandbox", "danger-full-access", "--skip-git-repo-check", "--color", "never", "--json", "-o", lastMsg}
	if m := pick(in.Model, c.Model); m != "" {
		args = append(args, "-m", m)
	}
	// Pass the prompt on stdin (codex reads instructions from stdin when the prompt
	// arg is "-"). Robust to personas/prompts that begin with "-", which as a bare
	// positional argument codex would otherwise misparse as an unknown flag.
	args = append(args, "-")

	// Materialize the team's connected ChatGPT session into an isolated HOME when
	// the engine injected subscription OAuth; otherwise keep the machine session.
	codexHome, err := writeCodexHome(dir, task.Env)
	if err != nil {
		return nil, fmt.Errorf("codex auth: %w", err)
	}

	cmd := exec.CommandContext(runCtx, "codex", args...)
	cmd.Dir = dir
	cmd.Env = withTaskEnv(codexEnv(), task.Env)
	if codexHome != "" {
		cmd.Env = append(cmd.Env, "HOME="+codexHome)
	}
	cmd.Stdin = strings.NewReader(prompt)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // own process group
	// Kill the whole group (CLI + any children it spawned), not just the leader.
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
	cmd.WaitDelay = 5 * time.Second

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("spawn codex: %w", err)
	}

	var stdoutFallback bytes.Buffer
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		stdoutFallback.WriteString(line)
		stdoutFallback.WriteByte('\n')
		emitCodexEvent(line, emit)
	}
	if err := sc.Err(); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, fmt.Errorf("read codex output: %w", err)
	}

	runErr := cmd.Wait()
	out := strings.TrimSpace(readFileOr(lastMsg, stdoutFallback.String()))
	if runErr != nil {
		if runCtx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("codex timed out after %s", timeout)
		}
		if ctx.Err() == context.Canceled {
			return nil, context.Canceled
		}
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = out
		}
		return nil, fmt.Errorf("codex exited: %v: %s", runErr, detail)
	}

	if out != "" {
		emit(protocol.TaskMessage{Type: "text", Content: out})
	}
	return map[string]any{"result": out}, nil
}

func emitCodexEvent(line string, emit Emit) {
	var ev map[string]any
	if json.Unmarshal([]byte(line), &ev) != nil {
		emit(protocol.TaskMessage{Type: "thinking", Content: truncateCodexLine(line, 2_000)})
		return
	}
	typ, _ := ev["type"].(string)
	if typ == "" {
		return
	}
	lower := strings.ToLower(typ)
	switch {
	case strings.Contains(lower, "exec") && (strings.Contains(lower, "begin") || strings.Contains(lower, "start")):
		emit(protocol.TaskMessage{Type: "tool_use", Tool: "shell", Input: codexEventPayload(ev)})
	case strings.Contains(lower, "exec") && (strings.Contains(lower, "end") || strings.Contains(lower, "complete")):
		emit(protocol.TaskMessage{Type: "tool_result", Tool: "shell", Output: codexEventPayload(ev)})
	case strings.Contains(lower, "error"):
		emit(protocol.TaskMessage{Type: "error", Content: codexEventText(ev, typ)})
	case strings.Contains(lower, "turn") || strings.Contains(lower, "task") || strings.Contains(lower, "session"):
		emit(protocol.TaskMessage{Type: "thinking", Content: codexEventText(ev, typ)})
	}
}

func codexEventPayload(ev map[string]any) any {
	if cmd, ok := findString(ev, "command", "cmd"); ok {
		return map[string]any{"command": cmd}
	}
	return ev
}

func codexEventText(ev map[string]any, fallback string) string {
	if text, ok := findString(ev, "message", "text", "summary", "status"); ok {
		return truncateCodexLine(text, 2_000)
	}
	if b, err := json.Marshal(ev); err == nil {
		return truncateCodexLine(string(b), 2_000)
	}
	return fallback
}

func findString(v any, keys ...string) (string, bool) {
	switch x := v.(type) {
	case map[string]any:
		for _, key := range keys {
			if s, ok := x[key].(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s), true
			}
		}
		for _, child := range x {
			if s, ok := findString(child, keys...); ok {
				return s, true
			}
		}
	case []any:
		for _, child := range x {
			if s, ok := findString(child, keys...); ok {
				return s, true
			}
		}
	}
	return "", false
}

func truncateCodexLine(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// readFileOr returns the trimmed file contents, or the fallback when the file is
// missing or empty (Codex writes its final message to the -o file on success).
func readFileOr(path, fallback string) string {
	if b, err := os.ReadFile(path); err == nil {
		if s := strings.TrimSpace(string(b)); s != "" {
			return s
		}
	}
	return fallback
}
