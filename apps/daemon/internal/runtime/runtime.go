// Package runtime defines the adapter that actually executes an agent task.
package runtime

import (
	"context"

	"agentik/daemon/internal/protocol"
)

// Emit streams one message to the engine. The loop assigns the final seq, so
// runtimes may leave TaskMessage.Seq at zero.
type Emit func(protocol.TaskMessage)

// Runtime executes a claimed task, streaming output via emit. Returning an error
// fails the task; the returned value becomes the task result. Honour ctx: when
// it is cancelled (task cancelled / timeout / shutdown), stop promptly.
type Runtime interface {
	Kind() string
	Run(ctx context.Context, task protocol.ClaimedTask, emit Emit) (any, error)
}

type ToolInvokerFunc func(ctx context.Context, taskID string, toolID string, args map[string]any) (any, error)

// ToolAware runtimes can receive a per-task tool invoker. It returns a copy so
// shared runtime registry entries are not mutated across concurrent tasks.
type ToolAware interface {
	WithToolInvoker(ToolInvokerFunc) Runtime
}

// withTaskEnv appends the engine-supplied per-task env (org provider keys) onto a
// base allowlist env. Later entries win, so a managed key overrides any inherited one.
func withTaskEnv(base []string, extra map[string]string) []string {
	for k, v := range extra {
		base = append(base, k+"="+v)
	}
	return base
}

// pick returns the first non-empty string, or "" when all are empty.
func pick(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// Registry maps a runtime kind to its adapter.
type Registry map[string]Runtime

func (r Registry) Kinds() []string {
	kinds := make([]string, 0, len(r))
	for k := range r {
		kinds = append(kinds, k)
	}
	return kinds
}
