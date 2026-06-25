// Package loop drives the daemon: register → heartbeat → claim → execute.
package loop

import (
	"context"
	"log"
	"sync"
	"time"

	"agentik/daemon/internal/bundle"
	"agentik/daemon/internal/client"
	"agentik/daemon/internal/config"
	"agentik/daemon/internal/probe"
	"agentik/daemon/internal/protocol"
	"agentik/daemon/internal/runtime"
)

const (
	heartbeatEvery = 5 * time.Second
	metaEvery      = 30 * time.Second
	flushEvery     = 250 * time.Millisecond
	idlePoll       = 1 * time.Second
)

type Loop struct {
	cfg      *config.Config
	client   *client.Client
	runtimes runtime.Registry
	slots    chan struct{}
}

func New(cfg *config.Config, c *client.Client, rt runtime.Registry, slots chan struct{}) *Loop {
	return &Loop{cfg: cfg, client: c, runtimes: rt, slots: slots}
}

// Run blocks until ctx is cancelled.
func (l *Loop) Run(ctx context.Context) error {
	reg, err := l.register(ctx)
	if err != nil {
		return err
	}
	log.Printf("registered daemon=%s runtimes=%v", reg.DaemonID, reg.Runtimes)

	go l.heartbeatLoop(ctx, reg.DaemonID)

	for {
		if ctx.Err() != nil {
			return nil
		}
		claimed := false
		for _, rt := range reg.Runtimes {
			if ctx.Err() != nil {
				return nil
			}
			task, err := l.client.Claim(ctx, rt.ID)
			if err != nil {
				log.Printf("claim error (%s): %v", rt.Kind, err)
				continue
			}
			if task == nil {
				continue
			}
			claimed = true
			l.execute(ctx, *task, rt.Kind)
		}
		// Bundle commands (install/upgrade a CLI) are polled alongside task claims.
		if l.pollBundle(ctx, reg.DaemonID) {
			claimed = true
		}
		if !claimed {
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(idlePoll):
			}
		}
	}
}

// meta is the daemon's self-description (advertised runtimes + probed CLIs + host),
// sent at register and refreshed after a bundle op changes what's installed.
func (l *Loop) meta() map[string]any {
	mode := "org"
	if l.cfg.UserToken != "" {
		mode = "personal"
	}
	return map[string]any{
		"runtimes":    l.cfg.RuntimeKinds,
		"tools":       probe.Tools(),
		"host":        probe.Host(),
		"installable": bundle.Installable(),
		"mode":        mode,
	}
}

func (l *Loop) register(ctx context.Context) (*protocol.RegisterResponse, error) {
	req := protocol.RegisterRequest{
		Team: l.cfg.Team,
		Name: l.cfg.Name,
		Meta: l.meta(),
	}
	for _, kind := range l.cfg.RuntimeKinds {
		req.Runtimes = append(req.Runtimes, protocol.RegisterRuntime{Kind: kind})
	}
	return l.client.Register(ctx, req)
}

// pollBundle claims one bundle command, runs it (when this host opted in), reports the
// outcome, and re-probes so a freshly (un)installed CLI shows up immediately. Returns
// true when a command was handled (so the loop skips its idle sleep).
func (l *Loop) pollBundle(ctx context.Context, daemonID string) bool {
	cmd, err := l.client.ClaimBundle(ctx, daemonID)
	if err != nil {
		log.Printf("bundle claim error: %v", err)
		return false
	}
	if cmd == nil {
		return false
	}
	log.Printf("bundle %s: %s %s", cmd.ID, cmd.Action, cmd.Kind)

	// Authorization is the engine's job: it only enqueues a bundle command when the
	// org's network-install policy is ON and the requester is an owner. The daemon
	// executes the allowlisted installer (it already runs claimed agent CLIs anyway).
	// 20 min covers the Hermes installer pulling Python/Node/ripgrep/ffmpeg.
	summary, runErr := bundle.Execute(ctx, cmd.Kind, cmd.Action, l.cfg.WorkRoot, 20*time.Minute)
	if runErr != nil {
		_ = l.client.ReportBundle(ctx, cmd.ID, protocol.BundleStatusRequest{Status: "failed", Error: runErr.Error()})
		return true
	}
	_ = l.client.ReportBundle(ctx, cmd.ID, protocol.BundleStatusRequest{Status: "done", Result: summary})
	// Re-probe so the newly available/removed CLI reflects in meta.tools right away.
	if err := l.client.UpdateMeta(ctx, daemonID, l.meta()); err != nil {
		log.Printf("meta refresh after bundle failed: %v", err)
	}
	return true
}

func (l *Loop) heartbeatLoop(ctx context.Context, daemonID string) {
	hb := time.NewTicker(heartbeatEvery)
	meta := time.NewTicker(metaEvery)
	defer hb.Stop()
	defer meta.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-hb.C:
			if err := l.client.Heartbeat(ctx, daemonID); err != nil {
				log.Printf("heartbeat error: %v", err)
			}
		case <-meta.C:
			if err := l.client.UpdateMeta(ctx, daemonID, l.meta()); err != nil {
				log.Printf("meta refresh error: %v", err)
			}
		}
	}
}

// execute runs one task: stream messages in batches, abort if the server reports
// the task was cancelled, then complete or fail.
func (l *Loop) execute(ctx context.Context, task protocol.ClaimedTask, kind string) {
	rt := l.runtimes[kind]
	if rt == nil {
		_ = l.client.Fail(ctx, task.ID, "no runtime for kind "+kind)
		return
	}
	log.Printf("task %s claimed (kind=%s)", task.ID, kind)

	if err := l.client.Start(ctx, task.ID); err != nil {
		log.Printf("start error %s: %v", task.ID, err)
		return
	}

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var (
		mu  sync.Mutex
		buf []protocol.TaskMessage
		seq int
	)
	emit := func(m protocol.TaskMessage) {
		mu.Lock()
		m.Seq = seq
		seq++
		buf = append(buf, m)
		mu.Unlock()
	}

	flush := func() (cancelled bool) {
		mu.Lock()
		batch := buf
		buf = nil
		mu.Unlock()
		if len(batch) == 0 {
			return false
		}
		c, err := l.client.SendMessages(ctx, task.ID, batch)
		if err != nil {
			log.Printf("messages error %s: %v", task.ID, err)
		}
		return c
	}

	type result struct {
		val any
		err error
	}
	done := make(chan result, 1)
	go func() {
		release, ok := l.acquireSlot(runCtx)
		if !ok {
			done <- result{nil, context.Canceled}
			return
		}
		defer release()
		val, err := rt.Run(runCtx, task, emit)
		done <- result{val, err}
	}()

	ticker := time.NewTicker(flushEvery)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if flush() {
				cancel() // server says cancelled → abort the runtime
			}
		case r := <-done:
			flush()
			switch {
			case r.err == context.Canceled || runCtx.Err() == context.Canceled:
				log.Printf("task %s cancelled", task.ID)
				_ = l.client.Fail(ctx, task.ID, "cancelled")
			case r.err != nil:
				log.Printf("task %s failed: %v", task.ID, r.err)
				_ = l.client.Fail(ctx, task.ID, r.err.Error())
			default:
				log.Printf("task %s completed", task.ID)
				_ = l.client.Complete(ctx, task.ID, r.val)
			}
			return
		}
	}
}

func (l *Loop) acquireSlot(ctx context.Context) (func(), bool) {
	if l.slots == nil {
		return func() {}, true
	}
	select {
	case l.slots <- struct{}{}:
		return func() { <-l.slots }, true
	case <-ctx.Done():
		return func() {}, false
	}
}
