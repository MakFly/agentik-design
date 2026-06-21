"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { CloudIcon, DropletIcon, WindIcon } from "lucide-react";
import type { WeatherError, WeatherResult } from "@/lib/tools/get-weather";

type WeatherArgs = { location: string };

function isError(r: WeatherResult | WeatherError | undefined): r is WeatherError {
  return !!r && "error" in r;
}

/**
 * Custom render for the `get_weather` tool call. Registered into the model
 * context on mount; the message renderer picks it up via `part.toolUI`, falling
 * back to the raw `ToolFallback` when absent.
 */
export const WeatherToolUI = makeAssistantToolUI<WeatherArgs, WeatherResult | WeatherError>({
  toolName: "get_weather",
  render: ({ args, result, status }) => {
    if (status.type === "running" || !result) {
      return (
        <div className="bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-xl border p-3 text-sm">
          <CloudIcon className="size-4 animate-pulse" />
          <span className="truncate">
            Fetching weather{args?.location ? ` for ${args.location}` : ""}…
          </span>
        </div>
      );
    }

    if (isError(result)) {
      return (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-3 text-sm">
          {result.error}
        </div>
      );
    }

    return (
      <div className="bg-card flex w-full max-w-sm flex-col gap-3 rounded-2xl border p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{result.location}</div>
            <div className="text-muted-foreground text-xs">{result.condition}</div>
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {Math.round(result.temperature)}
            <span className="text-muted-foreground ml-0.5 text-sm font-normal">
              {result.unit}
            </span>
          </div>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {result.apparentTemperature != null && (
            <span className="inline-flex items-center gap-1">
              <CloudIcon className="size-3.5" />
              Feels {Math.round(result.apparentTemperature)}
              {result.unit}
            </span>
          )}
          {result.humidity != null && (
            <span className="inline-flex items-center gap-1">
              <DropletIcon className="size-3.5" />
              {result.humidity}%
            </span>
          )}
          {result.windSpeed != null && (
            <span className="inline-flex items-center gap-1">
              <WindIcon className="size-3.5" />
              {Math.round(result.windSpeed)} {result.windUnit}
            </span>
          )}
        </div>
      </div>
    );
  },
});
