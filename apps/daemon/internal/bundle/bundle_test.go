package bundle

import (
	"context"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestClassify(t *testing.T) {
	tests := []struct {
		real   string
		kind   string
		method installMethod
		prefix string
	}{
		{"", "codex", methodDefault, ""},
		{"/home/u/.bun/install/global/node_modules/@openai/codex/bin/codex.js", "codex", methodBun, ""},
		{"/home/u/.local/lib/node_modules/@openai/codex/bin/codex.js", "codex", methodNpmPrefix, "/home/u/.local"},
		{"/home/u/.local/share/claude/versions/2.1.191", "claude", methodClaudeSelfUpdate, ""},
		{"/home/u/.local/bin/claude", "claude", methodClaudeSelfUpdate, ""},
		{"/home/u/.local/lib/python3.12/site-packages/foo/__main__.py", "codex", methodPip, ""},
		{"/usr/local/bin/hermes", "hermes", methodHermesSelfUpdate, ""},
		{"/home/u/.bun/bin/gemini", "gemini", methodBun, ""},
	}
	for _, tc := range tests {
		gotMethod, gotPrefix := classify(tc.real, tc.kind)
		if gotMethod != tc.method || gotPrefix != tc.prefix {
			t.Errorf("classify(%q, %q) = (%v, %q), want (%v, %q)",
				tc.real, tc.kind, gotMethod, gotPrefix, tc.method, tc.prefix)
		}
	}
}

func TestNpmPrefixFromPath(t *testing.T) {
	got := npmPrefixFromPath("/home/kev/.local/lib/node_modules/@openai/codex/bin/codex.js")
	if got != "/home/kev/.local" {
		t.Errorf("npmPrefixFromPath = %q, want /home/kev/.local", got)
	}
}

func TestUpgradeResolved_codexNpmLocal(t *testing.T) {
	sp := clis["codex"]
	real := "/home/kev/.local/lib/node_modules/@openai/codex/bin/codex.js"
	steps, err := upgradeResolved("codex", sp, real)
	if err != nil {
		t.Fatalf("upgradeResolved: %v", err)
	}
	want := [][]string{{"npm", "install", "-g", "--prefix", "/home/kev/.local", "@openai/codex@latest"}}
	if !reflect.DeepEqual(steps, want) {
		t.Errorf("steps = %v, want %v", steps, want)
	}
}

func TestUpgradeResolved_codexBun(t *testing.T) {
	sp := clis["codex"]
	real := "/home/u/.bun/install/global/node_modules/@openai/codex/bin/codex.js"
	steps, err := upgradeResolved("codex", sp, real)
	if err != nil {
		t.Fatalf("upgradeResolved: %v", err)
	}
	want := [][]string{{"bun", "add", "--global", "@openai/codex@latest"}}
	if !reflect.DeepEqual(steps, want) {
		t.Errorf("steps = %v, want %v", steps, want)
	}
}

func TestUpgradeResolved_claudeNative(t *testing.T) {
	sp := clis["claude"]
	real := "/home/u/.local/share/claude/versions/2.1.191"
	steps, err := upgradeResolved("claude", sp, real)
	if err != nil {
		t.Fatalf("upgradeResolved: %v", err)
	}
	want := [][]string{{"claude", "update"}}
	if !reflect.DeepEqual(steps, want) {
		t.Errorf("steps = %v, want %v", steps, want)
	}
}

func TestUpgradeResolved_hermes(t *testing.T) {
	sp := clis["hermes"]
	real := "/home/u/.local/bin/hermes"
	steps, err := upgradeResolved("hermes", sp, real)
	if err != nil {
		t.Fatalf("upgradeResolved: %v", err)
	}
	want := [][]string{{"hermes", "update", "--yes", "--backup"}}
	if !reflect.DeepEqual(steps, want) {
		t.Errorf("steps = %v, want %v", steps, want)
	}
}

func TestBuildSteps_uninstall(t *testing.T) {
	steps, probe, err := buildSteps("codex", "uninstall")
	if err != nil {
		t.Fatalf("buildSteps: %v", err)
	}
	want := [][]string{{"bun", "remove", "--global", "@openai/codex"}}
	if !reflect.DeepEqual(steps, want) {
		t.Errorf("steps = %v, want %v", steps, want)
	}
	if !reflect.DeepEqual(probe, []string{"codex", "--version"}) {
		t.Errorf("probe = %v", probe)
	}
}

func TestBuildSteps_unknownKind(t *testing.T) {
	_, _, err := buildSteps("unknown-cli", "install")
	if err == nil {
		t.Fatal("expected error for unknown kind")
	}
}

func TestBuildSteps_hermesUninstall(t *testing.T) {
	steps, probe, err := buildSteps("hermes", "uninstall")
	if err != nil {
		t.Fatalf("buildSteps: %v", err)
	}
	want := [][]string{{"hermes", "uninstall", "--yes"}}
	if !reflect.DeepEqual(steps, want) {
		t.Errorf("steps = %v, want %v", steps, want)
	}
	if !reflect.DeepEqual(probe, []string{"hermes", "--version"}) {
		t.Errorf("probe = %v", probe)
	}
}

func TestAssertPrefixWritable_blocksSystem(t *testing.T) {
	if err := assertPrefixWritable("/usr/local"); err == nil {
		t.Fatal("expected error for /usr/local prefix")
	}
}

func TestInstallable(t *testing.T) {
	got := Installable()
	if len(got) != len(clis) {
		t.Fatalf("Installable() = %v", got)
	}
	for _, k := range []string{"claude", "codex", "gemini", "hermes"} {
		found := false
		for _, g := range got {
			if g == k {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Installable missing %q", k)
		}
	}
}

func TestLiveUpgradeCodex(t *testing.T) {
	if os.Getenv("AGENTIK_BUNDLE_LIVE") == "" {
		t.Skip("set AGENTIK_BUNDLE_LIVE=1 to run")
	}
	before := cliVersion(t, "codex")
	result, err := Execute(context.Background(), "codex", "upgrade", t.TempDir(), 5*time.Minute)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	after := cliVersion(t, "codex")
	t.Logf("before=%q after=%q result=%q", before, after, result)
	if after == before {
		t.Errorf("codex version unchanged after upgrade: %q", after)
	}
}

func cliVersion(t *testing.T, bin string) string {
	t.Helper()
	out, err := exec.Command(bin, "--version").CombinedOutput()
	if err != nil {
		t.Fatalf("%s --version: %v", bin, err)
	}
	return strings.TrimSpace(string(out))
}
