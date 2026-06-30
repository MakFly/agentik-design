"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Stack & spacing: cards expand on hover; anchored from the top (top-center).
      expand
      gap={10}
      offset={{ top: 20 }}
      mobileOffset={{ top: "max(16px, env(safe-area-inset-top))", left: 16, right: 16 }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // Shape only — colors are owned by richColors so these compose cleanly.
      toastOptions={{
        classNames: {
          toast: "rounded-xl shadow-lg gap-3 px-4 py-3.5",
          title: "text-sm font-medium leading-snug",
          description: "text-xs leading-relaxed opacity-90",
          icon: "shrink-0",
          actionButton: "rounded-md text-xs font-medium",
          cancelButton: "rounded-md text-xs font-medium",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--width": "min(380px, calc(100vw - 32px))",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
