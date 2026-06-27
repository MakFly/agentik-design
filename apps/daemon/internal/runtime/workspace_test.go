package runtime

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"agentik/daemon/internal/protocol"
)

func TestTaskWorkDirUsesRelativeWorkspaceUnderWorkRoot(t *testing.T) {
	root := t.TempDir()
	task := protocol.ClaimedTask{ID: "run_test", WorkDir: "projects/proj_test/pwsp_test"}

	dir, cleanup, err := taskWorkDir(root, task)
	if err != nil {
		t.Fatalf("taskWorkDir returned error: %v", err)
	}
	defer cleanup()

	want := filepath.Join(root, "projects", "proj_test", "pwsp_test")
	if dir != want {
		t.Fatalf("dir = %q, want %q", dir, want)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("workspace dir was not created: %v", err)
	}
}

func TestTaskWorkDirRejectsParentTraversal(t *testing.T) {
	_, _, err := taskWorkDir(t.TempDir(), protocol.ClaimedTask{ID: "run_test", WorkDir: "../outside"})
	if err == nil {
		t.Fatal("expected parent traversal to be rejected")
	}
}

func TestTaskWorkDirMapsLegacyWorkPathUnderWorkRoot(t *testing.T) {
	root := t.TempDir()
	dir, cleanup, err := taskWorkDir(root, protocol.ClaimedTask{ID: "run_test", WorkDir: "/work/run_test"})
	if err != nil {
		t.Fatalf("taskWorkDir returned error: %v", err)
	}
	if dir != filepath.Join(root, "run_test") {
		t.Fatalf("dir = %q", dir)
	}
	cleanup()
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("legacy task workdir was not cleaned up, stat err=%v", err)
	}
}

func TestPrepareWorkspaceAcceptsLocalDir(t *testing.T) {
	src := t.TempDir()
	dir, err := PrepareWorkspace(context.Background(), t.TempDir(), &protocol.WorkspaceRef{
		ID:        "pwsp_test",
		ProjectID: "proj_test",
		Type:      "local_dir",
		Ref:       src,
		Path:      "projects/proj_test/pwsp_test",
	})
	if err != nil {
		t.Fatalf("PrepareWorkspace returned error: %v", err)
	}
	if dir != src {
		t.Fatalf("dir = %q, want %q", dir, src)
	}
}

func TestParseGitStatusAndNumstat(t *testing.T) {
	changes := parseStatus(" M src/app.ts\nA  src/new.ts\nR  old.ts -> src/renamed.ts\n?? scratch.md\n")
	stats := parseNumstat("12\t3\tsrc/app.ts\n1\t0\tsrc/new.ts\n")
	for i := range changes {
		if stat, ok := stats[changes[i].Path]; ok {
			changes[i].Additions = stat.Additions
			changes[i].Deletions = stat.Deletions
		}
	}

	if len(changes) != 4 {
		t.Fatalf("changes len = %d", len(changes))
	}
	if changes[0] != (FileChange{Path: "src/app.ts", Status: "modified", Additions: 12, Deletions: 3}) {
		t.Fatalf("first change = %#v", changes[0])
	}
	if changes[2].Path != "src/renamed.ts" || changes[2].Status != "renamed" {
		t.Fatalf("rename change = %#v", changes[2])
	}
	if changes[3].Status != "added" {
		t.Fatalf("untracked status = %q", changes[3].Status)
	}
}
