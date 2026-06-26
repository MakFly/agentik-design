// Package config loads daemon settings from flags, environment, and the local
// Agentik config file.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"agentik/daemon/internal/identity"
)

const defaultEngineURL = "http://localhost:8787"

type Config struct {
	EngineURL string
	AuthToken string
	// UserToken (DAEMON_USER_TOKEN) is a personal token: when set, this one daemon
	// serves ALL of the user's orgs (it discovers them and runs a loop per org).
	UserToken     string
	Team          string
	Name          string
	WorkRoot      string
	RuntimeKinds  []string
	ClaudeModel   string
	TaskTimeoutMs int
	MaxConcurrent int
}

type Options struct {
	ConfigPath     string
	EngineURL      string
	AuthToken      string
	UserToken      string
	Team           string
	Name           string
	WorkRoot       string
	RuntimeKinds   string
	ClaudeModel    string
	TaskTimeoutMs  int
	MaxConcurrent  int
	SkipConfigFile bool
}

type File struct {
	EngineURL      string   `json:"engineUrl"`
	Token          string   `json:"token"`
	Runtimes       []string `json:"runtimes,omitempty"`
	WorkRoot       string   `json:"workRoot,omitempty"`
	MaxConcurrency int      `json:"maxConcurrency,omitempty"`
}

func DefaultConfigPath() string {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "agentik", "config.json")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".config", "agentik", "config.json")
	}
	return filepath.Join(".", ".agentik", "config.json")
}

func LoadFile(path string) (*File, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var f File
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	return &f, nil
}

func SaveFile(path string, f File) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	return os.WriteFile(path, b, 0o600)
}

func first(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func envInt(key string) (int, bool) {
	v := os.Getenv(key)
	if v == "" {
		return 0, false
	}
	n, _ := strconv.Atoi(v)
	return n, true
}

func splitKinds(s string) []string {
	var out []string
	for _, k := range strings.Split(s, ",") {
		if k = strings.TrimSpace(k); k != "" {
			out = append(out, k)
		}
	}
	return out
}

func joinKinds(kinds []string) string {
	return strings.Join(kinds, ",")
}

// Load reads and validates the daemon environment.
func Load() (*Config, error) {
	return LoadWithOptions(Options{})
}

// LoadWithOptions reads and validates daemon config. Precedence is:
// explicit options, environment, config file, defaults.
func LoadWithOptions(opts Options) (*Config, error) {
	daemonID, err := identity.LoadOrCreate()
	if err != nil {
		return nil, fmt.Errorf("daemon identity: %w", err)
	}
	host, _ := os.Hostname()
	if host == "" {
		host = "daemon"
	}
	path := opts.ConfigPath
	if path == "" {
		path = DefaultConfigPath()
	}
	file := &File{}
	if !opts.SkipConfigFile {
		if loaded, err := LoadFile(path); err == nil {
			file = loaded
		} else if !os.IsNotExist(err) {
			return nil, fmt.Errorf("read config file: %w", err)
		}
	}
	runtimeKinds := first(opts.RuntimeKinds, os.Getenv("RUNTIME_KINDS"), joinKinds(file.Runtimes), "echo")
	taskTimeoutMs := 300000
	if n, ok := envInt("TASK_TIMEOUT_MS"); ok {
		taskTimeoutMs = n
	}
	if opts.TaskTimeoutMs != 0 {
		taskTimeoutMs = opts.TaskTimeoutMs
	}
	maxConcurrent := 2
	if file.MaxConcurrency != 0 {
		maxConcurrent = file.MaxConcurrency
	}
	if n, ok := envInt("DAEMON_MAX_CONCURRENCY"); ok {
		maxConcurrent = n
	}
	if opts.MaxConcurrent != 0 {
		maxConcurrent = opts.MaxConcurrent
	}
	cfg := &Config{
		EngineURL:     strings.TrimRight(first(opts.EngineURL, os.Getenv("ENGINE_URL"), file.EngineURL, defaultEngineURL), "/"),
		AuthToken:     first(opts.AuthToken, os.Getenv("DAEMON_AUTH_TOKEN")),
		UserToken:     first(opts.UserToken, os.Getenv("DAEMON_USER_TOKEN"), file.Token),
		Team:          first(opts.Team, os.Getenv("TEAM"), "acme"),
		Name:          first(opts.Name, os.Getenv("DAEMON_NAME"), daemonID),
		WorkRoot:      first(opts.WorkRoot, os.Getenv("WORK_ROOT"), file.WorkRoot, "/tmp/agentik-work"),
		RuntimeKinds:  splitKinds(runtimeKinds),
		ClaudeModel:   first(opts.ClaudeModel, os.Getenv("CLAUDE_MODEL")),
		TaskTimeoutMs: taskTimeoutMs,
		MaxConcurrent: maxConcurrent,
	}
	if (cfg.AuthToken == "") == (cfg.UserToken == "") {
		return nil, fmt.Errorf("set exactly one of DAEMON_AUTH_TOKEN or DAEMON_USER_TOKEN")
	}
	if len(cfg.RuntimeKinds) == 0 {
		return nil, fmt.Errorf("RUNTIME_KINDS must list at least one runtime")
	}
	if cfg.MaxConcurrent < 1 {
		return nil, fmt.Errorf("DAEMON_MAX_CONCURRENCY must be >= 1")
	}
	return cfg, nil
}
