package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"agentik/daemon/internal/protocol"
)

func TestOpenAIProviderRuntime(t *testing.T) {
	var seen struct {
		Auth  string
		Model string
		Msgs  []openAIChatMessage
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		seen.Auth = r.Header.Get("Authorization")
		var req openAIRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		seen.Model = req.Model
		seen.Msgs = req.Messages
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"done"}}],"usage":{"total_tokens":12}}`))
	}))
	defer srv.Close()

	rt := Provider{KindName: "openai", WorkRoot: t.TempDir(), BaseURL: srv.URL + "/v1", Client: srv.Client()}
	task := taskWithInput(t, protocol.TaskInput{Prompt: "ship it", SystemPrompt: "be precise", Model: "gpt-test"})
	task.Env = map[string]string{"OPENAI_API_KEY": "sk-test"}
	var emitted []protocol.TaskMessage
	res, err := rt.Run(context.Background(), task, func(m protocol.TaskMessage) { emitted = append(emitted, m) })
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if seen.Auth != "Bearer sk-test" || seen.Model != "gpt-test" {
		t.Fatalf("unexpected provider request: auth=%q model=%q", seen.Auth, seen.Model)
	}
	if len(seen.Msgs) != 2 || seen.Msgs[0].Role != "system" || seen.Msgs[1].Content != "ship it" {
		t.Fatalf("messages = %#v", seen.Msgs)
	}
	if len(emitted) != 1 || emitted[0].Content != "done" {
		t.Fatalf("emitted = %#v", emitted)
	}
	if res.(map[string]any)["provider"] != "openai" {
		t.Fatalf("result = %#v", res)
	}
}

func TestAnthropicProviderRuntime(t *testing.T) {
	var seen struct {
		Key   string
		Model string
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		seen.Key = r.Header.Get("x-api-key")
		var req anthropicRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		seen.Model = req.Model
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"anthropic ok"}],"usage":{"input_tokens":4,"output_tokens":2}}`))
	}))
	defer srv.Close()

	rt := Provider{KindName: "anthropic", WorkRoot: t.TempDir(), BaseURL: srv.URL + "/v1", Client: srv.Client()}
	task := taskWithInput(t, protocol.TaskInput{Prompt: "answer", Model: "claude-test"})
	task.Env = map[string]string{"ANTHROPIC_API_KEY": "ak-test"}
	var emitted []protocol.TaskMessage
	_, err := rt.Run(context.Background(), task, func(m protocol.TaskMessage) { emitted = append(emitted, m) })
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if seen.Key != "ak-test" || seen.Model != "claude-test" {
		t.Fatalf("unexpected provider request: key=%q model=%q", seen.Key, seen.Model)
	}
	if len(emitted) != 1 || emitted[0].Content != "anthropic ok" {
		t.Fatalf("emitted = %#v", emitted)
	}
}

func TestProviderRuntimeRequiresKeys(t *testing.T) {
	rt := Provider{KindName: "openai", WorkRoot: t.TempDir(), BaseURL: "http://example.test/v1"}
	_, err := rt.Run(context.Background(), taskWithInput(t, protocol.TaskInput{Prompt: "x"}), func(protocol.TaskMessage) {})
	if err == nil {
		t.Fatal("expected missing key error")
	}
}

func taskWithInput(t *testing.T, input protocol.TaskInput) protocol.ClaimedTask {
	t.Helper()
	b, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	return protocol.ClaimedTask{ID: "atask_test", Input: b, WorkDir: filepath.Join(t.TempDir(), "work")}
}
