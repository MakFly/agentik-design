import type { ToolSet } from "ai";
import { getWeather } from "./get-weather";

/**
 * Code-defined tools available to the chat. This is the static tier of the tool
 * system — tools shipped with the app, executed server-side. Dynamic tiers
 * (DB/HTTP-backed tools, MCP servers) merge into the same ToolSet at request
 * time in the chat route.
 */
export const codeTools: ToolSet = {
  get_weather: getWeather,
};
