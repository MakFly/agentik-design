"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const OTHER_INPUT_MAX_LENGTH = 80;

export function IconOptionCard({
  icon,
  label,
  selected,
  onSelect,
  mode = "radio",
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
  mode?: "radio" | "checkbox";
}) {
  return (
    <button
      type="button"
      role={mode}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left transition-all",
        selected
          ? "border-[var(--mul-ink)] shadow-[inset_0_0_0_1px_var(--mul-ink)]"
          : "border-[var(--mul-line)] hover:border-[var(--mul-ink)]/30 hover:bg-[var(--mul-line-2)]",
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-[18px] leading-none text-[var(--mul-ink)]">
        {icon}
      </span>
      <span className="text-[14px] font-medium leading-tight text-[var(--mul-ink)]">{label}</span>
    </button>
  );
}

export function IconOtherOptionCard({
  icon,
  label,
  selected,
  onSelect,
  otherValue,
  onOtherChange,
  onConfirm,
  placeholder,
  mode = "radio",
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
  onConfirm: () => void;
  placeholder: string;
  mode?: "radio" | "checkbox";
}) {
  return (
    <div
      role={mode}
      aria-checked={selected}
      onClick={() => {
        if (!selected) onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left transition-all",
        selected
          ? "border-[var(--mul-ink)] shadow-[inset_0_0_0_1px_var(--mul-ink)]"
          : "cursor-pointer border-[var(--mul-line)] hover:border-[var(--mul-ink)]/30 hover:bg-[var(--mul-line-2)]",
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-[18px] leading-none text-[var(--mul-ink)]">
        {icon}
      </span>
      {selected ? (
        <input
          autoFocus
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && otherValue.trim()) {
              e.preventDefault();
              onConfirm();
            }
          }}
          placeholder={placeholder}
          maxLength={OTHER_INPUT_MAX_LENGTH}
          aria-label={placeholder}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] font-medium leading-tight text-[var(--mul-ink)] placeholder:text-[var(--mul-muted)]/60 focus:outline-none"
        />
      ) : (
        <span className="text-[14px] font-medium leading-tight text-[var(--mul-ink)]">{label}</span>
      )}
    </div>
  );
}

export { OTHER_INPUT_MAX_LENGTH };
