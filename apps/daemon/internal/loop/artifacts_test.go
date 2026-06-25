package loop

import (
	"testing"

	"agentik/daemon/internal/protocol"
)

func TestDetectTestResultsFromShellToolMessages(t *testing.T) {
	tests := detectTestResults([]protocol.TaskMessage{
		{
			Type:  "tool_use",
			Tool:  "Bash",
			Input: map[string]any{"command": "bun test src/run-controls.test.ts"},
		},
		{
			Type:   "tool_result",
			Tool:   "Bash",
			Output: "5 pass\n0 fail",
		},
	})

	if len(tests) != 1 {
		t.Fatalf("tests len = %d", len(tests))
	}
	if tests[0].Name != "bun test src/run-controls.test.ts" {
		t.Fatalf("name = %q", tests[0].Name)
	}
	if tests[0].Status != "passed" {
		t.Fatalf("status = %q", tests[0].Status)
	}
}

func TestWithDetectedTestsKeepsRuntimeProvidedTests(t *testing.T) {
	val := map[string]any{
		"result": "done",
		"tests":  []any{map[string]any{"name": "runtime test", "status": "passed"}},
	}
	got := withDetectedTests(val, []detectedTest{{Name: "bun test", Status: "passed"}}).(map[string]any)

	if len(got["tests"].([]any)) != 1 {
		t.Fatalf("runtime-provided tests were overwritten: %#v", got["tests"])
	}
}
