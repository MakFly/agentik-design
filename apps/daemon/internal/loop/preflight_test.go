package loop

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"agentik/daemon/internal/protocol"
)

func TestPreflightApprovalRequiresGateUntilApproved(t *testing.T) {
	input, err := json.Marshal(protocol.TaskInput{
		Prompt: "deploy production",
		Approval: &protocol.ApprovalPolicy{
			RequiresApproval: true,
			Approved:         false,
			Message:          "Approve deploy",
			Risks:            []string{"production deploy"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	approval := preflightApproval(protocol.ClaimedTask{ID: "atask_test", Input: input})
	if approval == nil {
		t.Fatal("expected preflight approval")
	}
	if approval.Message != "Approve deploy" {
		t.Fatalf("message = %q", approval.Message)
	}
}

func TestPreflightApprovalSkipsApprovedGate(t *testing.T) {
	input, err := json.Marshal(protocol.TaskInput{
		Prompt: "deploy production",
		Approval: &protocol.ApprovalPolicy{
			RequiresApproval: true,
			Approved:         true,
			Message:          "Approve deploy",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	if approval := preflightApproval(protocol.ClaimedTask{ID: "atask_test", Input: input}); approval != nil {
		t.Fatalf("expected approved task to skip preflight, got %#v", approval)
	}
}

func TestInjectWorkspaceInstructionsAddsAgentsMdToSystemPrompt(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(
		dir+"/AGENTS.md",
		[]byte("Use bun only.\nCheck tests before final response."),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(protocol.TaskInput{
		Prompt:       "Fix checkout",
		SystemPrompt: "You are the coding agent.",
	})
	if err != nil {
		t.Fatal(err)
	}
	task := protocol.ClaimedTask{ID: "atask_test", Input: input}

	injectWorkspaceInstructions(&task, dir)

	var got protocol.TaskInput
	if err := json.Unmarshal(task.Input, &got); err != nil {
		t.Fatal(err)
	}
	if got.Prompt != "Fix checkout" {
		t.Fatalf("prompt changed: %q", got.Prompt)
	}
	if !strings.Contains(got.SystemPrompt, "Workspace AGENTS.md instructions") ||
		!strings.Contains(got.SystemPrompt, "Use bun only.") {
		t.Fatalf("system prompt did not include AGENTS.md: %q", got.SystemPrompt)
	}
}
