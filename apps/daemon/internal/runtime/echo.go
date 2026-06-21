package runtime

import (
	"context"
	"encoding/json"
	"time"

	"agentik/daemon/internal/protocol"
)

// Echo is a SAFE scripted runtime — it spawns no process. It exists to prove the
// full register→claim→stream→complete pipe end-to-end before any real CLI exec.
type Echo struct{}

func (Echo) Kind() string { return "echo" }

func (Echo) Run(ctx context.Context, task protocol.ClaimedTask, emit Emit) (any, error) {
	var in protocol.TaskInput
	_ = json.Unmarshal(task.Input, &in)
	prompt := in.Prompt
	if prompt == "" {
		prompt = "(empty prompt)"
	}

	script := []protocol.TaskMessage{
		{Type: "thinking", Content: "Planning how to handle: " + prompt},
		{Type: "tool_use", Tool: "search", Input: map[string]any{"query": prompt}},
		{Type: "tool_result", Tool: "search", Output: "3 results found"},
		{Type: "text", Content: "Done. Echo: " + prompt},
	}

	for _, m := range script {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
		emit(m)
	}
	return map[string]any{"ok": true, "echo": prompt}, nil
}
