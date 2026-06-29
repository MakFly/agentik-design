package runtime

import (
	"slices"
	"strings"
	"testing"

	"agentik/daemon/internal/protocol"
)

func TestClaudeArgsUseStreamJSONAndAgentContext(t *testing.T) {
	args := claudeArgs(protocol.TaskInput{
		Prompt:       "  fix checkout  ",
		SystemPrompt: "Follow AGENTS.md and ask before deploy.",
		Model:        "claude-test",
	}, "fallback-model")

	want := []string{
		"-p", "fix checkout",
		"--output-format", "stream-json",
		"--verbose",
		"--append-system-prompt", "Follow AGENTS.md and ask before deploy.",
		"--model", "claude-test",
	}
	if !slices.Equal(args, want) {
		t.Fatalf("args = %#v, want %#v", args, want)
	}
}

func TestClaudeArgsUseFallbackModel(t *testing.T) {
	args := claudeArgs(protocol.TaskInput{Prompt: "ship"}, "claude-fallback")
	if !slices.Contains(args, "--model") || args[len(args)-1] != "claude-fallback" {
		t.Fatalf("args did not use fallback model: %#v", args)
	}
}

func TestClaudeAllowlistEnvDoesNotLeakDaemonSecrets(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://secret")
	t.Setenv("ENGINE_TOKEN", "engine-secret")
	t.Setenv("CLAUDE_API_KEY", "claude-key")

	env := allowlistEnv()
	joined := "\n" + strings.Join(env, "\n") + "\n"
	if strings.Contains(joined, "\nDATABASE_URL=") || strings.Contains(joined, "\nENGINE_TOKEN=") {
		t.Fatalf("allowlistEnv leaked daemon-only secret env: %q", env)
	}
	if !strings.Contains(joined, "\nCLAUDE_API_KEY=claude-key\n") {
		t.Fatalf("allowlistEnv did not include Claude runtime env: %q", env)
	}
}
