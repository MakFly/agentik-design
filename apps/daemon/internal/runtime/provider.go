package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"agentik/daemon/internal/protocol"
)

// Provider runs a BYOK hosted model directly through its HTTP API. It is the
// normalized non-CLI adapter for OpenAI-compatible providers and Anthropic.
type Provider struct {
	KindName  string
	WorkRoot  string
	Model     string
	BaseURL   string
	TimeoutMs int
	Client    *http.Client
}

func (p Provider) Kind() string { return p.KindName }

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
}

type openAIResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Usage map[string]any `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type anthropicRequest struct {
	Model     string        `json:"model"`
	MaxTokens int           `json:"max_tokens"`
	System    string        `json:"system,omitempty"`
	Messages  []chatMessage `json:"messages"`
}

type anthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Usage map[string]any `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (p Provider) Run(ctx context.Context, task protocol.ClaimedTask, emit Emit) (any, error) {
	var in protocol.TaskInput
	_ = json.Unmarshal(task.Input, &in)
	prompt := strings.TrimSpace(in.Prompt)
	if prompt == "" {
		return nil, fmt.Errorf("empty prompt")
	}

	dir, cleanup, err := taskWorkDir(p.WorkRoot, task)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	_ = dir

	timeout := 5 * time.Minute
	if p.TimeoutMs > 0 {
		timeout = time.Duration(p.TimeoutMs) * time.Millisecond
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	if p.KindName == "anthropic" {
		return p.runAnthropic(runCtx, task, in, prompt, emit)
	}
	return p.runOpenAICompatible(runCtx, task, in, prompt, emit)
}

func (p Provider) runOpenAICompatible(ctx context.Context, task protocol.ClaimedTask, in protocol.TaskInput, prompt string, emit Emit) (any, error) {
	key, baseURL, model, err := p.openAIConfig(task.Env, in.Model)
	if err != nil {
		return nil, err
	}
	messages := []chatMessage{}
	if sp := strings.TrimSpace(in.SystemPrompt); sp != "" {
		messages = append(messages, chatMessage{Role: "system", Content: sp})
	}
	messages = append(messages, chatMessage{Role: "user", Content: prompt})
	var res openAIResponse
	if err := p.postJSON(ctx, baseURL+"/chat/completions", key, openAIRequest{Model: model, Messages: messages}, &res); err != nil {
		return nil, err
	}
	if res.Error != nil && res.Error.Message != "" {
		return nil, fmt.Errorf("%s runtime: %s", p.KindName, res.Error.Message)
	}
	out := ""
	if len(res.Choices) > 0 {
		out = strings.TrimSpace(res.Choices[0].Message.Content)
	}
	if out != "" {
		emit(protocol.TaskMessage{Type: "text", Content: out})
	}
	return map[string]any{"result": out, "usage": res.Usage, "provider": p.KindName, "model": model}, nil
}

func (p Provider) runAnthropic(ctx context.Context, task protocol.ClaimedTask, in protocol.TaskInput, prompt string, emit Emit) (any, error) {
	key := strings.TrimSpace(task.Env["ANTHROPIC_API_KEY"])
	if key == "" {
		return nil, fmt.Errorf("anthropic runtime requires ANTHROPIC_API_KEY")
	}
	baseURL := strings.TrimRight(pick(p.BaseURL, task.Env["ANTHROPIC_BASE_URL"], "https://api.anthropic.com/v1"), "/")
	model := pick(in.Model, p.Model, "claude-3-5-sonnet-latest")
	req := anthropicRequest{
		Model:     model,
		MaxTokens: 4096,
		System:    strings.TrimSpace(in.SystemPrompt),
		Messages:  []chatMessage{{Role: "user", Content: prompt}},
	}
	var res anthropicResponse
	if err := p.postAnthropic(ctx, baseURL+"/messages", key, req, &res); err != nil {
		return nil, err
	}
	if res.Error != nil && res.Error.Message != "" {
		return nil, fmt.Errorf("anthropic runtime: %s", res.Error.Message)
	}
	var parts []string
	for _, block := range res.Content {
		if block.Type == "text" && strings.TrimSpace(block.Text) != "" {
			parts = append(parts, strings.TrimSpace(block.Text))
		}
	}
	out := strings.Join(parts, "\n\n")
	if out != "" {
		emit(protocol.TaskMessage{Type: "text", Content: out})
	}
	return map[string]any{"result": out, "usage": res.Usage, "provider": "anthropic", "model": model}, nil
}

func (p Provider) openAIConfig(env map[string]string, inputModel string) (key, baseURL, model string, err error) {
	switch p.KindName {
	case "openai":
		key = strings.TrimSpace(env["OPENAI_API_KEY"])
		baseURL = pick(p.BaseURL, env["OPENAI_BASE_URL"], "https://api.openai.com/v1")
		model = pick(inputModel, p.Model, "gpt-4o-mini")
	case "openrouter":
		key = strings.TrimSpace(env["OPENROUTER_API_KEY"])
		baseURL = pick(p.BaseURL, env["OPENROUTER_BASE_URL"], "https://openrouter.ai/api/v1")
		model = pick(inputModel, p.Model, "openai/gpt-4o-mini")
	case "custom":
		key = strings.TrimSpace(pick(env["CUSTOM_API_KEY"], env["OPENROUTER_API_KEY"], env["OPENAI_API_KEY"]))
		baseURL = pick(p.BaseURL, env["CUSTOM_BASE_URL"], env["OPENAI_BASE_URL"], env["OPENROUTER_BASE_URL"])
		model = pick(inputModel, p.Model, "gpt-4o-mini")
	default:
		return "", "", "", fmt.Errorf("unsupported provider runtime %q", p.KindName)
	}
	if key == "" {
		return "", "", "", fmt.Errorf("%s runtime requires a provider API key", p.KindName)
	}
	baseURL = strings.TrimRight(baseURL, "/")
	if baseURL == "" {
		return "", "", "", fmt.Errorf("%s runtime requires CUSTOM_BASE_URL or adapter BaseURL", p.KindName)
	}
	return key, baseURL, model, nil
}

func (p Provider) postJSON(ctx context.Context, url, key string, body any, out any) error {
	return p.doJSON(ctx, url, map[string]string{"authorization": "Bearer " + key}, body, out)
}

func (p Provider) postAnthropic(ctx context.Context, url, key string, body any, out any) error {
	return p.doJSON(ctx, url, map[string]string{
		"x-api-key":         key,
		"anthropic-version": "2023-06-01",
	}, body, out)
}

func (p Provider) doJSON(ctx context.Context, url string, headers map[string]string, body any, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := p.Client
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return fmt.Errorf("%s runtime decode response: %w", p.KindName, err)
	}
	if res.StatusCode >= 400 {
		return fmt.Errorf("%s runtime http %d", p.KindName, res.StatusCode)
	}
	return nil
}
