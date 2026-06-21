// Package loop drives the daemon: register → heartbeat → claim → execute.
package loop

import (
	"context"
	"log"
	"sync"
	"time"

	"agentik/daemon/internal/client"
	"agentik/daemon/internal/config"
	"agentik/daemon/internal/probe"
	"agentik/daemon/internal/protocol"
	"agentik/daemon/internal/runtime"
)

const (
	heartbeatEvery = 5 * time.Second
	flushEvery     = 250 * time.Millisecond
	idlePoll       = 1 * time.Second
)

type Loop struct {
	cfg      *config.Config
	client   *client.Client
	runtimes runtime.Registry
}

func New(cfg *config.Config, c *client.Client, rt runtime.Registry) *Loop {
	return &Loop{cfg: cfg, client: c, runtimes: rt}
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
		if !claimed {
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(idlePoll):
			}
		}
	}
}

func (l *Loop) register(ctx context.Context) (*protocol.RegisterResponse, error) {
	req := protocol.RegisterRequest{
		Team: l.cfg.Team,
		Name: l.cfg.Name,
		Meta: map[string]any{
			"runtimes": l.cfg.RuntimeKinds,
			"tools":    probe.Tools(),
			"host":     probe.Host(),
		},
	}
	for _, kind := range l.cfg.RuntimeKinds {
		req.Runtimes = append(req.Runtimes, protocol.RegisterRuntime{Kind: kind})
	}
	return l.client.Register(ctx, req)
}

func (l *Loop) heartbeatLoop(ctx context.Context, daemonID string) {
	t := time.NewTicker(heartbeatEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := l.client.Heartbeat(ctx, daemonID); err != nil {
				log.Printf("heartbeat error: %v", err)
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
