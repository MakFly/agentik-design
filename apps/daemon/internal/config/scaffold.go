package config

import (
	"os"
	"path/filepath"

	"agentik/daemon/internal/identity"
)

// operatorConfigYAML is the Hermes "operator shape" config.yaml: how the agent
// routes and executes. Mirrors the live preview in the web cockpit
// (apps/web/features/agent-builder/config-preview.tsx) so what an operator sees
// on screen matches what lands on disk. Starter defaults — edited per agent later.
const operatorConfigYAML = `# Hermes operator shape — how this agent routes and executes.
model:
  provider: anthropic
  default: claude-sonnet-4-6
  temperature: 0.2
  max_tokens: 4096
  reasoning_effort: none
execution:
  runtime: claude
  computer: any
skills:
  tools: 0
memory:
  stores: 0
policy:
  redact_pii: true
  filters: 0
  approvals: 0
  cost_cap: 1.00
`

// workspaceFiles are the OpenClaw-style identity & behavior files: who the agent
// is and what it remembers. Plain Markdown so operators edit them by hand.
var workspaceFiles = map[string]string{
	"SOUL.md": `# Soul

The agent's mission and personality. Keep it short and concrete.

- **Mission:** _what this agent is for._
- **Tone:** _how it should sound._
- **Boundaries:** _what it must never do._
`,
	"USER.md": `# User

Who the operator is, so the agent can tailor its work.

- **Name:** _you._
- **Preferences:** _defaults, formats, languages._
- **Context:** _projects, accounts, timezones._
`,
	"AGENTS.md": `# Agents

Roster and delegation rules for this workspace.

- **Roster:** _which agents exist and what each owns._
- **Delegation:** _when to hand off, to whom._
`,
	"HEARTBEAT.md": `# Heartbeat

Periodic behavior — what the agent does on each tick when idle.

- **Cadence:** _how often._
- **Checks:** _what to look at._
- **Triggers:** _what wakes it up._
`,
	"MEMORY.md": `# Memory

Long-term, durable facts the agent should always carry.

- _Append durable learnings here; daily logs live under ../memory/._
`,
}

// EnsureLayout materializes the agentik state dir as the OpenClaw × Hermes mirror:
// the Hermes operator config.yaml next to the OpenClaw workspace/, memory/, cron/
// and credentials/. Idempotent — never overwrites an existing file. Returns the
// relative paths it created, for a friendly setup summary.
func EnsureLayout(baseDir string) ([]string, error) {
	migrateLegacy(baseDir)

	var created []string

	// Directories (OpenClaw layout).
	for _, dir := range []string{"credentials", "memory", "workspace", "cron"} {
		if err := os.MkdirAll(filepath.Join(baseDir, dir), 0o700); err != nil {
			return created, err
		}
	}

	// Hermes operator config + OpenClaw cron jobs + workspace identity files.
	writeIfMissing := func(rel, content string) error {
		path := filepath.Join(baseDir, rel)
		if _, err := os.Stat(path); err == nil {
			return nil // exists — leave it
		} else if !os.IsNotExist(err) {
			return err
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			return err
		}
		created = append(created, rel)
		return nil
	}

	if err := writeIfMissing("config.yaml", operatorConfigYAML); err != nil {
		return created, err
	}
	if err := writeIfMissing(filepath.Join("cron", "jobs.json"), "{\n  \"jobs\": []\n}\n"); err != nil {
		return created, err
	}
	for name, content := range workspaceFiles {
		if err := writeIfMissing(filepath.Join("workspace", name), content); err != nil {
			return created, err
		}
	}
	return created, nil
}

// migrateLegacy copies a pre-mirror ~/.config/agentik install into baseDir in
// place (config.json → agentik.json, daemon.id) so an upgrade is seamless.
// Best-effort and idempotent: skips anything already present at the destination.
func migrateLegacy(baseDir string) {
	legacy := identity.LegacyBaseDir()
	if legacy == "" || legacy == baseDir {
		return
	}
	copyIfAbsent(filepath.Join(legacy, "config.json"), filepath.Join(baseDir, "agentik.json"))
	copyIfAbsent(filepath.Join(legacy, "daemon.id"), filepath.Join(baseDir, "daemon.id"))
}

// copyIfAbsent copies src→dst only when src exists and dst does not.
func copyIfAbsent(src, dst string) {
	if _, err := os.Stat(dst); err == nil {
		return
	}
	b, err := os.ReadFile(src)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return
	}
	_ = os.WriteFile(dst, b, 0o600)
}
