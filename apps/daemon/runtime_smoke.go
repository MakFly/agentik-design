package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"agentik/daemon/internal/protocol"
	"agentik/daemon/internal/runtime"
)

type runtimeSmokeProof struct {
	ID         string                 `json:"id"`
	Status     string                 `json:"status"`
	Runtime    string                 `json:"runtime"`
	StartedAt  string                 `json:"startedAt"`
	FinishedAt string                 `json:"finishedAt,omitempty"`
	Prompt     string                 `json:"prompt"`
	WorkRoot   string                 `json:"workRoot"`
	Checks     []runtimeSmokeCheck    `json:"checks"`
	Messages   []protocol.TaskMessage `json:"messages,omitempty"`
	Result     any                    `json:"result,omitempty"`
	Error      string                 `json:"error,omitempty"`
}

type runtimeSmokeCheck struct {
	Name string         `json:"name"`
	OK   bool           `json:"ok"`
	Meta map[string]any `json:"meta,omitempty"`
}

func runRuntimeSmoke(args []string) error {
	fs := flag.NewFlagSet("runtime-smoke", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	kind := fs.String("runtime", "claude", "runtime to execute: claude, hermes, codex, openai, anthropic, custom")
	prompt := fs.String("prompt", "Agentik runtime smoke: answer with one concise sentence.", "prompt to execute")
	model := fs.String("model", "", "optional runtime model override")
	proofPath := fs.String("proof", "", "proof JSON path (default: artifacts/acceptance/<session>.json)")
	timeout := fs.Duration("timeout", 45*time.Second, "runtime execution timeout")
	if err := fs.Parse(args); err != nil {
		return err
	}

	started := time.Now().UTC()
	id := fmt.Sprintf("agentik-runner-smoke-%d", started.UnixMilli())
	root, err := os.Getwd()
	if err != nil {
		return err
	}
	repoRoot := findRepoRoot(root)
	workRoot, err := os.MkdirTemp("", "agentik-runtime-smoke-*")
	if err != nil {
		return fmt.Errorf("runtime smoke workroot: %w", err)
	}
	defer os.RemoveAll(workRoot)

	outPath := strings.TrimSpace(*proofPath)
	if outPath == "" {
		outPath = filepath.Join(repoRoot, "artifacts", "acceptance", id+".json")
	}
	if !filepath.IsAbs(outPath) {
		outPath = filepath.Join(repoRoot, outPath)
	}

	proof := runtimeSmokeProof{
		ID:        id,
		Status:    "running",
		Runtime:   strings.TrimSpace(*kind),
		StartedAt: started.Format(time.RFC3339Nano),
		Prompt:    strings.TrimSpace(*prompt),
		WorkRoot:  workRoot,
	}
	addSmokeCheck := func(name string, ok bool, meta map[string]any) {
		proof.Checks = append(proof.Checks, runtimeSmokeCheck{Name: name, OK: ok, Meta: meta})
	}

	rt, err := smokeRuntime(proof.Runtime, workRoot, *model, *timeout)
	if err != nil {
		proof.Status = "failed"
		proof.Error = err.Error()
		proof.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
		_ = writeRuntimeSmokeProof(outPath, proof)
		return err
	}
	addSmokeCheck("runtime is registered", true, map[string]any{"runtime": rt.Kind()})

	input, err := json.Marshal(protocol.TaskInput{
		Prompt:       proof.Prompt,
		SystemPrompt: "You are running an Agentik runtime smoke test. Do not perform external writes.",
		Model:        strings.TrimSpace(*model),
	})
	if err != nil {
		return err
	}
	task := protocol.ClaimedTask{
		ID:      id,
		TeamID:  "team_runtime_smoke",
		AgentID: "agent_runtime_smoke",
		Kind:    "direct",
		Input:   input,
		WorkDir: filepath.Join("runtime-smoke", id),
		Env:     smokeEnv(),
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	result, runErr := rt.Run(ctx, task, func(message protocol.TaskMessage) {
		proof.Messages = append(proof.Messages, message)
	})
	proof.Result = result
	addSmokeCheck("runtime completed without error", runErr == nil, nil)
	addSmokeCheck("runtime emitted messages", len(proof.Messages) > 0, map[string]any{"count": len(proof.Messages)})
	addSmokeCheck("runtime produced result", result != nil, nil)
	if runErr != nil {
		proof.Status = "failed"
		proof.Error = runErr.Error()
	} else if smokeChecksPass(proof.Checks) {
		proof.Status = "passed"
	} else {
		proof.Status = "failed"
		proof.Error = "one or more runtime smoke checks failed"
	}
	proof.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := writeRuntimeSmokeProof(outPath, proof); err != nil {
		return err
	}
	fmt.Fprintf(os.Stdout, "runtime smoke proof written: %s\n", outPath)
	if proof.Status != "passed" {
		return fmt.Errorf("runtime smoke failed: %s", proof.Error)
	}
	return nil
}

func smokeRuntime(kind string, workRoot string, model string, timeout time.Duration) (runtime.Runtime, error) {
	timeoutMs := int(timeout / time.Millisecond)
	switch kind {
	case "claude":
		return runtime.Claude{WorkRoot: workRoot, Model: model, TimeoutMs: timeoutMs}, nil
	case "hermes":
		return runtime.Hermes{WorkRoot: workRoot, Model: model, TimeoutMs: timeoutMs}, nil
	case "codex":
		return runtime.Codex{WorkRoot: workRoot, Model: model, TimeoutMs: timeoutMs}, nil
	case "openai", "anthropic", "custom":
		return runtime.Provider{KindName: kind, WorkRoot: workRoot, Model: model, BaseURL: os.Getenv("CUSTOM_BASE_URL"), TimeoutMs: timeoutMs}, nil
	default:
		return nil, fmt.Errorf("unknown runtime %q", kind)
	}
}

func smokeEnv() map[string]string {
	env := map[string]string{}
	for _, key := range []string{
		"AGENTIK_CODEX_AUTH",
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"CUSTOM_API_KEY",
		"CUSTOM_BASE_URL",
		"GOOGLE_API_KEY",
		"GEMINI_API_KEY",
	} {
		if value := os.Getenv(key); value != "" {
			env[key] = value
		}
	}
	return env
}

func hasMessageType(messages []protocol.TaskMessage, typ string) bool {
	for _, message := range messages {
		if message.Type == typ {
			return true
		}
	}
	return false
}

func smokeChecksPass(checks []runtimeSmokeCheck) bool {
	for _, check := range checks {
		if !check.OK {
			return false
		}
	}
	return true
}

func writeRuntimeSmokeProof(path string, proof runtimeSmokeProof) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(proof, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func findRepoRoot(start string) string {
	dir := start
	for {
		if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "apps", "daemon", "go.mod")); err == nil {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return start
		}
		dir = parent
	}
}
