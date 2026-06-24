// Command daemon is the agentik agent-execution daemon: it registers with the
// engine, claims queued agent tasks, runs them via a runtime adapter, and streams
// their output back. Phase 3 ships only the safe "echo" runtime.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"agentik/daemon/internal/client"
	"agentik/daemon/internal/config"
	"agentik/daemon/internal/loop"
	"agentik/daemon/internal/runtime"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[daemon] ")

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	available := runtime.Registry{
		"echo":   runtime.Echo{},
		"claude": runtime.Claude{WorkRoot: cfg.WorkRoot, Model: cfg.ClaudeModel, TimeoutMs: cfg.TaskTimeoutMs},
		"hermes": runtime.Hermes{WorkRoot: cfg.WorkRoot, Model: os.Getenv("HERMES_MODEL"), TimeoutMs: cfg.TaskTimeoutMs},
	}
	selected := runtime.Registry{}
	for _, kind := range cfg.RuntimeKinds {
		rt, ok := available[kind]
		if !ok {
			log.Fatalf("unknown runtime kind %q (available: %v)", kind, available.Kinds())
		}
		selected[kind] = rt
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("starting: engine=%s team=%s name=%s runtimes=%v", cfg.EngineURL, cfg.Team, cfg.Name, cfg.RuntimeKinds)
	l := loop.New(cfg, client.New(cfg.EngineURL, cfg.AuthToken), selected)
	if err := l.Run(ctx); err != nil {
		log.Fatalf("loop: %v", err)
	}
	log.Print("shutdown")
	_ = os.Stdout.Sync()
}
