// Package loop drives the daemon: register → heartbeat → claim → execute.
package loop

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"agentik/daemon/internal/bundle"
	"agentik/daemon/internal/client"
	"agentik/daemon/internal/config"
	"agentik/daemon/internal/identity"
	"agentik/daemon/internal/probe"
	"agentik/daemon/internal/protocol"
	"agentik/daemon/internal/runtime"
)

const (
	heartbeatEvery = 5 * time.Second
	metaEvery      = 30 * time.Second
	flushEvery     = 250 * time.Millisecond
	idlePoll       = 1 * time.Second
	agentsMdLimit  = 12_000
)

type Loop struct {
	cfg      *config.Config
	client   *client.Client
	runtimes runtime.Registry
	slots    chan struct{}
}

func New(cfg *config.Config, c *client.Client, rt runtime.Registry, slots chan struct{}) *Loop {
	return &Loop{cfg: cfg, client: c, runtimes: rt, slots: slots}
}

// Run blocks until ctx is cancelled.
func (l *Loop) Run(ctx context.Context) error {
	reg, err := l.register(ctx)
	if err != nil {
		return err
	}
	log.Printf("registered daemon=%s runtimes=%v", reg.DaemonID, reg.Runtimes)

	go l.heartbeatLoop(ctx, reg.DaemonID)

	for {
		if ctx.Err() != nil {
			return nil
		}
		claimed := false
		for _, rt := range reg.Runtimes {
			if ctx.Err() != nil {
				return nil
			}
			task, err := l.client.Claim(ctx, rt.ID)
			if err != nil {
				log.Printf("claim error (%s): %v", rt.Kind, err)
				continue
			}
			if task == nil {
				continue
			}
			claimed = true
			l.execute(ctx, *task, rt.Kind)
		}
		// Bundle commands (install/upgrade a CLI) are polled alongside task claims.
		if l.pollBundle(ctx, reg.DaemonID) {
			claimed = true
		}
		if !claimed {
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(idlePoll):
			}
		}
	}
}

// meta is the daemon's self-description (advertised runtimes + probed CLIs + host),
// sent at register and refreshed after a bundle op changes what's installed.
func (l *Loop) meta() map[string]any {
	mode := "org"
	if l.cfg.UserToken != "" {
		mode = "personal"
	}
	return map[string]any{
		"runtimes":    l.cfg.RuntimeKinds,
		"tools":       probe.Tools(),
		"host":        probe.Host(),
		"installable": bundle.Installable(),
		"mode":        mode,
		"deviceId":    l.cfg.Name,
		"deviceName":  identity.DeviceName(),
	}
}

func (l *Loop) register(ctx context.Context) (*protocol.RegisterResponse, error) {
	req := protocol.RegisterRequest{
		Team:      l.cfg.Team,
		Name:      l.cfg.Name,
		LegacyIds: legacyIdsExcept(l.cfg.Name),
		Meta:      l.meta(),
	}
	for _, kind := range l.cfg.RuntimeKinds {
		req.Runtimes = append(req.Runtimes, protocol.RegisterRuntime{Kind: kind})
	}
	return l.client.Register(ctx, req)
}

// legacyIdsExcept returns prior machine identities to reconcile at register,
// dropping the current name so we never ask the engine to match this row to itself.
func legacyIdsExcept(name string) []string {
	out := []string{}
	for _, id := range identity.LegacyDaemonIDs() {
		if id != name {
			out = append(out, id)
		}
	}
	return out
}

// pollBundle claims one bundle command, runs it (when this host opted in), reports the
// outcome, and re-probes so a freshly (un)installed CLI shows up immediately. Returns
// true when a command was handled (so the loop skips its idle sleep).
func (l *Loop) pollBundle(ctx context.Context, daemonID string) bool {
	cmd, err := l.client.ClaimBundle(ctx, daemonID)
	if err != nil {
		log.Printf("bundle claim error: %v", err)
		return false
	}
	if cmd == nil {
		return false
	}
	log.Printf("bundle %s: %s %s", cmd.ID, cmd.Action, cmd.Kind)

	// Authorization is the engine's job: it only enqueues a bundle command when the
	// org's network-install policy is ON and the requester is an owner. The daemon
	// executes the allowlisted installer (it already runs claimed agent CLIs anyway).
	// 20 min covers the Hermes installer pulling Python/Node/ripgrep/ffmpeg.
	summary, runErr := bundle.Execute(ctx, cmd.Kind, cmd.Action, l.cfg.WorkRoot, 20*time.Minute)
	if runErr != nil {
		_ = l.client.ReportBundle(ctx, cmd.ID, protocol.BundleStatusRequest{Status: "failed", Error: runErr.Error()})
		return true
	}
	_ = l.client.ReportBundle(ctx, cmd.ID, protocol.BundleStatusRequest{Status: "done", Result: summary})
	// Re-probe so the newly available/removed CLI reflects in meta.tools right away.
	if err := l.client.UpdateMeta(ctx, daemonID, l.meta()); err != nil {
		log.Printf("meta refresh after bundle failed: %v", err)
	}
	return true
}

func (l *Loop) heartbeatLoop(ctx context.Context, daemonID string) {
	hb := time.NewTicker(heartbeatEvery)
	meta := time.NewTicker(metaEvery)
	defer hb.Stop()
	defer meta.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-hb.C:
			if err := l.client.Heartbeat(ctx, daemonID); err != nil {
				log.Printf("heartbeat error: %v", err)
			}
		case <-meta.C:
			if err := l.client.UpdateMeta(ctx, daemonID, l.meta()); err != nil {
				log.Printf("meta refresh error: %v", err)
			}
		}
	}
}

// execute runs one task: stream messages in batches, abort if the server reports
// the task was cancelled, then complete or fail.
func (l *Loop) execute(ctx context.Context, task protocol.ClaimedTask, kind string) {
	rt := l.runtimes[kind]
	if rt == nil {
		_ = l.client.Fail(ctx, task.ID, "no runtime for kind "+kind)
		return
	}
	if aware, ok := rt.(runtime.ToolAware); ok {
		rt = aware.WithToolInvoker(func(ctx context.Context, taskID string, toolID string, args map[string]any) (any, error) {
			res, err := l.client.InvokeTool(ctx, taskID, protocol.InvokeToolRequest{
				ToolID:    toolID,
				Arguments: args,
			})
			if err != nil {
				return nil, err
			}
			if res == nil || !res.OK {
				return nil, nil
			}
			return res.Result, nil
		})
	}
	log.Printf("task %s claimed (kind=%s)", task.ID, kind)

	if approval := preflightApproval(task); approval != nil {
		log.Printf("task %s waiting for approval: %s", task.ID, approval.Message)
		if err := l.client.RequestApproval(ctx, task.ID, protocol.ApprovalRequest{
			Message: approval.Message,
			Context: map[string]any{
				"risks": approval.Risks,
				"kind":  kind,
			},
		}); err != nil {
			log.Printf("approval request error %s: %v", task.ID, err)
			_ = l.client.Fail(ctx, task.ID, "approval request failed: "+err.Error())
		}
		return
	}

	if err := l.client.Start(ctx, task.ID); err != nil {
		log.Printf("start error %s: %v", task.ID, err)
		return
	}

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var (
		mu      sync.Mutex
		buf     []protocol.TaskMessage
		emitted []protocol.TaskMessage
		seq     int
	)
	emit := func(m protocol.TaskMessage) {
		mu.Lock()
		m.Seq = seq
		seq++
		buf = append(buf, m)
		emitted = append(emitted, m)
		mu.Unlock()
	}

	flush := func() (cancelled bool) {
		mu.Lock()
		batch := buf
		buf = nil
		mu.Unlock()
		if len(batch) == 0 {
			return false
		}
		c, err := l.client.SendMessages(ctx, task.ID, batch)
		if err != nil {
			log.Printf("messages error %s: %v", task.ID, err)
		}
		return c
	}

	type result struct {
		val any
		err error
	}
	done := make(chan result, 1)
	go func() {
		release, ok := l.acquireSlot(runCtx)
		if !ok {
			done <- result{nil, context.Canceled}
			return
		}
		defer release()
		if task.Workspace != nil {
			emit(protocol.TaskMessage{Type: "tool_use", Tool: "workspace.prepare", Input: map[string]any{
				"type":   task.Workspace.Type,
				"ref":    task.Workspace.Ref,
				"branch": task.Workspace.Branch,
			}})
			_ = l.client.ReportWorkspace(runCtx, task.Workspace.ID, protocol.WorkspaceStatusRequest{Status: "syncing", Path: task.Workspace.Path})
			dir, err := runtime.PrepareWorkspace(runCtx, l.cfg.WorkRoot, task.Workspace)
			if err != nil {
				_ = l.client.ReportWorkspace(context.Background(), task.Workspace.ID, protocol.WorkspaceStatusRequest{Status: "error", Path: task.Workspace.Path, Error: err.Error()})
				done <- result{nil, err}
				return
			}
			task.WorkDir = dir
			_ = l.client.ReportWorkspace(runCtx, task.Workspace.ID, protocol.WorkspaceStatusRequest{Status: "ready", Path: dir, Meta: map[string]any{
				"type":       task.Workspace.Type,
				"resourceId": task.Workspace.ResourceID,
				"ref":        task.Workspace.Ref,
				"branch":     task.Workspace.Branch,
			}})
			emit(protocol.TaskMessage{Type: "tool_result", Tool: "workspace.prepare", Output: map[string]any{"path": dir}})
			injectWorkspaceInstructions(&task, dir)
		}
		val, err := rt.Run(runCtx, task, emit)
		if err == nil && task.Workspace != nil {
			val = withFileChanges(val, runtime.ChangedFiles(runCtx, task.WorkDir), runtime.DiffStats(runCtx, task.WorkDir))
		}
		if err == nil {
			mu.Lock()
			seen := append([]protocol.TaskMessage(nil), emitted...)
			mu.Unlock()
			val = withDetectedTests(val, detectTestResults(seen))
		}
		done <- result{val, err}
	}()

	ticker := time.NewTicker(flushEvery)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if flush() {
				cancel() // server says cancelled → abort the runtime
			}
		case r := <-done:
			flush()
			switch {
			case r.err == context.Canceled || runCtx.Err() == context.Canceled:
				log.Printf("task %s cancelled", task.ID)
				_ = l.client.Fail(ctx, task.ID, "cancelled")
			case r.err != nil:
				log.Printf("task %s failed: %v", task.ID, r.err)
				_ = l.client.Fail(ctx, task.ID, r.err.Error())
			default:
				log.Printf("task %s completed", task.ID)
				_ = l.client.Complete(ctx, task.ID, r.val)
			}
			return
		}
	}
}

func injectWorkspaceInstructions(task *protocol.ClaimedTask, dir string) {
	content := readAgentsMarkdown(dir)
	if content == "" || len(task.Input) == 0 {
		return
	}
	var input protocol.TaskInput
	if err := json.Unmarshal(task.Input, &input); err != nil {
		return
	}
	section := "Workspace AGENTS.md instructions:\n" + content
	if strings.TrimSpace(input.SystemPrompt) != "" {
		input.SystemPrompt = strings.TrimSpace(input.SystemPrompt) + "\n\n---\n\n" + section
	} else {
		input.SystemPrompt = section
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return
	}
	task.Input = encoded
}

func readAgentsMarkdown(dir string) string {
	if strings.TrimSpace(dir) == "" {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(dir, "AGENTS.md"))
	if err != nil {
		return ""
	}
	content := strings.TrimSpace(string(b))
	if len(content) > agentsMdLimit {
		content = content[:agentsMdLimit] + "\n..."
	}
	return content
}

type preflightApprovalPolicy struct {
	RequiresApproval bool     `json:"requiresApproval"`
	Approved         bool     `json:"approved"`
	Message          string   `json:"message"`
	Risks            []string `json:"risks"`
}

func preflightApproval(task protocol.ClaimedTask) *preflightApprovalPolicy {
	if len(task.Input) == 0 {
		return nil
	}
	var input struct {
		Approval *preflightApprovalPolicy `json:"approval"`
	}
	if err := json.Unmarshal(task.Input, &input); err != nil || input.Approval == nil {
		return nil
	}
	if !input.Approval.RequiresApproval || input.Approval.Approved {
		return nil
	}
	if input.Approval.Message == "" {
		input.Approval.Message = "Operator approval required before execution."
	}
	return input.Approval
}

func withChangedFiles(val any, changed []string) any {
	return withFileChanges(val, changed, nil)
}

func withFileChanges(val any, changed []string, fileChanges []runtime.FileChange) any {
	if len(changed) == 0 {
		if len(fileChanges) == 0 {
			return val
		}
	}
	if m, ok := val.(map[string]any); ok {
		if len(changed) > 0 {
			m["changed_files"] = changed
		}
		if len(fileChanges) > 0 {
			m["file_changes"] = fileChanges
		}
		return m
	}
	out := map[string]any{"result": val}
	if len(changed) > 0 {
		out["changed_files"] = changed
	}
	if len(fileChanges) > 0 {
		out["file_changes"] = fileChanges
	}
	return out
}

type detectedTest struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Output string `json:"output,omitempty"`
}

var testCommandPattern = regexp.MustCompile(`(?i)(^|\s)(bun|npm|pnpm|yarn|go|cargo|pytest|phpunit|vitest|jest|rspec|make)\s+([^;&|]*\b(test|check|spec|phpunit|vitest|jest)\b[^;&|]*)`)
var failingCountPattern = regexp.MustCompile(`(?i)([1-9][0-9]*)\s+(fail|failed|failure|failures|error|errors)\b`)

func withDetectedTests(val any, tests []detectedTest) any {
	if len(tests) == 0 {
		return val
	}
	if m, ok := val.(map[string]any); ok {
		if existing, ok := m["tests"].([]detectedTest); ok && len(existing) > 0 {
			return m
		}
		if existing, ok := m["tests"].([]any); ok && len(existing) > 0 {
			return m
		}
		m["tests"] = tests
		return m
	}
	return map[string]any{"result": val, "tests": tests}
}

func detectTestResults(messages []protocol.TaskMessage) []detectedTest {
	var out []detectedTest
	var pendingCommand string
	for _, msg := range messages {
		if msg.Type == "tool_use" {
			if cmd := testCommandFrom(msg.Input); cmd != "" {
				pendingCommand = cmd
			}
			continue
		}
		if msg.Type != "tool_result" || pendingCommand == "" {
			continue
		}
		output := outputString(msg.Output)
		out = append(out, detectedTest{
			Name:   pendingCommand,
			Status: statusFromOutput(output),
			Output: truncateOutput(output, 4000),
		})
		pendingCommand = ""
	}
	return out
}

func testCommandFrom(input any) string {
	raw := commandString(input)
	if raw == "" {
		return ""
	}
	match := testCommandPattern.FindString(strings.TrimSpace(raw))
	return strings.TrimSpace(match)
}

func commandString(input any) string {
	switch v := input.(type) {
	case string:
		return v
	case map[string]any:
		for _, key := range []string{"command", "cmd", "script", "input"} {
			if s, ok := v[key].(string); ok && strings.TrimSpace(s) != "" {
				return s
			}
		}
	}
	return ""
}

func outputString(output any) string {
	switch v := output.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	case map[string]any:
		for _, key := range []string{"output", "stdout", "stderr", "content", "text"} {
			if s, ok := v[key].(string); ok && strings.TrimSpace(s) != "" {
				return s
			}
		}
		b, _ := json.Marshal(v)
		return string(b)
	default:
		if output == nil {
			return ""
		}
		b, _ := json.Marshal(output)
		return string(b)
	}
}

func statusFromOutput(output string) string {
	lower := strings.ToLower(output)
	switch {
	case failingCountPattern.MatchString(lower) || strings.Contains(lower, "panic"):
		return "failed"
	case strings.Contains(lower, "pass") || strings.Contains(lower, "ok") || strings.Contains(lower, "success"):
		return "passed"
	default:
		return "reported"
	}
}

func truncateOutput(output string, limit int) string {
	output = strings.TrimSpace(output)
	if len(output) <= limit {
		return output
	}
	return output[:limit] + "\n..."
}

func (l *Loop) acquireSlot(ctx context.Context) (func(), bool) {
	if l.slots == nil {
		return func() {}, true
	}
	select {
	case l.slots <- struct{}{}:
		return func() { <-l.slots }, true
	case <-ctx.Done():
		return func() {}, false
	}
}
