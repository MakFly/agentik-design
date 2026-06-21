"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  slugifyToolName,
  type CustomTool,
  type ParamType,
  type ToolParam,
} from "@/lib/tools/custom-tools";

const PARAM_TYPES: ParamType[] = ["string", "number", "boolean"];

export function CustomToolDialog({
  open,
  onOpenChange,
  onSave,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (tool: CustomTool) => void;
  existingNames: string[];
}) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [url, setUrl] = useState("");
  const [params, setParams] = useState<ToolParam[]>([]);

  const name = slugifyToolName(label);
  const nameTaken = existingNames.includes(name);
  const valid = name.length > 0 && !nameTaken && /^https?:\/\//.test(url) && description.trim().length > 0;

  const reset = () => {
    setLabel("");
    setDescription("");
    setMethod("GET");
    setUrl("");
    setParams([]);
  };

  const submit = () => {
    if (!valid) return;
    onSave({
      id: crypto.randomUUID(),
      name,
      description: description.trim(),
      method,
      url: url.trim(),
      params: params.filter((p) => p.name.trim()),
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New tool</DialogTitle>
          <DialogDescription>
            An HTTP endpoint the assistant can call. Runs in your browser (public,
            CORS-enabled APIs).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-label">Name</Label>
            <Input
              id="ct-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Get stock price"
            />
            {name && (
              <p className="text-muted-foreground text-xs">
                Tool id: <code className="bg-muted rounded px-1">{name}</code>
                {nameTaken && <span className="text-destructive"> — already used</span>}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-desc">Description</Label>
            <Textarea
              id="ct-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the tool does — the model reads this to decide when to call it."
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:gap-2">
            <div className="flex flex-col gap-1.5 sm:w-28">
              <Label htmlFor="ct-method">Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as "GET" | "POST")}>
                <SelectTrigger id="ct-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="ct-url">URL</Label>
              <Input
                id="ct-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/quote"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Parameters</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setParams((p) => [...p, { name: "", type: "string", required: true }])
                }
              >
                <PlusIcon className="size-4" /> Add
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              GET → sent as query params; POST → sent as JSON body.
            </p>
            {params.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={p.name}
                  onChange={(e) =>
                    setParams((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  placeholder="param_name"
                  className="flex-1"
                />
                <Select
                  value={p.type}
                  onValueChange={(v) =>
                    setParams((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, type: v as ParamType } : x)),
                    )
                  }
                >
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARAM_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="flex items-center gap-1.5">
                  <Switch
                    checked={!!p.required}
                    onCheckedChange={(v) =>
                      setParams((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, required: v } : x)),
                      )
                    }
                    aria-label="Required"
                  />
                  <span className="text-muted-foreground text-xs">req</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => setParams((arr) => arr.filter((_, j) => j !== i))}
                  aria-label="Remove parameter"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={submit}>
            Create tool
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
