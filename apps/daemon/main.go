// Command daemon is the agentik agent-execution daemon: it registers with the
// engine, claims queued agent tasks, runs them via a runtime adapter, and streams
// their output back. Phase 3 ships only the safe "echo" runtime.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"agentik/daemon/internal/client"
	"agentik/daemon/internal/config"
	"agentik/daemon/internal/health"
	"agentik/daemon/internal/identity"
	"agentik/daemon/internal/loop"
	"agentik/daemon/internal/probe"
	"agentik/daemon/internal/protocol"
	"agentik/daemon/internal/runtime"
)

const discoverEvery = 30 * time.Second
const defaultRuntimes = "echo,claude,hermes,codex,openai,anthropic,openrouter,custom"

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[daemon] ")

	if err := runCLI(os.Args); err != nil {
		log.Fatalf("%v", err)
	}
}

func runCLI(args []string) error {
	if len(args) == 1 {
		return runDaemon(config.Options{})
	}
	if strings.HasPrefix(args[1], "agentik://") {
		return runDeepLink(args[1])
	}

	switch args[1] {
	case "setup":
		return runSetup(args[2:])
	case "disconnect":
		return runDisconnect(args[2:])
	case "doctor":
		return runDoctor(args[2:])
	case "daemon":
		return runDaemonCommand(args[2:])
	case "help", "-h", "--help":
		printHelp(os.Stdout)
		return nil
	default:
		return fmt.Errorf("unknown command %q\n\nRun `agentik help` for usage", args[1])
	}
}

func runDeepLink(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid deep link: %w", err)
	}
	if u.Scheme != "agentik" || u.Host != "setup" {
		return fmt.Errorf("unsupported deep link %q", raw)
	}
	q := u.Query()
	args := []string{
		"--url", q.Get("url"),
		"--token", q.Get("token"),
		"--runtimes", firstNonEmpty(q.Get("runtimes"), defaultRuntimes),
	}
	if q.Get("start") == "1" || q.Get("start") == "true" {
		args = append(args, "--start")
	}
	return runSetup(args)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func printHelp(w io.Writer) {
	fmt.Fprintln(w, `Agentik CLI

Usage:
  agentik setup --url http://localhost:8787 --token dtkn_... --start
  agentik 'agentik://setup?url=http%3A%2F%2Flocalhost%3A8787&token=dtkn_...&start=1'
  agentik disconnect
  agentik doctor
  agentik daemon start [--background]
  agentik daemon stop
  agentik daemon status

Running with no command starts the daemon, for Docker and legacy compatibility.`)
}

func runSetup(args []string) error {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	url := fs.String("url", "http://localhost:8787", "engine URL")
	token := fs.String("token", "", "personal daemon token from Settings > Connections")
	runtimes := fs.String("runtimes", defaultRuntimes, "comma-separated runtimes")
	workRoot := fs.String("work-root", "/tmp/agentik-work", "daemon work directory")
	maxConcurrent := fs.Int("max-concurrent", 2, "maximum concurrent tasks")
	configPath := fs.String("config", config.DefaultConfigPath(), "config file path")
	start := fs.Bool("start", false, "start the daemon in the background after setup")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *token == "" {
		return fmt.Errorf("--token is required")
	}
	kinds := parseRuntimeKinds(*runtimes)
	if len(kinds) == 0 {
		return fmt.Errorf("--runtimes must list at least one runtime")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	orgs, err := client.New(*url, *token).DiscoverOrgs(ctx)
	if err != nil {
		fmt.Printf("Engine check failed: %v\n", err)
		if !*start {
			return nil
		}
		return fmt.Errorf("refusing to start daemon until the engine check succeeds")
	}
	fmt.Printf("Engine check ok: %d eligible org(s)\n", len(orgs))
	if err := config.SaveFile(*configPath, config.File{
		EngineURL:      *url,
		Token:          *token,
		Runtimes:       kinds,
		WorkRoot:       *workRoot,
		MaxConcurrency: *maxConcurrent,
	}); err != nil {
		return fmt.Errorf("save config: %w", err)
	}
	fmt.Printf("Saved Agentik daemon config to %s\n", *configPath)
	if *start {
		return startBackgroundDaemon(*configPath, "", "", "")
	}
	return nil
}

func runDisconnect(args []string) error {
	fs := flag.NewFlagSet("disconnect", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	configPath := fs.String("config", config.DefaultConfigPath(), "config file path")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if err := stopBackgroundDaemon(); err != nil {
		return err
	}
	if err := os.Remove(*configPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	fmt.Printf("Removed Agentik daemon config from %s\n", *configPath)
	return nil
}

func runDoctor(args []string) error {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	configPath := fs.String("config", config.DefaultConfigPath(), "config file path")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := config.LoadWithOptions(config.Options{ConfigPath: *configPath})
	if err != nil {
		return err
	}
	fmt.Printf("Config: %s\n", *configPath)
	fmt.Printf("Engine: %s\n", cfg.EngineURL)
	fmt.Printf("Runtimes: %v\n", cfg.RuntimeKinds)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if cfg.UserToken != "" {
		orgs, err := client.New(cfg.EngineURL, cfg.UserToken).DiscoverOrgs(ctx)
		if err != nil {
			fmt.Printf("Token: invalid or engine unreachable (%v)\n", err)
		} else {
			fmt.Printf("Token: ok, %d eligible org(s)\n", len(orgs))
		}
	} else {
		fmt.Println("Token: legacy DAEMON_AUTH_TOKEN mode")
	}
	for _, t := range probe.Tools() {
		status := "missing"
		if t.Available && t.Authenticated {
			status = "ready"
		} else if t.Available {
			status = "sign in needed"
		}
		fmt.Printf("CLI %s: %s", t.Name, status)
		if t.Version != "" {
			fmt.Printf(" (%s)", t.Version)
		}
		fmt.Println()
	}
	return nil
}

func runDaemonCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("missing daemon command: start, stop, status, logs")
	}
	switch args[0] {
	case "start", "run":
		return runDaemonStart(args[1:], args[0] == "run")
	case "stop":
		return stopBackgroundDaemon()
	case "status":
		return daemonStatus()
	case "logs":
		return daemonLogs()
	default:
		return fmt.Errorf("unknown daemon command %q", args[0])
	}
}

func runDaemonStart(args []string, forceForeground bool) error {
	fs := flag.NewFlagSet("daemon start", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	background := fs.Bool("background", false, "start daemon in the background")
	configPath := fs.String("config", config.DefaultConfigPath(), "config file path")
	engineURL := fs.String("url", "", "engine URL")
	token := fs.String("token", "", "personal daemon token")
	runtimes := fs.String("runtimes", "", "comma-separated runtimes")
	if err := fs.Parse(args); err != nil {
		return err
	}
	opts := config.Options{
		ConfigPath:   *configPath,
		EngineURL:    *engineURL,
		UserToken:    *token,
		RuntimeKinds: *runtimes,
	}
	if *background && !forceForeground {
		return startBackgroundDaemon(*configPath, *engineURL, *token, *runtimes)
	}
	return runDaemon(opts)
}

func runDaemon(opts config.Options) error {
	cfg, err := config.LoadWithOptions(opts)
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	available := runtime.Registry{
		"echo":       runtime.Echo{},
		"claude":     runtime.Claude{WorkRoot: cfg.WorkRoot, Model: cfg.ClaudeModel, TimeoutMs: cfg.TaskTimeoutMs},
		"hermes":     runtime.Hermes{WorkRoot: cfg.WorkRoot, Model: os.Getenv("HERMES_MODEL"), TimeoutMs: cfg.TaskTimeoutMs},
		"codex":      runtime.Codex{WorkRoot: cfg.WorkRoot, Model: os.Getenv("CODEX_MODEL"), TimeoutMs: cfg.TaskTimeoutMs},
		"openai":     runtime.Provider{KindName: "openai", WorkRoot: cfg.WorkRoot, Model: os.Getenv("OPENAI_MODEL"), TimeoutMs: cfg.TaskTimeoutMs},
		"anthropic":  runtime.Provider{KindName: "anthropic", WorkRoot: cfg.WorkRoot, Model: firstNonEmpty(os.Getenv("ANTHROPIC_MODEL"), cfg.ClaudeModel), TimeoutMs: cfg.TaskTimeoutMs},
		"openrouter": runtime.Provider{KindName: "openrouter", WorkRoot: cfg.WorkRoot, Model: os.Getenv("OPENROUTER_MODEL"), TimeoutMs: cfg.TaskTimeoutMs},
		"custom":     runtime.Provider{KindName: "custom", WorkRoot: cfg.WorkRoot, Model: os.Getenv("CUSTOM_MODEL"), BaseURL: os.Getenv("CUSTOM_BASE_URL"), TimeoutMs: cfg.TaskTimeoutMs},
	}
	selected := runtime.Registry{}
	for _, kind := range cfg.RuntimeKinds {
		rt, ok := available[kind]
		if !ok {
			return fmt.Errorf("unknown runtime kind %q (available: %v)", kind, available.Kinds())
		}
		selected[kind] = rt
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	slots := make(chan struct{}, cfg.MaxConcurrent)

	pid := os.Getpid()
	deviceName := identity.DeviceName()
	if _, err := health.Start(ctx, func() health.Status {
		return health.Status{
			DaemonID:   cfg.Name,
			DeviceName: deviceName,
			EngineURL:  cfg.EngineURL,
			PID:        pid,
			Runtimes:   cfg.RuntimeKinds,
		}
	}); err != nil {
		log.Printf("health server: %v", err)
	}

	if cfg.UserToken != "" {
		runPersonal(ctx, cfg, selected, slots)
		log.Print("shutdown")
		_ = os.Stdout.Sync()
		return nil
	}

	log.Printf("starting: engine=%s team=%s name=%s runtimes=%v max_concurrency=%d", cfg.EngineURL, cfg.Team, cfg.Name, cfg.RuntimeKinds, cfg.MaxConcurrent)
	l := loop.New(cfg, client.New(cfg.EngineURL, cfg.AuthToken), selected, slots)
	if err := l.Run(ctx); err != nil {
		return fmt.Errorf("loop: %w", err)
	}
	log.Print("shutdown")
	_ = os.Stdout.Sync()
	return nil
}

func parseRuntimeKinds(s string) []string {
	var out []string
	for _, kind := range stringsSplitComma(s) {
		if kind != "" {
			out = append(out, kind)
		}
	}
	return out
}

func stringsSplitComma(s string) []string {
	var out []string
	for _, raw := range strings.Split(s, ",") {
		if v := strings.TrimSpace(raw); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func stateDir() string {
	if dir, err := os.UserCacheDir(); err == nil && dir != "" {
		return filepath.Join(dir, "agentik")
	}
	return filepath.Join(os.TempDir(), "agentik")
}

func defaultPIDPath() string {
	return filepath.Join(stateDir(), "daemon.pid")
}

func defaultLogPath() string {
	return filepath.Join(stateDir(), "daemon.log")
}

func startBackgroundDaemon(configPath, url, token, runtimes string) error {
	if err := os.MkdirAll(stateDir(), 0o700); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	args := []string{exe, "daemon", "run", "--config", configPath}
	if url != "" {
		args = append(args, "--url", url)
	}
	if token != "" {
		args = append(args, "--token", token)
	}
	if runtimes != "" {
		args = append(args, "--runtimes", runtimes)
	}
	logFile, err := os.OpenFile(defaultLogPath(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer logFile.Close()
	devNull, err := os.Open(os.DevNull)
	if err != nil {
		return err
	}
	defer devNull.Close()
	proc, err := os.StartProcess(exe, args, &os.ProcAttr{
		Files: []*os.File{devNull, logFile, logFile},
		Env:   os.Environ(),
	})
	if err != nil {
		return err
	}
	if err := os.WriteFile(defaultPIDPath(), []byte(fmt.Sprintf("%d\n", proc.Pid)), 0o600); err != nil {
		_ = proc.Kill()
		return err
	}
	fmt.Printf("Daemon started pid=%d\n", proc.Pid)
	fmt.Printf("Logs: %s\n", defaultLogPath())
	return nil
}

func stopBackgroundDaemon() error {
	pid, err := readPID()
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Println("Daemon not running")
			return nil
		}
		return err
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		return err
	}
	_ = os.Remove(defaultPIDPath())
	fmt.Println("Daemon stopped")
	return nil
}

func daemonStatus() error {
	pid, err := readPID()
	if err != nil {
		fmt.Println("Daemon background process: not running")
		return nil
	}
	proc, err := os.FindProcess(pid)
	if err != nil || proc.Signal(syscall.Signal(0)) != nil {
		fmt.Println("Daemon background process: not running")
		return nil
	}
	fmt.Printf("Daemon background process: running pid=%d\n", pid)
	return nil
}

func daemonLogs() error {
	b, err := os.ReadFile(defaultLogPath())
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Printf("No daemon log at %s\n", defaultLogPath())
			return nil
		}
		return err
	}
	fmt.Print(string(b))
	return nil
}

func readPID() (int, error) {
	b, err := os.ReadFile(defaultPIDPath())
	if err != nil {
		return 0, err
	}
	var pid int
	if _, err := fmt.Sscanf(string(b), "%d", &pid); err != nil {
		return 0, err
	}
	return pid, nil
}

func runPersonal(ctx context.Context, cfg *config.Config, selected runtime.Registry, slots chan struct{}) {
	c := client.New(cfg.EngineURL, cfg.UserToken)
	type runningLoop struct {
		cancel context.CancelFunc
		slug   string
	}
	running := map[string]runningLoop{}
	done := make(chan string, 16)
	var wg sync.WaitGroup

	reconcile := func() {
		orgs, err := c.DiscoverOrgs(ctx)
		if err != nil {
			log.Printf("discover orgs: %v", err)
			return
		}
		seen := map[string]protocol.OrgRef{}
		for _, o := range orgs {
			seen[o.TeamID] = o
			if _, ok := running[o.TeamID]; ok {
				continue
			}
			orgCfg := *cfg
			orgCfg.Team = o.Slug
			orgCtx, cancel := context.WithCancel(ctx)
			running[o.TeamID] = runningLoop{cancel: cancel, slug: o.Slug}
			wg.Add(1)
			go func(o protocol.OrgRef, orgCfg config.Config) {
				defer wg.Done()
				log.Printf("personal loop start: org=%s runtimes=%v", o.Slug, orgCfg.RuntimeKinds)
				l := loop.New(&orgCfg, client.New(orgCfg.EngineURL, orgCfg.UserToken), selected, slots)
				if err := l.Run(orgCtx); err != nil {
					log.Printf("loop[%s]: %v", o.Slug, err)
				}
				done <- o.TeamID
			}(o, orgCfg)
		}
		for teamID, r := range running {
			if _, ok := seen[teamID]; ok {
				continue
			}
			log.Printf("personal loop stop: org=%s removed or no longer authorized", r.slug)
			r.cancel()
			delete(running, teamID)
		}
		if len(orgs) == 0 {
			log.Print("personal daemon: no owner/admin orgs available")
		}
	}

	log.Printf("starting personal daemon: engine=%s name=%s runtimes=%v max_concurrency=%d", cfg.EngineURL, cfg.Name, cfg.RuntimeKinds, cfg.MaxConcurrent)
	reconcile()
	t := time.NewTicker(discoverEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			for _, r := range running {
				r.cancel()
			}
			wg.Wait()
			return
		case teamID := <-done:
			delete(running, teamID)
		case <-t.C:
			reconcile()
		}
	}
}
