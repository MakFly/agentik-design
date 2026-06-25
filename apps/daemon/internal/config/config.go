// Package config loads daemon settings from the environment.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	EngineURL     string
	AuthToken     string
	Team          string
	Name          string
	WorkRoot      string
	RuntimeKinds  []string
	ClaudeModel   string
	TaskTimeoutMs int
	// BundleInstallEnabled gates running network installers on this host. Default false:
	// even if the engine enqueues an install, the daemon refuses unless this host opts in.
	// Daemon-side defense-in-depth for an RCE-class op (the engine policy is the other gate).
	BundleInstallEnabled bool
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// Load reads and validates the daemon environment. AuthToken is mandatory.
func Load() (*Config, error) {
	host, _ := os.Hostname()
	if host == "" {
		host = "daemon"
	}
	cfg := &Config{
		EngineURL: strings.TrimRight(getenv("ENGINE_URL", "http://localhost:8787"), "/"),
		AuthToken: os.Getenv("DAEMON_AUTH_TOKEN"),
		Team:      getenv("TEAM", "acme"),
		Name:        getenv("DAEMON_NAME", host),
		WorkRoot:    getenv("WORK_ROOT", "/tmp/agentik-work"),
		ClaudeModel: os.Getenv("CLAUDE_MODEL"),
	}
	cfg.TaskTimeoutMs, _ = strconv.Atoi(getenv("TASK_TIMEOUT_MS", "300000"))
	switch strings.ToLower(os.Getenv("BUNDLE_INSTALL_ENABLED")) {
	case "true", "1", "yes":
		cfg.BundleInstallEnabled = true
	}
	for _, k := range strings.Split(getenv("RUNTIME_KINDS", "echo"), ",") {
		if k = strings.TrimSpace(k); k != "" {
			cfg.RuntimeKinds = append(cfg.RuntimeKinds, k)
		}
	}
	if cfg.AuthToken == "" {
		return nil, fmt.Errorf("DAEMON_AUTH_TOKEN is required")
	}
	if len(cfg.RuntimeKinds) == 0 {
		return nil, fmt.Errorf("RUNTIME_KINDS must list at least one runtime")
	}
	return cfg, nil
}
