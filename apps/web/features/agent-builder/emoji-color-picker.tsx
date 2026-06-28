"use client";

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const EMOJIS = [
  "🤖", "🧠", "🛠️", "🔍", "📊", "✍️", "📣", "🧪", "🚀", "🛡️", "📨", "💬",
  "🧭", "⚙️", "📈", "🗂️", "🔮", "🦾", "🧰", "🔭", "🎯", "🧩", "📝", "⚡",
];

/** Palette of token-friendly hues with good AA contrast against white foreground. */
const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];

export const DEFAULT_AGENT_COLOR = COLORS[0];

export function EmojiColorPicker({
  emoji,
  color,
  onChange,
}: {
  emoji?: string;
  color?: string;
  onChange: (patch: { emoji?: string; color?: string }) => void;
}) {
  const resolvedColor = color ?? DEFAULT_AGENT_COLOR;
  return (
    <Popover>
      <PopoverTrigger
        className="flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl shadow-sm ring-1 ring-black/5 transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ backgroundColor: resolvedColor }}
        aria-label="Change agent emoji and color"
      >
        <span className="drop-shadow-sm">{emoji ?? "🤖"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Emoji</p>
            <div className="grid grid-cols-8 gap-1">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onChange({ emoji: e })}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md text-lg hover:bg-surface-2",
                    emoji === e && "bg-surface-2 ring-1 ring-ring",
                  )}
                  aria-label={`Emoji ${e}`}
                  aria-pressed={emoji === e}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Color</p>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ color: c })}
                  className={cn(
                    "size-7 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110",
                    resolvedColor === c && "ring-2 ring-ring ring-offset-2 ring-offset-surface",
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                  aria-pressed={resolvedColor === c}
                />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
