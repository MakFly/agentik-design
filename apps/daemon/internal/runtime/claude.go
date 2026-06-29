package runtime

import (
	"bufio"
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

// Claude spawns the Claude Code CLI in stream-json mode and maps its event
// stream onto task messages. This is the only runtime that executes arbitrary
// code, so it is hardened: isolated work dir, env allowlist, hard timeout, and
// process-group kill on cancel.
type Claude struct {
	WorkRoot  string
	Model     string
	TimeoutMs int
}

func (Claude) Kind() string { return "claude" }

// allowlistEnv builds a minimal environment. We never inherit the daemon's full
// env (which may carry DB creds); we pass only what the CLI needs. HOME lets the
// CLI find its own auth session (~/.claude), so no API key is required.
func allowlistEnv() []string {
	var env []string
	for _, k := range []string{"PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER"} {
		if v := os.Getenv(k); v != "" {
			env = append(env, k+"="+v)
		}
	}
	for _, e := range os.Environ() {
		if strings.HasPrefix(e, "ANTHROPIC_") || strings.HasPrefix(e, "CLAUDE_") {
			env = append(env, e)
		}
	}
	return env
}

type claudeBlock struct {
	Type     string          `json:"type"`
	Text     string          `json:"text"`
	Thinking string          `json:"thinking"`
	Name     string          `json:"name"`
	Input    json.RawMessage `json:"input"`
	Content  json.RawMessage `json:"content"`
}

type claudeEvent struct {
	Type    string `json:"type"`
	Subtype string `json:"subtype"`
	Message struct {
		Content []claudeBlock `json:"content"`
	} `json:"message"`
	Result  string `json:"result"`
	IsError bool   `json:"is_error"`
	Usage   struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	TotalCostUSD float64 `json:"total_cost_usd"`
}

func claudeArgs(in protocol.TaskInput, fallbackModel string) []string {
	prompt := strings.TrimSpace(in.Prompt)
	args := []string{"-p", prompt, "--output-format", "stream-json", "--verbose"}
	// The agent's persona/skill is its system prompt: append it so the CLI's built-in
	// capabilities are preserved (an autonomous agent with its own skill).
	if sp := strings.TrimSpace(in.SystemPrompt); sp != "" {
		args = append(args, "--append-system-prompt", sp)
	}
	if model := pick(in.Model, fallbackModel); model != "" {
		args = append(args, "--model", model)
	}
	return args
}

func (c Claude) Run(ctx context.Context, task protocol.ClaimedTask, emit Emit) (any, error) {
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

	args := claudeArgs(in, c.Model)
	cmd := exec.CommandContext(runCtx, "claude", args...)
	cmd.Dir = dir
	cmd.Env = withTaskEnv(allowlistEnv(), task.Env)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // own process group
	// Kill the whole group (CLI + any children it spawned), not just the leader.
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
	cmd.WaitDelay = 5 * time.Second

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("spawn claude: %w", err)
	}

	var result any
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 1<<20), 16<<20) // tolerate large NDJSON lines
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev claudeEvent
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		switch ev.Type {
		case "assistant":
			for _, b := range ev.Message.Content {
				switch b.Type {
				case "text":
					if b.Text != "" {
						emit(protocol.TaskMessage{Type: "text", Content: b.Text})
					}
				case "thinking":
					if b.Thinking != "" {
						emit(protocol.TaskMessage{Type: "thinking", Content: b.Thinking})
					}
				case "tool_use":
					emit(protocol.TaskMessage{Type: "tool_use", Tool: b.Name, Input: rawToAny(b.Input)})
				}
			}
		case "user":
			for _, b := range ev.Message.Content {
				if b.Type == "tool_result" {
					emit(protocol.TaskMessage{Type: "tool_result", Tool: b.Name, Output: rawToAny(b.Content)})
				}
			}
		case "result":
			// Surface real token usage + cost so the engine reports true cost
			// (not a hardcoded zero). Runtimes that omit these → cost 0.
			result = map[string]any{
				"result":   ev.Result,
				"is_error": ev.IsError,
				"usage":    map[string]any{"input_tokens": ev.Usage.InputTokens, "output_tokens": ev.Usage.OutputTokens},
				"cost_usd": ev.TotalCostUSD,
			}
			if ev.IsError && ev.Result != "" {
				emit(protocol.TaskMessage{Type: "error", Content: ev.Result})
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		if runCtx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("claude timed out after %s", timeout)
		}
		if ctx.Err() == context.Canceled {
			return nil, context.Canceled
		}
		return nil, fmt.Errorf("claude exited: %w", err)
	}
	return result, nil
}

func rawToAny(r json.RawMessage) any {
	if len(r) == 0 {
		return nil
	}
	var v any
	if json.Unmarshal(r, &v) != nil {
		return string(r)
	}
	return v
}
