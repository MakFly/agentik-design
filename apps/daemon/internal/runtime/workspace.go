package runtime

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"agentik/daemon/internal/protocol"
)

func taskWorkDir(workRoot string, task protocol.ClaimedTask) (string, func(), error) {
	if strings.TrimSpace(task.WorkDir) != "" {
		dir, err := resolveWorkPath(workRoot, task.WorkDir)
		if err != nil {
			return "", nil, err
		}
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", nil, fmt.Errorf("workdir: %w", err)
		}
		if task.Workspace == nil {
			return dir, func() { _ = os.RemoveAll(dir) }, nil
		}
		return dir, func() {}, nil
	}
	dir := filepath.Join(workRoot, task.ID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", nil, fmt.Errorf("workdir: %w", err)
	}
	return dir, func() { _ = os.RemoveAll(dir) }, nil
}

func resolveWorkPath(workRoot, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("empty workdir")
	}
	if strings.HasPrefix(raw, "/work/") {
		return filepath.Join(workRoot, strings.TrimPrefix(raw, "/work/")), nil
	}
	if filepath.IsAbs(raw) {
		return filepath.Clean(raw), nil
	}
	clean := filepath.Clean(raw)
	if clean == "." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".." {
		return "", fmt.Errorf("unsafe workdir %q", raw)
	}
	return filepath.Join(workRoot, clean), nil
}

func PrepareWorkspace(ctx context.Context, workRoot string, ws *protocol.WorkspaceRef) (string, error) {
	if ws == nil {
		return "", nil
	}
	switch ws.Type {
	case "git_repo":
		return prepareGitWorkspace(ctx, workRoot, ws)
	case "local_dir":
		return prepareLocalWorkspace(ws)
	default:
		return "", fmt.Errorf("unsupported workspace resource type %q", ws.Type)
	}
}

func prepareLocalWorkspace(ws *protocol.WorkspaceRef) (string, error) {
	ref := filepath.Clean(strings.TrimSpace(ws.Ref))
	if ref == "" {
		return "", fmt.Errorf("local workspace path is empty")
	}
	stat, err := os.Stat(ref)
	if err != nil {
		return "", fmt.Errorf("local workspace: %w", err)
	}
	if !stat.IsDir() {
		return "", fmt.Errorf("local workspace %q is not a directory", ref)
	}
	return ref, nil
}

func prepareGitWorkspace(ctx context.Context, workRoot string, ws *protocol.WorkspaceRef) (string, error) {
	ref := strings.TrimSpace(ws.Ref)
	if ref == "" {
		return "", fmt.Errorf("git workspace ref is empty")
	}
	dir, err := resolveWorkPath(workRoot, pick(ws.Path, "projects/"+ws.ProjectID+"/"+ws.ID))
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		if err := git(ctx, dir, "fetch", "--all", "--prune"); err != nil {
			return "", err
		}
		if strings.TrimSpace(ws.Branch) != "" {
			if err := git(ctx, dir, "checkout", ws.Branch); err != nil {
				return "", err
			}
		}
		if err := git(ctx, dir, "pull", "--ff-only"); err != nil {
			return "", err
		}
		return dir, nil
	}
	if err := os.RemoveAll(dir); err != nil {
		return "", fmt.Errorf("clear workspace: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
		return "", fmt.Errorf("workspace parent: %w", err)
	}
	args := []string{"clone", "--depth", "1"}
	if strings.TrimSpace(ws.Branch) != "" {
		args = append(args, "--branch", ws.Branch)
	}
	args = append(args, ref, dir)
	if err := git(ctx, "", args...); err != nil {
		return "", err
	}
	return dir, nil
}

func ChangedFiles(ctx context.Context, dir string) []string {
	if dir == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		return nil
	}
	out, err := gitOutput(ctx, dir, "status", "--short")
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	changed := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			changed = append(changed, line)
		}
	}
	return changed
}

type FileChange struct {
	Path      string `json:"path"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

func DiffStats(ctx context.Context, dir string) []FileChange {
	if dir == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		return nil
	}
	statusOut, err := gitOutput(ctx, dir, "status", "--porcelain")
	if err != nil {
		return nil
	}
	changes := parseStatus(statusOut)
	if len(changes) == 0 {
		return nil
	}
	numstatOut, _ := gitOutput(ctx, dir, "diff", "--numstat", "HEAD")
	stats := parseNumstat(numstatOut)
	for i := range changes {
		if stat, ok := stats[changes[i].Path]; ok {
			changes[i].Additions = stat.Additions
			changes[i].Deletions = stat.Deletions
		}
	}
	return changes
}

func parseStatus(out string) []FileChange {
	var changes []FileChange
	for _, line := range strings.Split(out, "\n") {
		if len(line) < 4 {
			continue
		}
		code := strings.TrimSpace(line[:2])
		path := strings.TrimSpace(line[3:])
		if path == "" {
			continue
		}
		if strings.Contains(path, " -> ") {
			parts := strings.Split(path, " -> ")
			path = strings.TrimSpace(parts[len(parts)-1])
		}
		changes = append(changes, FileChange{Path: path, Status: statusLabel(code)})
	}
	return changes
}

func statusLabel(code string) string {
	switch {
	case strings.Contains(code, "A") || code == "??":
		return "added"
	case strings.Contains(code, "D"):
		return "deleted"
	case strings.Contains(code, "R"):
		return "renamed"
	case strings.Contains(code, "M"):
		return "modified"
	default:
		return "changed"
	}
}

func parseNumstat(out string) map[string]FileChange {
	stats := map[string]FileChange{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		path := strings.Join(fields[2:], " ")
		additions, _ := strconv.Atoi(fields[0])
		deletions, _ := strconv.Atoi(fields[1])
		stats[path] = FileChange{Path: path, Additions: additions, Deletions: deletions}
	}
	return stats
}

func git(ctx context.Context, dir string, args ...string) error {
	out, err := gitOutput(ctx, dir, args...)
	if err != nil {
		return fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(out))
	}
	return nil
}

func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	runCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = allowlistGitEnv()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
	cmd.WaitDelay = 5 * time.Second
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func allowlistGitEnv() []string {
	var env []string
	for _, k := range []string{"PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER", "SSH_AUTH_SOCK"} {
		if v := os.Getenv(k); v != "" {
			env = append(env, k+"="+v)
		}
	}
	return env
}
