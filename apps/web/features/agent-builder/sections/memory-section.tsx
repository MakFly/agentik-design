"use client";

import { useState } from "react";
import { Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { MemoryBinding, StoreId } from "@/types/domain";
import { useBuilderStore } from "../store-context";
import { fieldRow, SectionHeading } from "./section-kit";

export function MemorySection() {
  const memory = useBuilderStore((s) => s.config.memory);
  const setMemory = useBuilderStore((s) => s.setMemory);
  const [storeId, setStoreId] = useState("");

  const add = () => {
    const id = storeId.trim();
    if (!id || memory.some((m) => m.storeId === (id as StoreId))) return;
    setMemory([...memory, { storeId: id as StoreId, mode: "read", topK: 5, cite: true }]);
    setStoreId("");
  };

  const patch = (id: StoreId, p: Partial<MemoryBinding>) =>
    setMemory(memory.map((m) => (m.storeId === id ? { ...m, ...p } : m)));

  const remove = (id: StoreId) => setMemory(memory.filter((m) => m.storeId !== id));

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <SectionHeading title="Memory & context" hint="Attach stores for retrieval-augmented answers with citations." />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className={`${fieldRow} flex-1`}>
          <Label htmlFor="store-id">Store id</Label>
          <Input
            id="store-id"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="store_kb_support"
          />
        </div>
        <Button type="button" variant="outline" className="min-h-[44px]" onClick={add} disabled={!storeId.trim()}>
          <Plus className="size-4" /> Attach
        </Button>
      </div>

      {memory.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          No memory bound. Attach a store to enable retrieval-augmented answers with citations.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {memory.map((mb) => (
            <li key={mb.storeId} className="flex flex-col gap-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-sm">{mb.storeId}</span>
                <Button variant="ghost" size="icon" className="size-9" aria-label={`Remove ${mb.storeId}`} onClick={() => remove(mb.storeId)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className={fieldRow}>
                  <Label className="text-xs">Mode</Label>
                  <Select value={mb.mode} onValueChange={(mode) => patch(mb.storeId, { mode: mode as MemoryBinding["mode"] })}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read">Read</SelectItem>
                      <SelectItem value="read_write">Read &amp; write</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className={fieldRow}>
                  <Label className="text-xs">Top K</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    className="h-9"
                    value={mb.topK}
                    onChange={(e) => patch(mb.storeId, { topK: Number(e.target.value) })}
                  />
                </div>
                <label className="flex min-h-[44px] items-center gap-2 self-end text-xs text-muted-foreground">
                  <Switch checked={mb.cite} onCheckedChange={(cite) => patch(mb.storeId, { cite })} />
                  cite sources
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
