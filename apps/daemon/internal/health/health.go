// Package health exposes a local HTTP status endpoint for the running daemon.
package health

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"
)

// Status is returned by GET /health on the local daemon.
type Status struct {
	Running    bool     `json:"running"`
	DaemonID   string   `json:"daemonId,omitempty"`
	DeviceName string   `json:"deviceName"`
	EngineURL  string   `json:"engineUrl,omitempty"`
	PID        int      `json:"pid,omitempty"`
	Runtimes   []string `json:"runtimes,omitempty"`
}

// DefaultPort is the loopback health port unless AGENTIK_DAEMON_HEALTH_PORT is set.
const DefaultPort = 19514

// Port returns the configured health port.
func Port() int {
	if v := os.Getenv("AGENTIK_DAEMON_HEALTH_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return DefaultPort
}

// Server serves GET /health with a snapshot from the caller.
type Server struct {
	snapshot func() Status
	http     *http.Server
}

// Start listens on 127.0.0.1:port until ctx is cancelled.
func Start(ctx context.Context, snapshot func() Status) (*Server, error) {
	port := Port()
	mux := http.NewServeMux()
	s := &Server{snapshot: snapshot}
	mux.HandleFunc("/health", s.handleHealth)
	s.http = &http.Server{
		Addr:              fmt.Sprintf("127.0.0.1:%d", port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	ln, err := net.Listen("tcp", s.http.Addr)
	if err != nil {
		return nil, err
	}
	go func() {
		_ = s.http.Serve(ln)
	}()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.http.Shutdown(shutdown)
	}()
	return s, nil
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	st := s.snapshot()
	st.Running = true
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(st)
}
