"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function PasswordInput({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<typeof Input> & { wrapperClassName?: string }) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className={cn("relative", wrapperClassName)}>
      <Input
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={props.disabled}
        tabIndex={-1}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

export { PasswordInput };
