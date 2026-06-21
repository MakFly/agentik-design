/**
 * Client-safe descriptors of the tools the assistant can use. This is the
 * display/selection layer over `lib/tools/registry.ts` (the executable tier).
 * It carries no `execute`/zod, so it is safe to import in client components
 * (settings UI, and later the `@` mention adapter in the composer).
 *
 * Keep `name` in sync with the keys of `codeTools` in registry.ts.
 */
export type ToolSource = "built-in" | "http" | "mcp";

export type ToolDescriptor = {
  /** Must match the tool key sent to the model. */
  name: string;
  label: string;
  description: string;
  source: ToolSource;
};

export const BUILTIN_TOOLS: readonly ToolDescriptor[] = [
  {
    name: "get_weather",
    label: "Get weather",
    description: "Current weather for any place by name (Open-Meteo, no key required).",
    source: "built-in",
  },
];
