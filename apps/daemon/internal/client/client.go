// Package client is the daemon's HTTP client for the engine /daemon protocol.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"agentik/daemon/internal/protocol"
)

type Client struct {
	base  string
	token string
	hc    *http.Client
}

func New(base, token string) *Client {
	return &Client{base: base, token: token, hc: &http.Client{Timeout: 30 * time.Second}}
}

// do sends a JSON request with Bearer auth. out may be nil. Returns the status
// code so callers can distinguish 204 (no content) from a decoded body.
func (c *Client) do(ctx context.Context, path string, body, out any) (int, error) {
	var buf io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		buf = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, buf)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	res, err := c.hc.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		msg, _ := io.ReadAll(res.Body)
		return res.StatusCode, fmt.Errorf("%s → %d: %s", path, res.StatusCode, string(msg))
	}
	if out != nil && res.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(res.Body).Decode(out); err != nil {
			return res.StatusCode, err
		}
	}
	return res.StatusCode, nil
}

// DiscoverOrgs (personal daemon) lists the orgs this user's machine should serve,
// each with its org-scoped token. Authenticated with the personal DAEMON_USER_TOKEN.
func (c *Client) DiscoverOrgs(ctx context.Context) ([]protocol.OrgRef, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/daemon/orgs", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	res, err := c.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		msg, _ := io.ReadAll(res.Body)
		return nil, fmt.Errorf("/daemon/orgs → %d: %s", res.StatusCode, string(msg))
	}
	var out protocol.OrgsResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Orgs, nil
}

func (c *Client) Register(ctx context.Context, req protocol.RegisterRequest) (*protocol.RegisterResponse, error) {
	var out protocol.RegisterResponse
	if _, err := c.do(ctx, "/daemon/register", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) Heartbeat(ctx context.Context, daemonID string) error {
	_, err := c.do(ctx, "/daemon/heartbeat", protocol.HeartbeatRequest{DaemonID: daemonID}, nil)
	return err
}

// Claim returns nil (no error) when no task is available (HTTP 204).
func (c *Client) Claim(ctx context.Context, runtimeID string) (*protocol.ClaimedTask, error) {
	var out protocol.ClaimedTask
	code, err := c.do(ctx, "/daemon/runtimes/"+runtimeID+"/tasks/claim", nil, &out)
	if err != nil {
		return nil, err
	}
	if code == http.StatusNoContent || out.ID == "" {
		return nil, nil
	}
	return &out, nil
}

func (c *Client) Start(ctx context.Context, taskID string) error {
	_, err := c.do(ctx, "/daemon/tasks/"+taskID+"/start", struct{}{}, nil)
	return err
}

// SendMessages posts a batch and returns whether the task was cancelled meanwhile.
func (c *Client) SendMessages(ctx context.Context, taskID string, msgs []protocol.TaskMessage) (bool, error) {
	var out protocol.MessagesResponse
	if _, err := c.do(ctx, "/daemon/tasks/"+taskID+"/messages", protocol.MessagesRequest{Messages: msgs}, &out); err != nil {
		return false, err
	}
	return out.Cancel, nil
}

func (c *Client) Complete(ctx context.Context, taskID string, result any) error {
	_, err := c.do(ctx, "/daemon/tasks/"+taskID+"/complete", protocol.CompleteRequest{Result: result}, nil)
	return err
}

func (c *Client) Fail(ctx context.Context, taskID, msg string) error {
	_, err := c.do(ctx, "/daemon/tasks/"+taskID+"/fail", protocol.FailRequest{Error: msg}, nil)
	return err
}

// ClaimBundle returns nil (no error) when no bundle command is queued (HTTP 204).
func (c *Client) ClaimBundle(ctx context.Context, daemonID string) (*protocol.BundleCommand, error) {
	var out protocol.BundleCommand
	code, err := c.do(ctx, "/daemon/bundles/claim", map[string]string{"daemonId": daemonID}, &out)
	if err != nil {
		return nil, err
	}
	if code == http.StatusNoContent || out.ID == "" {
		return nil, nil
	}
	return &out, nil
}

func (c *Client) ReportBundle(ctx context.Context, id string, req protocol.BundleStatusRequest) error {
	_, err := c.do(ctx, "/daemon/bundles/"+id+"/status", req, nil)
	return err
}

// UpdateMeta refreshes the daemon's probed CLIs/host (e.g. after a bundle install).
func (c *Client) UpdateMeta(ctx context.Context, daemonID string, meta map[string]any) error {
	_, err := c.do(ctx, "/daemon/meta", protocol.MetaRequest{DaemonID: daemonID, Meta: meta}, nil)
	return err
}
