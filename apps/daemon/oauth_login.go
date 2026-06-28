package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os/exec"
	goruntime "runtime"
	"strings"
	"time"

	"agentik/daemon/internal/config"
)

// runLogin performs the Codex (ChatGPT) subscription OAuth on a machine with a
// browser, then hands the captured tokens to the engine for storage. This is the
// sinew-style loopback flow: the Codex CLI's OAuth client id only permits loopback
// redirect URIs, so the callback MUST land on this local listener — the engine
// can't host it. Run this wherever you have a browser (laptop), even when the
// daemon that will execute runs headless on a VPS; the tokens live in the engine.
func runLogin(args []string) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	configPath := fs.String("config", "", "path to the daemon config file")
	teamSlug := fs.String("team", "", "org slug (required with a personal token serving multiple orgs)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	provider := "codex"
	if fs.NArg() > 0 {
		provider = fs.Arg(0)
	}
	if provider != "codex" {
		return fmt.Errorf("only `codex` login is supported (got %q)", provider)
	}

	cfg, err := config.LoadWithOptions(config.Options{ConfigPath: *configPath})
	if err != nil {
		return err
	}
	// Works with either token kind: an org-scoped token (team resolved server-side)
	// or a personal token (we resolve which org via /daemon/orgs, optionally --team).
	bearer, teamID, err := resolveLoginAuth(cfg, *teamSlug)
	if err != nil {
		return err
	}

	// Bind the loopback callback. 1455 is Codex's registered port (1457 fallback).
	ln, port, err := bindLoopback(1455, 1457)
	if err != nil {
		return fmt.Errorf("bind loopback callback: %w", err)
	}
	defer ln.Close()
	redirectURI := fmt.Sprintf("http://localhost:%d/auth/callback", port)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	var start struct {
		AuthorizeURL string `json:"authorizeUrl"`
		State        string `json:"state"`
		CodeVerifier string `json:"codeVerifier"`
	}
	if err := postJSON(ctx, cfg.EngineURL+"/daemon/oauth/codex/start", bearer,
		map[string]any{"redirectUri": redirectURI, "teamId": teamID}, &start); err != nil {
		return fmt.Errorf("start codex oauth: %w", err)
	}

	type callback struct {
		code  string
		state string
		err   string
	}
	cbCh := make(chan callback, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		w.Header().Set("content-type", "text/html; charset=utf-8")
		if e := q.Get("error"); e != "" {
			fmt.Fprintf(w, "<h1>Login failed</h1><p>%s</p>", e)
			cbCh <- callback{err: e}
			return
		}
		fmt.Fprint(w, "<h1>Codex connected ✅</h1><p>You can close this tab and return to the terminal.</p>")
		cbCh <- callback{code: q.Get("code"), state: q.Get("state")}
	})
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	defer srv.Shutdown(context.Background())

	log.Printf("Opening your browser to authorize Codex…")
	log.Printf("If it doesn't open, visit:\n\n%s\n", start.AuthorizeURL)
	openBrowser(start.AuthorizeURL)

	var cb callback
	select {
	case cb = <-cbCh:
	case <-ctx.Done():
		return fmt.Errorf("timed out waiting for the OAuth callback")
	}
	if cb.err != "" {
		return fmt.Errorf("authorization rejected: %s", cb.err)
	}
	if cb.code == "" {
		return fmt.Errorf("no authorization code received")
	}
	if cb.state != start.State {
		return fmt.Errorf("state mismatch — aborting (possible CSRF)")
	}

	var result struct {
		Connected bool   `json:"connected"`
		AccountID string `json:"accountId"`
	}
	if err := postJSON(ctx, cfg.EngineURL+"/daemon/oauth/codex/exchange", bearer,
		map[string]any{"code": cb.code, "redirectUri": redirectURI, "codeVerifier": start.CodeVerifier, "teamId": teamID},
		&result); err != nil {
		return fmt.Errorf("exchange codex code: %w", err)
	}
	log.Printf("Codex connected for this org (account: %s). Runs can now use the subscription.", firstNonEmpty(result.AccountID, "unknown"))
	return nil
}

// resolveLoginAuth picks the Bearer token and target team for the login call.
// Org token → use it directly (engine derives the team). Personal token → resolve
// the org via /daemon/orgs (or --team slug when the machine serves several).
func resolveLoginAuth(cfg *config.Config, teamSlug string) (bearer string, teamID string, err error) {
	if cfg.AuthToken != "" {
		return cfg.AuthToken, "", nil
	}
	if cfg.UserToken == "" {
		return "", "", fmt.Errorf(
			"no daemon token configured; run `agentik setup --token <dtkn_…>` first",
		)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var orgs struct {
		Orgs []struct {
			TeamID string `json:"teamId"`
			Slug   string `json:"slug"`
			Name   string `json:"name"`
		} `json:"orgs"`
	}
	if err := getJSON(ctx, cfg.EngineURL+"/daemon/orgs", cfg.UserToken, &orgs); err != nil {
		return "", "", fmt.Errorf("list orgs: %w", err)
	}
	if len(orgs.Orgs) == 0 {
		return "", "", fmt.Errorf("this token serves no orgs")
	}
	if teamSlug != "" {
		for _, o := range orgs.Orgs {
			if o.Slug == teamSlug {
				return cfg.UserToken, o.TeamID, nil
			}
		}
		return "", "", fmt.Errorf("org %q not found for this token", teamSlug)
	}
	if len(orgs.Orgs) > 1 {
		var names []string
		for _, o := range orgs.Orgs {
			names = append(names, o.Slug)
		}
		return "", "", fmt.Errorf(
			"this token serves multiple orgs (%s); pass --team <slug>",
			strings.Join(names, ", "),
		)
	}
	return cfg.UserToken, orgs.Orgs[0].TeamID, nil
}

func getJSON(ctx context.Context, url, token string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		msg, _ := io.ReadAll(res.Body)
		return fmt.Errorf("%d: %s", res.StatusCode, string(msg))
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// bindLoopback binds 127.0.0.1 on the primary port, falling back to the secondary.
func bindLoopback(primary, fallback int) (net.Listener, int, error) {
	if ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", primary)); err == nil {
		return ln, primary, nil
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", fallback))
	if err != nil {
		return nil, 0, err
	}
	return ln, fallback, nil
}

func postJSON(ctx context.Context, url, token string, body, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		msg, _ := io.ReadAll(res.Body)
		return fmt.Errorf("%d: %s", res.StatusCode, string(msg))
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}

func openBrowser(target string) {
	var cmd string
	var args []string
	switch goruntime.GOOS {
	case "darwin":
		cmd = "open"
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler"}
	default:
		cmd = "xdg-open"
	}
	args = append(args, target)
	_ = exec.Command(cmd, args...).Start()
}
