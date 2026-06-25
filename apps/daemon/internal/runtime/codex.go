package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"agentik/daemon/internal/protocol"
)

// Codex runs OpenAI's "codex" CLI non-interactively (`codex exec`). Like the other
// real runtimes it is hardened: isolated work dir, env allowlist, hard timeout, and
// process-group kill on cancel. Codex authenticates from its own ~/.codex session
// (or an injected OPENAI_API_KEY), so no key has to flow from the engine.
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

	// `-o` captures only Codex's final assistant message (clean result, no transcript
	// noise). `--skip-git-repo-check` lets it run in the throwaway work dir; the
	// `danger-full-access` sandbox is required because Codex's own bubblewrap sandbox
	// fails in a headless service context (the daemon already isolates the work dir).
	lastMsgFile, err := os.CreateTemp("", "agentik-codex-last-message-*")
	if err != nil {
		return nil, fmt.Errorf("codex output file: %w", err)
	}
	lastMsg := lastMsgFile.Name()
	_ = lastMsgFile.Close()
	defer os.Remove(lastMsg)
	args := []string{"exec", "--sandbox", "danger-full-access", "--skip-git-repo-check", "--color", "never", "-o", lastMsg}
	if m := pick(in.Model, c.Model); m != "" {
		args = append(args, "-m", m)
	}
	// Pass the prompt on stdin (codex reads instructions from stdin when the prompt
	// arg is "-"). Robust to personas/prompts that begin with "-", which as a bare
	// positional argument codex would otherwise misparse as an unknown flag.
	args = append(args, "-")

	cmd := exec.CommandContext(runCtx, "codex", args...)
	cmd.Dir = dir
	cmd.Env = withTaskEnv(codexEnv(), task.Env)
	cmd.Stdin = strings.NewReader(prompt)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // own process group
	// Kill the whole group (CLI + any children it spawned), not just the leader.
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
	cmd.WaitDelay = 5 * time.Second

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr := cmd.Run()
	out := strings.TrimSpace(readFileOr(lastMsg, stdout.String()))
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
