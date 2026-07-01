"use client";

import { useParams, useRouter } from "next/navigation";
import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { MessageTiming } from "@/components/assistant-ui/message-timing";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import {
  EngineThreadHistoryProvider,
  EngineThreadList,
  EngineThreadTitle,
  useEngineThreadHistory,
} from "@/components/assistant-ui/engine-thread-history";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import icon from "@/public/favicon/icon.svg";
import {
  ComposerQuotePreview,
  QuoteBlock,
  SelectionToolbar,
} from "@/components/assistant-ui/quote";
import { ComposerTriggerPopover } from "@/components/assistant-ui/composer-trigger-popover";
import { DirectiveText } from "@/components/assistant-ui/directive-text";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useMentionAdapter,
  unstable_useSlashCommandAdapter,
  useAui,
  type Unstable_SlashCommand,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChartColumnIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  GlobeIcon,
  HelpCircleIcon,
  InboxIcon,
  LanguagesIcon,
  LightbulbIcon,
  MenuIcon,
  MicIcon,
  MoreHorizontalIcon,
  MoonIcon,
  PanelLeftIcon,
  PencilIcon,
  PencilLineIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  ShareIcon,
  SlashIcon,
  SquareIcon,
  SunIcon,
  WrenchIcon,
} from "lucide-react";
import {
  LexicalComposerInput,
  type DirectiveChipProps,
} from "@assistant-ui/react-lexical";
import { toast } from "sonner";
import Image from "next/image";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FC,
  type ReactNode,
} from "react";
import { useTheme } from "next-themes";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { type ModelOption } from "@/components/assistant-ui/model-selector";
import {
  buildModelOptions,
  ModelPickerSelect,
} from "@/components/assistant-ui/model-catalog";
import { DEFAULT_MODEL_ID } from "@/constants/model";
import { usePreferencesStore } from "@/lib/stores/preferences.store";
import { BUILTIN_TOOLS } from "@/lib/tools/catalog";
import { readCustomTools } from "@/lib/tools/custom-tools";

const Logo: FC<{ brandName?: string }> = ({ brandName = "assistant-ui" }) => {
  return (
    <div className="flex items-center gap-2 px-2 text-sm font-medium">
      <Image
        src={icon}
        alt="logo"
        className="size-5 dark:hue-rotate-180 dark:invert"
      />
      <span className="text-foreground/90">{brandName}</span>
    </div>
  );
};

const Sidebar: FC<{ collapsed?: boolean; brandName?: string }> = ({ collapsed, brandName = "assistant-ui" }) => {
  const { createNewThread } = useEngineThreadHistory();

  return (
    <aside
      className={cn(
        "flex h-full flex-col overflow-hidden transition-all duration-200",
        collapsed ? "w-0" : "w-65",
      )}
    >
      <div
        className={cn(
          "mt-2 flex h-12 shrink-0 items-center transition-[padding] duration-200",
          collapsed ? "px-3.5" : "px-6",
        )}
      >
        <Image
          src={icon}
          alt="logo"
          className="size-5 shrink-0 dark:hue-rotate-180 dark:invert"
        />
        <span
          className={cn(
            "text-foreground/90 ml-2 text-sm font-medium whitespace-nowrap transition-opacity duration-200",
            collapsed && "opacity-0",
          )}
        >
          {brandName}
        </span>
        {collapsed ? null : (
          <div className="ml-auto flex items-center gap-0.5">
            <DashboardSettingsButton />
            <ThemeModeToggle />
          </div>
        )}
      </div>
      {collapsed ? (
        <TooltipIconButton
          tooltip="New thread"
          side="right"
          variant="ghost"
          size="icon"
          className="mt-1 ml-2 size-8"
          onClick={createNewThread}
        >
          <PlusIcon className="size-4" />
        </TooltipIconButton>
      ) : (
        <div className="relative w-65 flex-1 overflow-y-auto p-3">
          <EngineThreadList />
        </div>
      )}
    </aside>
  );
};

const MobileSidebar: FC<{ brandName?: string }> = ({ brandName }) => {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 md:hidden"
        >
          <MenuIcon className="size-4" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-70 flex-col p-0">
        <div className="flex h-12 shrink-0 items-center px-4">
          <Logo brandName={brandName} />
        </div>
        <div className="relative flex-1 overflow-y-auto p-3">
          <EngineThreadList />
        </div>
      </SheetContent>
    </Sheet>
  );
};

// Model catalog (options + default) is computed once at the Base level from
// server-provided availability and shared via context, so ModelPicker can read it
// without prop-threading through Thread/Composer/ComposerAction.
const ModelCatalogContext = createContext<{
  models: ModelOption[];
  defaultModelId: string;
}>({ models: [], defaultModelId: DEFAULT_MODEL_ID });

const ModelPicker: FC = () => {
  const { models, defaultModelId } = useContext(ModelCatalogContext);
  return (
    <ModelPickerSelect
      models={models}
      defaultModelId={defaultModelId}
      triggerClassName="h-7 rounded-full"
    />
  );
};

const DashboardSettingsButton: FC = () => {
  const params = useParams<{ team: string }>();
  const router = useRouter();
  const team = params?.team ?? "";
  return (
    <TooltipIconButton
      variant="ghost"
      size="icon"
      tooltip="Settings"
      side="bottom"
      className="size-8"
      onClick={() => router.push(`/${team}/chat/settings`)}
    >
      <SettingsIcon className="size-4" />
    </TooltipIconButton>
  );
};

const ThemeModeToggle: FC = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <TooltipIconButton
      variant="ghost"
      size="icon"
      tooltip={isDark ? "Switch to light mode" : "Switch to dark mode"}
      side="bottom"
      className="ml-auto size-8"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <SunIcon className="hidden size-4 dark:block" />
      <MoonIcon className="size-4 dark:hidden" />
    </TooltipIconButton>
  );
};

const Header: FC<{
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}> = ({ sidebarCollapsed, onToggleSidebar }) => {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-4">
      <MobileSidebar />
      <TooltipIconButton
        variant="ghost"
        size="icon"
        tooltip={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        side="bottom"
        onClick={onToggleSidebar}
        className="hidden size-8 md:flex"
      >
        <PanelLeftIcon className="size-4" />
      </TooltipIconButton>
      <EngineThreadTitle />
      <DashboardSettingsButton />
      <ThemeModeToggle />
      <TooltipIconButton
        variant="ghost"
        size="icon"
        tooltip="Share"
        side="bottom"
        disabled
        className="size-8"
      >
        <ShareIcon className="size-4" />
      </TooltipIconButton>
    </header>
  );
};

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

/**
 * Bridge for cross-surface "send this prompt" requests (e.g. the assistant Agents screen's
 * "Nouvel agent" button dispatches `agentik:send-prompt` to start the conversational agent
 * creation). Always mounted inside the runtime so it works regardless of the current view.
 */
const SendPromptBridge: FC = () => {
  const aui = useAui();
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (!text || aui.thread().getState().isRunning) return;
      aui.thread().append({
        content: [{ type: "text", text }],
        runConfig: aui.composer().getState().runConfig,
      });
    };
    window.addEventListener("agentik:send-prompt", handler as EventListener);
    return () => window.removeEventListener("agentik:send-prompt", handler as EventListener);
  }, [aui]);
  return null;
};

const Thread: FC = () => {
  const isEmpty = useAuiState(isNewChatView);
  const { missingThreadId, createNewThread } = useEngineThreadHistory();
  const showMissingThread = Boolean(missingThreadId);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.5rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <SendPromptBridge />
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className={cn(
          "relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4",
          (isEmpty || showMissingThread) && "justify-center",
        )}
      >
        {showMissingThread ? (
          <div className="aui-thread-missing-root mx-auto mb-6 flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
            <h1 className="text-2xl font-semibold">Conversation not found</h1>
            <p className="text-muted-foreground mt-2 max-w-md text-sm leading-6">
              This conversation is not available in this browser history.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-5 h-8 rounded-full px-3.5"
              onClick={createNewThread}
            >
              Start a new thread
            </Button>
          </div>
        ) : (
          <AuiIf condition={isNewChatView}>
            <ThreadWelcome />
          </AuiIf>
        )}

        {!showMissingThread && (
          <>
            <div
              data-slot="aui_message-group"
              className="mb-14 flex flex-col gap-y-6 empty:hidden"
            >
              <ThreadPrimitive.Messages>
                {({ message }) => {
                  if (message.composer.isEditing) return <EditComposer />;
                  if (message.role === "user") return <UserMessage />;
                  return <AssistantMessage />;
                }}
              </ThreadPrimitive.Messages>
            </div>
          </>
        )}

        <ThreadPrimitive.ViewportFooter
          className={cn(
            "aui-thread-viewport-footer bg-background mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible pb-4 md:pb-6",
            !isEmpty && !showMissingThread && "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
            showMissingThread && "hidden",
          )}
        >
          <ThreadScrollToBottom />
          <Composer />
          <AuiIf condition={isNewChatView}>
            <div className="aui-thread-welcome-suggestions-shell min-h-19">
              <AuiIf condition={(s) => s.composer.isEmpty}>
                <ThreadSuggestions />
              </AuiIf>
            </div>
          </AuiIf>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>

      <SelectionToolbar />
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        className="aui-thread-scroll-to-bottom border-border bg-background text-foreground hover:bg-accent absolute -top-12 z-10 size-9 self-center rounded-full border shadow-md transition-colors disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto mb-6 flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
        How can I help you today?
      </h1>
    </div>
  );
};

type SuggestionGroup = {
  label: string;
  icon: ReactNode;
  options: { label: string; prompt: string }[];
};

// Product-relevant starters for an agent operator (not the generic AI-demo set).
const SUGGESTION_GROUPS: SuggestionGroup[] = [
  {
    label: "Operate",
    icon: <ChartColumnIcon />,
    options: [
      { label: "summarize today's runs", prompt: "Summarize today's runs: what succeeded, what failed, and what's still queued." },
      { label: "what needs approval", prompt: "List anything currently waiting for my approval and why." },
      { label: "agent health", prompt: "Give me a quick health check of my agents and their connected runtimes." },
    ],
  },
  {
    label: "Inbox",
    icon: <PencilLineIcon />,
    options: [
      { label: "triage my inbox", prompt: "Triage my inbox: group the latest messages by urgency and suggest next actions." },
      { label: "draft a reply", prompt: "Draft a concise, friendly reply to the most recent customer message." },
      { label: "chase an invoice", prompt: "Draft a polite payment reminder for an overdue invoice." },
    ],
  },
  {
    label: "Plan",
    icon: <LightbulbIcon />,
    options: [
      { label: "plan my week", prompt: "Help me plan my week: propose a focused schedule from my open tasks." },
      { label: "next best actions", prompt: "Based on recent activity, what are the 3 next best actions I should take?" },
      { label: "delegate to an agent", prompt: "Suggest which of my agents should handle each of my open tasks." },
    ],
  },
  {
    label: "Telegram",
    icon: <GlobeIcon />,
    options: [
      { label: "reply on Telegram", prompt: "Draft a reply to the latest Telegram message from the bound channel." },
      { label: "broadcast an update", prompt: "Write a short status update I can broadcast to my Telegram channel." },
    ],
  },
];

const suggestionChipClass =
  "aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors [&_svg]:size-4";

const ThreadSuggestions: FC = () => {
  const aui = useAui();
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const expandedGroup = SUGGESTION_GROUPS.find(
    (group) => group.label === expandedLabel,
  );

  const sendPrompt = (prompt: string) => {
    if (aui.thread().getState().isRunning) return;
    aui.thread().append({
      content: [{ type: "text", text: prompt }],
      runConfig: aui.composer().getState().runConfig,
    });
  };

  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-col gap-2 px-4">
      <div className="w-full scrollbar-none overflow-x-auto">
        <div className="mx-auto flex w-max items-center gap-2">
          {SUGGESTION_GROUPS.map((group) => (
            <Button
              key={group.label}
              variant="ghost"
              className={cn(
                suggestionChipClass,
                group.label === expandedLabel && "bg-muted",
              )}
              onClick={() =>
                setExpandedLabel(
                  group.label === expandedLabel ? null : group.label,
                )
              }
            >
              {group.icon}
              {group.label}
            </Button>
          ))}
        </div>
      </div>
      {expandedGroup && (
        <div
          key={expandedGroup.label}
          className="fade-in slide-in-from-top-1 animate-in w-full scrollbar-none overflow-x-auto duration-200"
        >
          <div className="mx-auto flex w-max items-center gap-2">
            {expandedGroup.options.map((option) => (
              <Button
                key={option.label}
                variant="ghost"
                className={suggestionChipClass}
                onClick={() => sendPrompt(option.prompt)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Real slash commands (OpenClaw/Hermes-style), built inside the composer so each
 * `execute` closes over the live runtime. `/new` resets the thread; `/summarize`,
 * `/translate` and `/inbox` send a real turn (the last maps to the engine's Gmail
 * read skill on capable agents); `/help` lists the set. No more console.log stubs.
 */
// /model cycles through these; "auto" clears the override (the agent's own model is used).
// The engine applies an override only when it matches the agent's provider, so a mismatch
// is safely ignored rather than erroring.
const MODEL_CYCLE = [
  "auto",
  "gpt-5.4-mini",
  "gpt-5.4",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "gemini-2.0-flash",
] as const;

function useSlashCommands(): readonly Unstable_SlashCommand[] {
  const aui = useAui();
  return useMemo(() => {
    const send = (text: string) => {
      if (aui.thread().getState().isRunning) return;
      aui.thread().append({
        content: [{ type: "text", text }],
        runConfig: aui.composer().getState().runConfig,
      });
    };
    return [
      {
        id: "new",
        description: "Start a new conversation",
        icon: "Plus",
        execute: () => window.dispatchEvent(new Event("agentik:new-thread")),
      },
      {
        id: "summarize",
        description: "Summarize this conversation",
        icon: "FileText",
        execute: () =>
          send("Résume notre conversation jusqu'ici en points clés concis."),
      },
      {
        id: "translate",
        description: "Translate the last reply to English",
        icon: "Languages",
        execute: () => send("Traduis ta dernière réponse en anglais."),
      },
      {
        id: "inbox",
        description: "Read my latest emails",
        icon: "Inbox",
        execute: () => send("Lis mes 5 derniers emails."),
      },
      {
        id: "agent",
        description: "Create a new agent (conversational)",
        icon: "Bot",
        execute: () =>
          send(
            "Aide-moi à créer un nouvel agent : demande-moi le nom, le but et les " +
              "instructions s'ils manquent, puis crée-le.",
          ),
      },
      {
        id: "model",
        description: "Switch the chat model (cycles; applies when the agent supports it)",
        icon: "Cpu",
        execute: () => {
          if (typeof window === "undefined") return;
          const cur = window.localStorage.getItem("assistant:model") ?? "auto";
          const idx = MODEL_CYCLE.indexOf(cur as (typeof MODEL_CYCLE)[number]);
          const next = MODEL_CYCLE[(idx + 1) % MODEL_CYCLE.length]!;
          if (next === "auto") window.localStorage.removeItem("assistant:model");
          else window.localStorage.setItem("assistant:model", next);
          toast("Modèle", {
            description:
              next === "auto"
                ? "Auto — le modèle propre à l'agent"
                : `${next} — appliqué au prochain tour si compatible avec le provider de l'agent`,
          });
        },
      },
      {
        id: "help",
        description: "List available commands",
        icon: "HelpCircle",
        execute: () =>
          toast("Slash commands", {
            description: "/new · /summarize · /translate · /inbox · /agent · /model · /help",
          }),
      },
    ];
  }, [aui]);
}

type MentionItem = {
  id: string;
  type: "tool";
  label: string;
  description: string;
  icon: string;
};

/** `@` mention items built from the live tool registry: built-in tools +
 * user-created custom tools. Mentioning `@name` scopes the turn to that tool
 * (the route reads the `:tool[name]` directive and restricts activeTools). */
function buildMentionItems(): MentionItem[] {
  const builtin: MentionItem[] = BUILTIN_TOOLS.map((t) => ({
    id: t.name,
    type: "tool",
    label: t.name,
    description: t.description,
    icon: "Wrench",
  }));
  const custom: MentionItem[] = readCustomTools()
    .filter((t) => t.name.trim())
    .map((t) => ({
      id: t.name,
      type: "tool",
      label: t.name,
      description: t.description,
      icon: "Globe",
    }));
  return [...builtin, ...custom];
}

const CUSTOM_TOOLS_KEY = "aui:dashboard:custom-tools";

function useToolMentionItems(): MentionItem[] {
  const [items, setItems] = useState<MentionItem[]>([]);
  useEffect(() => {
    const sync = () => setItems(buildMentionItems());
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === CUSTOM_TOOLS_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return items;
}

const slashIconMap: Record<string, FC<{ className?: string }>> = {
  FileText: FileTextIcon,
  Languages: LanguagesIcon,
  Globe: GlobeIcon,
  HelpCircle: HelpCircleIcon,
  Inbox: InboxIcon,
  Plus: PlusIcon,
  Wrench: WrenchIcon,
};

function DirectiveChip(props: DirectiveChipProps) {
  const { directiveId, directiveType, label } = props;
  const showWrench = directiveType !== "command";
  return (
    <span
      className="aui-directive-chip"
      data-directive-type={directiveType}
      data-directive-id={directiveId}
    >
      {showWrench && (
        <span className="aui-directive-chip-icon">
          <WrenchIcon className="size-3" />
        </span>
      )}
      <span className="aui-directive-chip-label">{label}</span>
    </span>
  );
}

const Composer: FC = () => {
  const submitMode = usePreferencesStore((s) => s.submitMode);
  const mentionItems = useToolMentionItems();
  const mention = unstable_useMentionAdapter({
    items: mentionItems,
    iconMap: slashIconMap,
    fallbackIcon: WrenchIcon,
  });
  const slashCommands = useSlashCommands();
  const slash = unstable_useSlashCommandAdapter({
    commands: slashCommands,
    removeOnExecute: true,
    iconMap: slashIconMap,
    fallbackIcon: SlashIcon,
  });

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            data-slot="aui_composer-shell"
            className="border-border/60 data-[dragging=true]:border-ring focus-within:border-border dark:border-muted-foreground/15 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))] dark:shadow-none"
          >
            <ComposerQuotePreview />
            <ComposerAttachments />
            <LexicalComposerInput
              directiveChip={DirectiveChip}
              submitMode={submitMode}
              placeholder="Send a message... (@ to mention, / for commands)"
              className="aui-composer-input [&_.aui-lexical-placeholder]:text-muted-foreground/80 relative max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none [&_.aui-directive-chip]:inline-flex [&_.aui-directive-chip]:items-baseline [&_.aui-directive-chip]:gap-1 [&_.aui-directive-chip]:rounded-md [&_.aui-directive-chip]:bg-blue-100 [&_.aui-directive-chip]:px-1.5 [&_.aui-directive-chip]:py-0.5 [&_.aui-directive-chip]:text-[13px] [&_.aui-directive-chip]:leading-none [&_.aui-directive-chip]:font-medium [&_.aui-directive-chip]:text-blue-700 dark:[&_.aui-directive-chip]:bg-blue-900/50 dark:[&_.aui-directive-chip]:text-blue-300 [&_.aui-directive-chip-icon]:self-center [&_.aui-lexical-input]:min-h-lh [&_.aui-lexical-input]:outline-none [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:top-0 [&_.aui-lexical-placeholder]:right-0 [&_.aui-lexical-placeholder]:left-0 [&_.aui-lexical-placeholder]:truncate [&_.aui-lexical-placeholder]:px-2.5 [&_.aui-lexical-placeholder]:py-1"
            />
            <ComposerAction />
          </div>
        </ComposerPrimitive.AttachmentDropzone>

        <ComposerTriggerPopover char="@" {...mention} />

        <ComposerTriggerPopover
          char="/"
          {...slash}
          emptyItemsLabel="No matching commands"
        />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <div className="flex items-center gap-1">
        <ComposerAddAttachment />
        <ModelPicker />
      </div>
      <div className="flex items-center gap-1.5">
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip="Voice input"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate size-7 rounded-full"
                aria-label="Start voice input"
              >
                <MicIcon className="aui-composer-dictate-icon size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip="Stop dictation"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
                aria-label="Stop voice input"
              >
                <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-7 rounded-full"
              aria-label="Send message"
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4.5" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-7 rounded-full"
              aria-label="Stop generating"
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantWorkingIndicator: FC = () => {
  const isEmpty = useAuiState((s) => s.message.content.length === 0);
  if (isEmpty) {
    return (
      <span
        data-slot="aui_assistant-message-indicator"
        className="text-muted-foreground inline-flex items-center gap-2 align-middle"
      >
        <DotMatrix state="connecting" aria-hidden />
        <span className="text-sm">Connecting</span>
      </span>
    );
  }
  return (
    <span
      data-slot="aui_assistant-message-indicator"
      className="animate-pulse font-sans"
      aria-label="Assistant is working"
    >
      {"●"}
    </span>
  );
};

const AssistantMessage: FC = () => {
  // reserves space for action bar and compensates with `-mb` for consistent msg spacing
  // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
  // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative mx-auto w-full max-w-(--thread-max-width) duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground px-2 leading-relaxed wrap-break-word"
      >
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ["group-chainOfThought", "group-reasoning"],
            "tool-call": ["group-chainOfThought", "group-tool"],
            "standalone-tool-call": [],
          })}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-tool":
                return (
                  <ToolGroupRoot variant="ghost">
                    <ToolGroupTrigger
                      count={part.indices.length}
                      active={part.status.type === "running"}
                    />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "group-reasoning": {
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallback {...part} />;
              case "indicator":
                return <AssistantWorkingIndicator />;
              case "data":
                return part.dataRendererUI;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ml-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ml-1 flex gap-1 duration-200"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
      <MessageTiming />
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      data-role="user"
      className="fade-in slide-in-from-bottom-1 animate-in mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [&:where(>*)]:col-start-2"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Quote>
            {(quote) => <QuoteBlock {...quote} />}
          </MessagePrimitive.Quote>
          <MessagePrimitive.Parts components={{ Text: DirectiveText }} />
        </div>
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2 peer-empty:hidden">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -mr-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2"
    >
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ml-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none">
          <LexicalComposerInput
            directiveChip={DirectiveChip}
            autoFocus
            className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none [&_.aui-directive-chip]:inline-flex [&_.aui-directive-chip]:items-baseline [&_.aui-directive-chip]:gap-1 [&_.aui-directive-chip]:rounded-md [&_.aui-directive-chip]:bg-blue-100 [&_.aui-directive-chip]:px-1.5 [&_.aui-directive-chip]:py-0.5 [&_.aui-directive-chip]:text-[13px] [&_.aui-directive-chip]:leading-none [&_.aui-directive-chip]:font-medium [&_.aui-directive-chip]:text-blue-700 dark:[&_.aui-directive-chip]:bg-blue-900/50 dark:[&_.aui-directive-chip]:text-blue-300 [&_.aui-directive-chip-icon]:self-center [&_.aui-lexical-input]:min-h-lh [&_.aui-lexical-input]:outline-none"
          />
          <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
            <ComposerPrimitive.Cancel asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3.5"
              >
                Cancel
              </Button>
            </ComposerPrimitive.Cancel>
            <ComposerPrimitive.Send asChild>
              <Button size="sm" className="h-8 rounded-full px-3.5">
                Update
              </Button>
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground mr-2 -ml-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

/** Controls handed to a custom header so it can drive the sidebar like the default one. */
export interface BaseHeaderControls {
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  /** The mobile sidebar trigger (renders the thread list in a sheet on small screens). */
  mobileMenu: ReactNode;
}

export const Base: FC<{
  team: string;
  threadId?: string;
  /** Hide the internal chat header (used when embedded in the app shell). */
  showHeader?: boolean;
  /** `{ [modelId]: hasKey }`, computed server-side (zero client fetch). */
  modelAvailability?: Record<string, boolean>;
  defaultModelId?: string;
  /** Wordmark shown in the thread sidebar. Defaults to the assistant-ui brand. */
  brandName?: string;
  /** Replace the default header entirely. Receives sidebar controls so it stays wired. */
  headerSlot?: (controls: BaseHeaderControls) => ReactNode;
  /** Start with the sessions rail collapsed (e.g. when embedded next to the app nav). */
  defaultSidebarCollapsed?: boolean;
}> = ({ team, threadId, showHeader = true, modelAvailability = {}, defaultModelId = DEFAULT_MODEL_ID, brandName, headerSlot, defaultSidebarCollapsed = false }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(defaultSidebarCollapsed);
  const models = useMemo(() => buildModelOptions(modelAvailability), [modelAvailability]);

  return (
    <ModelCatalogContext.Provider value={{ models, defaultModelId }}>
      <EngineThreadHistoryProvider team={team} routeThreadId={threadId}>
        <div className="bg-muted/30 flex h-full w-full">
        <div className="hidden md:block">
          <Sidebar collapsed={sidebarCollapsed} brandName={brandName} />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden p-2 md:pl-0">
          <div className="bg-background flex flex-1 flex-col overflow-hidden rounded-lg">
            {headerSlot
              ? headerSlot({
                  onToggleSidebar: () => setSidebarCollapsed(!sidebarCollapsed),
                  sidebarCollapsed,
                  mobileMenu: <MobileSidebar brandName={brandName} />,
                })
              : showHeader ? (
                <Header
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
                />
              ) : null}
            <main className="flex-1 overflow-hidden">
              <Thread />
            </main>
          </div>
        </div>
      </div>
      </EngineThreadHistoryProvider>
    </ModelCatalogContext.Provider>
  );
};
