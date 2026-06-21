// Package protocol mirrors the engine's /daemon JSON contract. The daemon talks
// to the engine only over HTTP+JSON, so these structs are the single coupling
// point — keep them in sync with apps/engine/src/daemon-{routes,repo}.ts.
package protocol

import "encoding/json"

type Capabilities struct {
	MaxConcurrent int      `json:"maxConcurrent,omitempty"`
	AgentKinds    []string `json:"agentKinds,omitempty"`
}

type RegisterRuntime struct {
	Kind         string        `json:"kind"`
	Capabilities *Capabilities `json:"capabilities,omitempty"`
}

type RegisterRequest struct {
	Team     string            `json:"team"`
	Name     string            `json:"name"`
	Meta     map[string]any    `json:"meta,omitempty"`
	Runtimes []RegisterRuntime `json:"runtimes"`
}

type RegisteredRuntime struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}

type RegisterResponse struct {
	DaemonID string              `json:"daemonId"`
	TeamID   string              `json:"teamId"`
	Runtimes []RegisteredRuntime `json:"runtimes"`
}

type HeartbeatRequest struct {
	DaemonID string `json:"daemonId"`
}

// ClaimedTask is returned by the claim endpoint (204 → no task available).
type ClaimedTask struct {
	ID      string          `json:"id"`
	TeamID  string          `json:"teamId"`
	AgentID string          `json:"agentId"`
	Kind    string          `json:"kind"`
	Input   json.RawMessage `json:"input"`
	WorkDir string          `json:"workDir"`
}

// TaskInput is the shape stored in agent_tasks.input by /agents/test.
type TaskInput struct {
	Prompt string `json:"prompt"`
}

// TaskMessage is one streamed unit of agent output.
type TaskMessage struct {
	Seq     int    `json:"seq"`
	Type    string `json:"type"` // text | thinking | tool_use | tool_result | error
	Tool    string `json:"tool,omitempty"`
	Content string `json:"content,omitempty"`
	Input   any    `json:"input,omitempty"`
	Output  any    `json:"output,omitempty"`
}

type MessagesRequest struct {
	Messages []TaskMessage `json:"messages"`
}

type MessagesResponse struct {
	Cancel bool `json:"cancel"`
}

type CompleteRequest struct {
	Result any `json:"result,omitempty"`
}

type FailRequest struct {
	Error string `json:"error"`
}
