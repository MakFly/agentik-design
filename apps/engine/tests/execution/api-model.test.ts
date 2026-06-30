import { describe, expect, test } from "bun:test";
import {
  naturalProviderForKind,
  providerOfModel,
} from "../../src/execution/embedded/runtime/api";

describe("provider/model resolution helpers", () => {
  test("naturalProviderForKind maps runtime kinds to their provider", () => {
    expect(naturalProviderForKind("claude")).toBe("anthropic");
    expect(naturalProviderForKind("openai")).toBe("openai");
    expect(naturalProviderForKind("gemini")).toBe("google");
    expect(naturalProviderForKind("unknown")).toBeUndefined();
  });

  test("providerOfModel infers the provider from a model id prefix", () => {
    expect(providerOfModel("claude-opus-4-8")).toBe("anthropic");
    expect(providerOfModel("gpt-5.4-mini")).toBe("openai");
    expect(providerOfModel("o3-mini")).toBe("openai");
    expect(providerOfModel("gemini-2.0-flash")).toBe("google");
    expect(providerOfModel("mystery-model")).toBeUndefined();
  });
});
