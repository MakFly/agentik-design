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
	ID        string            `json:"id"`
	TeamID    string            `json:"teamId"`
	AgentID   string            `json:"agentId"`
	ProjectID string            `json:"projectId,omitempty"`
	Kind      string            `json:"kind"`
	Input     json.RawMessage   `json:"input"`
	WorkDir   string            `json:"workDir"`
	Workspace *WorkspaceRef     `json:"workspace,omitempty"`
	Env       map[string]string `json:"env,omitempty"` // org provider keys, merged into the runtime env
}

type WorkspaceRef struct {
	ID         string `json:"id"`
	ProjectID  string `json:"projectId"`
	ResourceID string `json:"resourceId"`
	Type       string `json:"type"` // git_repo | local_dir
	Ref        string `json:"ref"`
	Branch     string `json:"branch,omitempty"`
	Path       string `json:"path"`
}

// TaskInput is the shape stored in agent_tasks.input. The engine folds the agent's
// live-version config into it at claim time: Prompt carries the (learned-context
// preamble + user) text, SystemPrompt the agent's instructions/persona, Model its
// model, and Skills any native runtime skills (e.g. hermes --skills) to preload.
type TaskInput struct {
	Prompt       string          `json:"prompt"`
	SystemPrompt string          `json:"systemPrompt,omitempty"`
	Model        string          `json:"model,omitempty"`
	Skills       []string        `json:"skills,omitempty"`
	Approval     *ApprovalPolicy `json:"approval,omitempty"`
}

type ApprovalPolicy struct {
	RequiresApproval bool     `json:"requiresApproval,omitempty"`
	Approved         bool     `json:"approved,omitempty"`
	Message          string   `json:"message,omitempty"`
	Risks            []string `json:"risks,omitempty"`
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

type WorkspaceStatusRequest struct {
	Status string         `json:"status"` // pending | ready | syncing | error
	Path   string         `json:"path,omitempty"`
	Error  string         `json:"error,omitempty"`
	Meta   map[string]any `json:"meta,omitempty"`
}

type ApprovalRequest struct {
	Message string         `json:"message"`
	Context map[string]any `json:"context,omitempty"`
}

// BundleCommand is returned by the bundle claim endpoint (204 → nothing queued).
// The engine sends only a validated {kind, action} — never a shell command.
type BundleCommand struct {
	ID     string `json:"id"`
	TeamID string `json:"teamId"`
	Kind   string `json:"kind"`
	Action string `json:"action"` // install | upgrade | uninstall
}

type BundleStatusRequest struct {
	Status string `json:"status"` // done | failed
	Result string `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

// MetaRequest refreshes a daemon's probed CLIs/host without touching its runtimes.
type MetaRequest struct {
	DaemonID string         `json:"daemonId"`
	Meta     map[string]any `json:"meta"`
}

// OrgRef is one org a personal (user-scoped) daemon may serve.
type OrgRef struct {
	TeamID string `json:"teamId"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
}

type OrgsResponse struct {
	Orgs []OrgRef `json:"orgs"`
}
