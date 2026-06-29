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
	KindName   string
	WorkRoot   string
	Model      string
	BaseURL    string
	TimeoutMs  int
	Client     *http.Client
	InvokeTool ToolInvokerFunc
}

func (p Provider) Kind() string { return p.KindName }

func (p Provider) WithToolInvoker(invoke ToolInvokerFunc) Runtime {
	next := p
	next.InvokeTool = invoke
	return next
}

type openAIChatMessage struct {
	Role       string           `json:"role"`
	Content    string           `json:"content,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
}

type openAIToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openAITool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string         `json:"name"`
		Description string         `json:"description,omitempty"`
		Parameters  map[string]any `json:"parameters,omitempty"`
	} `json:"function"`
}

type openAIRequest struct {
	Model      string              `json:"model"`
	Messages   []openAIChatMessage `json:"messages"`
	Tools      []openAITool        `json:"tools,omitempty"`
	ToolChoice string              `json:"tool_choice,omitempty"`
}

type openAIResponse struct {
	Choices []struct {
		Message openAIChatMessage `json:"message"`
	} `json:"choices"`
	Usage map[string]any `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
	Tools     []anthropicTool    `json:"tools,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type anthropicTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"input_schema,omitempty"`
}

type anthropicContentBlock struct {
	Type  string         `json:"type"`
	Text  string         `json:"text,omitempty"`
	ID    string         `json:"id,omitempty"`
	Name  string         `json:"name,omitempty"`
	Input map[string]any `json:"input,omitempty"`
}

type anthropicToolResultBlock struct {
	Type      string `json:"type"`
	ToolUseID string `json:"tool_use_id"`
	Content   string `json:"content"`
}

type anthropicResponse struct {
	Content []anthropicContentBlock `json:"content"`
	Usage   map[string]any          `json:"usage,omitempty"`
	Error   *struct {
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
	messages := []openAIChatMessage{}
	if sp := strings.TrimSpace(in.SystemPrompt); sp != "" {
		messages = append(messages, openAIChatMessage{Role: "system", Content: sp})
	}
	messages = append(messages, openAIChatMessage{Role: "user", Content: prompt})

	tools, byName := openAITools(in.Tools)
	var usage map[string]any
	for step := 0; step < 8; step++ {
		req := openAIRequest{Model: model, Messages: messages, Tools: tools}
		if len(tools) > 0 {
			req.ToolChoice = "auto"
		}
		var res openAIResponse
		if err := p.postJSON(ctx, baseURL+"/chat/completions", key, req, &res); err != nil {
			return nil, err
		}
		if res.Error != nil && res.Error.Message != "" {
			return nil, fmt.Errorf("%s runtime: %s", p.KindName, res.Error.Message)
		}
		usage = res.Usage
		if len(res.Choices) == 0 {
			return nil, fmt.Errorf("%s runtime returned no choices", p.KindName)
		}
		msg := res.Choices[0].Message
		if len(msg.ToolCalls) == 0 {
			out := strings.TrimSpace(msg.Content)
			if out != "" {
				emit(protocol.TaskMessage{Type: "text", Content: out})
			}
			return map[string]any{"result": out, "usage": usage, "provider": p.KindName, "model": model}, nil
		}
		if p.InvokeTool == nil {
			return nil, fmt.Errorf("%s runtime returned tool calls but no tool invoker is configured", p.KindName)
		}
		messages = append(messages, msg)
		for _, call := range msg.ToolCalls {
			tool, ok := byName[call.Function.Name]
			if !ok {
				return nil, fmt.Errorf("%s runtime requested unknown tool %q", p.KindName, call.Function.Name)
			}
			args, err := parseToolArgs(call.Function.Arguments)
			if err != nil {
				return nil, err
			}
			result, err := p.invokeRuntimeTool(ctx, task.ID, tool, args, emit)
			if err != nil {
				return nil, err
			}
			messages = append(messages, openAIChatMessage{
				Role:       "tool",
				ToolCallID: call.ID,
				Content:    toolResultContent(result),
			})
		}
	}
	return nil, fmt.Errorf("%s runtime exceeded tool-call loop limit", p.KindName)
}

func (p Provider) runAnthropic(ctx context.Context, task protocol.ClaimedTask, in protocol.TaskInput, prompt string, emit Emit) (any, error) {
	key := strings.TrimSpace(task.Env["ANTHROPIC_API_KEY"])
	if key == "" {
		return nil, fmt.Errorf("anthropic runtime requires ANTHROPIC_API_KEY")
	}
	baseURL := strings.TrimRight(pick(p.BaseURL, task.Env["ANTHROPIC_BASE_URL"], "https://api.anthropic.com/v1"), "/")
	model := pick(in.Model, p.Model, "claude-sonnet-4-6")
	req := anthropicRequest{
		Model:     model,
		MaxTokens: 4096,
		System:    strings.TrimSpace(in.SystemPrompt),
		Messages:  []anthropicMessage{{Role: "user", Content: prompt}},
		Tools:     anthropicTools(in.Tools),
	}
	_, byName := runtimeToolsByCallName(in.Tools)
	var usage map[string]any
	for step := 0; step < 8; step++ {
		var res anthropicResponse
		if err := p.postAnthropic(ctx, baseURL+"/messages", key, req, &res); err != nil {
			return nil, err
		}
		if res.Error != nil && res.Error.Message != "" {
			return nil, fmt.Errorf("anthropic runtime: %s", res.Error.Message)
		}
		usage = res.Usage
		var parts []string
		var toolResults []anthropicToolResultBlock
		for _, block := range res.Content {
			switch block.Type {
			case "text":
				if strings.TrimSpace(block.Text) != "" {
					parts = append(parts, strings.TrimSpace(block.Text))
				}
			case "tool_use":
				if p.InvokeTool == nil {
					return nil, fmt.Errorf("anthropic runtime returned tool calls but no tool invoker is configured")
				}
				tool, ok := byName[block.Name]
				if !ok {
					return nil, fmt.Errorf("anthropic runtime requested unknown tool %q", block.Name)
				}
				result, err := p.invokeRuntimeTool(ctx, task.ID, tool, block.Input, emit)
				if err != nil {
					return nil, err
				}
				toolResults = append(toolResults, anthropicToolResultBlock{
					Type:      "tool_result",
					ToolUseID: block.ID,
					Content:   toolResultContent(result),
				})
			}
		}
		if len(toolResults) == 0 {
			out := strings.Join(parts, "\n\n")
			if out != "" {
				emit(protocol.TaskMessage{Type: "text", Content: out})
			}
			return map[string]any{"result": out, "usage": usage, "provider": "anthropic", "model": model}, nil
		}
		req.Messages = append(req.Messages,
			anthropicMessage{Role: "assistant", Content: res.Content},
			anthropicMessage{Role: "user", Content: toolResults},
		)
	}
	return nil, fmt.Errorf("anthropic runtime exceeded tool-call loop limit")
}

func (p Provider) invokeRuntimeTool(ctx context.Context, taskID string, tool protocol.RuntimeTool, args map[string]any, emit Emit) (any, error) {
	if tool.RequireApproval {
		err := fmt.Errorf("tool %s requires approval before use", tool.ToolID)
		emit(protocol.TaskMessage{Type: "error", Tool: tool.ToolID, Content: err.Error()})
		return nil, err
	}
	emit(protocol.TaskMessage{Type: "tool_use", Tool: tool.ToolID, Input: args})
	result, err := p.InvokeTool(ctx, taskID, tool.ToolID, args)
	if err != nil {
		emit(protocol.TaskMessage{Type: "error", Tool: tool.ToolID, Content: err.Error()})
		return nil, err
	}
	emit(protocol.TaskMessage{Type: "tool_result", Tool: tool.ToolID, Output: result})
	return result, nil
}

func runtimeToolsByCallName(tools []protocol.RuntimeTool) ([]protocol.RuntimeTool, map[string]protocol.RuntimeTool) {
	if len(tools) == 0 {
		return nil, map[string]protocol.RuntimeTool{}
	}
	usable := make([]protocol.RuntimeTool, 0, len(tools))
	byName := make(map[string]protocol.RuntimeTool, len(tools))
	for _, tool := range tools {
		if strings.TrimSpace(tool.CallName) == "" || strings.TrimSpace(tool.ToolID) == "" {
			continue
		}
		usable = append(usable, tool)
		byName[tool.CallName] = tool
	}
	return usable, byName
}

func openAITools(tools []protocol.RuntimeTool) ([]openAITool, map[string]protocol.RuntimeTool) {
	usable, byName := runtimeToolsByCallName(tools)
	if len(usable) == 0 {
		return nil, byName
	}
	out := make([]openAITool, 0, len(usable))
	for _, tool := range usable {
		def := openAITool{Type: "function"}
		def.Function.Name = tool.CallName
		def.Function.Description = tool.Description
		def.Function.Parameters = tool.InputSchema
		out = append(out, def)
	}
	return out, byName
}

func anthropicTools(tools []protocol.RuntimeTool) []anthropicTool {
	usable, _ := runtimeToolsByCallName(tools)
	if len(usable) == 0 {
		return nil
	}
	out := make([]anthropicTool, 0, len(usable))
	for _, tool := range usable {
		out = append(out, anthropicTool{
			Name:        tool.CallName,
			Description: tool.Description,
			InputSchema: tool.InputSchema,
		})
	}
	return out
}

func parseToolArgs(raw string) (map[string]any, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]any{}, nil
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return nil, fmt.Errorf("invalid tool arguments: %w", err)
	}
	return args, nil
}

func toolResultContent(result any) string {
	if result == nil {
		return "null"
	}
	b, err := json.Marshal(result)
	if err != nil {
		return fmt.Sprint(result)
	}
	return string(b)
}

func (p Provider) openAIConfig(env map[string]string, inputModel string) (key, baseURL, model string, err error) {
	switch p.KindName {
	case "openai":
		key = strings.TrimSpace(env["OPENAI_API_KEY"])
		baseURL = pick(p.BaseURL, env["OPENAI_BASE_URL"], "https://api.openai.com/v1")
		model = pick(inputModel, p.Model, "gpt-5.4-mini")
	case "custom":
		key = strings.TrimSpace(pick(env["CUSTOM_API_KEY"], env["OPENAI_API_KEY"]))
		baseURL = pick(p.BaseURL, env["CUSTOM_BASE_URL"], env["OPENAI_BASE_URL"])
		model = pick(inputModel, p.Model, "gpt-5.4-mini")
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
