"use client";

import { useMemo, useState, type ReactNode } from "react";
import { RadioTower, Plus, Send, ShieldCheck, Webhook, Trash2, BookOpen, Link2, Radio } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import {
  useChannels,
  useCreateTelegramConnection,
  useDeleteChannel,
  useRegisterChannelWebhook,
  useUseChannelPolling,
} from "./api";
import type { ChannelConnection } from "./types";

export function ChannelsScreen({ team }: { team: string }) {
  const channels = useChannels(team);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Channels"
        description="External operator surfaces for project tasks, run control, and compact status updates."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SetupGuideDialog />
            <CreateTelegramDialog team={team} />
          </div>
        }
      />

      {channels.isError ? (
        <ErrorState error={channels.error} onRetry={() => channels.refetch()} />
      ) : channels.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : channels.data?.items.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {channels.data.items.map((connection) => (
            <ChannelCard key={connection.id} connection={connection} team={team} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={RadioTower}
          title="No channels"
          description="Connect Telegram to control project tasks and runs from an approved chat."
          action={<CreateTelegramDialog team={team} />}
        />
      )}
    </div>
  );
}

function ChannelCard({ connection, team }: { connection: ChannelConnection; team: string }) {
  const webhookUrl = useMemo(() => {
    if (typeof window === "undefined") return connection.webhookPath;
    return `${window.location.origin}${connection.webhookPath}`;
  }, [connection.webhookPath]);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="size-4 text-muted-foreground" />
              {connection.label}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Telegram · updated {formatRelativeTime(connection.updatedAt)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <StatusBadge status={connection.status} size="sm" />
            <TransportBadge transport={connection.transport} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <ChannelMetric label="Identities" value={connection.identityCount} />
          <ChannelMetric label="Token" value={connection.botTokenConfigured ? "set" : "missing"} />
          <ChannelMetric label="Provider" value={connection.provider} />
        </div>

        <section className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-muted-foreground" />
            Pairing
          </div>
          <code className="overflow-x-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-xs">
            /start {connection.pairingCode}
          </code>
        </section>

        {connection.transport === "polling" ? (
          <section className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Radio className="size-4 text-muted-foreground" />
              Long polling active
            </div>
            <p className="text-xs text-muted-foreground">
              The engine pulls updates via <code className="font-mono">getUpdates</code>. No public URL or
              tunnel required — just pair a chat and send commands.
            </p>
          </section>
        ) : (
          <section className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Webhook className="size-4 text-muted-foreground" />
              Webhook
            </div>
            <code className="overflow-x-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-xs">
              {webhookUrl}
            </code>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {[
            "/projects",
            "/tasks project:<id>",
            "/run project:<id> \"Task\"",
            "/status <runId>",
            "/kill <runId>",
            "/learn project:<id> \"Memory\"",
          ].map((command) => (
            <Badge key={command} variant="outline" className="font-mono">
              {command}
            </Badge>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {connection.transport === "webhook" ? (
            <UsePollingButton connection={connection} team={team} />
          ) : (
            <RegisterWebhookDialog connection={connection} team={team} />
          )}
          <DeleteChannelButton connection={connection} team={team} />
        </div>
      </CardContent>
    </Card>
  );
}

function TransportBadge({ transport }: { transport: ChannelConnection["transport"] }) {
  return transport === "polling" ? (
    <Badge variant="outline" className="gap-1">
      <Radio className="size-3" />
      Polling
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1">
      <Webhook className="size-3" />
      Webhook
    </Badge>
  );
}

function UsePollingButton({ connection, team }: { connection: ChannelConnection; team: string }) {
  const usePolling = useUseChannelPolling(team);

  async function run() {
    try {
      const result = await usePolling.mutateAsync(connection.id);
      if (result.ok) toast.success("Switched to long polling — no public URL needed");
      else toast.error(result.error ?? "Could not switch to polling");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not switch to polling");
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={usePolling.isPending}>
      <Radio className="size-4" />
      Use polling
    </Button>
  );
}

function ChannelMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function DeleteChannelButton({ connection, team }: { connection: ChannelConnection; team: string }) {
  const remove = useDeleteChannel(team);

  async function confirm() {
    try {
      await remove.mutateAsync(connection.id);
      toast.success(`Deleted ${connection.label}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete channel");
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={remove.isPending}>
          <Trash2 className="size-4" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{connection.label}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the bot connection, its paired chats, and its message history. The Telegram
            bot itself is not deleted — revoke its token in @BotFather if you no longer need it. This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RegisterWebhookDialog({ connection, team }: { connection: ChannelConnection; team: string }) {
  const register = useRegisterChannelWebhook(team);
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");

  async function submit() {
    try {
      const result = await register.mutateAsync({ id: connection.id, baseUrl: baseUrl.trim() || undefined });
      if (result.ok) {
        toast.success(result.botUsername ? `Webhook live for @${result.botUsername}` : "Webhook registered");
        setOpen(false);
        setBaseUrl("");
      } else {
        toast.error(result.error ?? "Telegram refused the webhook");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not register webhook");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!connection.botTokenConfigured}>
          <Link2 className="size-4" />
          Webhook (advanced)
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Telegram webhook (advanced)</DialogTitle>
          <DialogDescription>
            Optional — this bot already works via long polling. Webhooks are lower-latency at scale but
            need a public <strong>https</strong> origin reachable from the internet; Telegram cannot
            reach <code>localhost</code>. In local dev, expose the engine (port 8787) with a tunnel and
            paste the tunnel origin below. You can switch back to polling anytime.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-base">Public engine origin (optional)</Label>
          <Input
            id="webhook-base"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://your-tunnel.trycloudflare.com"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to use the server&apos;s configured <code>ENGINE_PUBLIC_URL</code>.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={register.isPending}>
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateTelegramDialog({ team }: { team: string }) {
  const create = useCreateTelegramConnection(team);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("Telegram");
  const [botToken, setBotToken] = useState("");

  async function submit() {
    try {
      await create.mutateAsync({ label, botToken });
      setOpen(false);
      setLabel("Telegram");
      setBotToken("");
      toast.success("Telegram channel created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create channel");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Telegram
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Telegram</DialogTitle>
          <DialogDescription>
            Store the bot token, then pair an approved chat with the generated start command.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-label">Label</Label>
            <Input id="channel-label" value={label} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bot-token">Bot token</Label>
            <Input
              id="bot-token"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              placeholder="123456:ABC..."
              type="password"
            />
            <p className="text-xs text-muted-foreground">
              Get it from @BotFather with <code>/newbot</code>. New here?{" "}
              <span className="text-foreground">See the setup guide</span> in the header.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!label.trim() || create.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetupGuideDialog() {
  const steps: { title: string; body: ReactNode }[] = [
    {
      title: "Create the bot in Telegram",
      body: (
        <>
          Open Telegram, chat with <strong>@BotFather</strong>, send <code>/newbot</code>, then pick a
          name and a username ending in <code>bot</code>. BotFather replies with an HTTP API{" "}
          <strong>token</strong> like <code>123456789:AAH...</code>.
        </>
      ),
    },
    {
      title: "Add the token here",
      body: (
        <>
          Click <strong>Telegram</strong> (top right), paste the token, and create. We verify it with{" "}
          <code>getMe</code> on the spot — if Telegram says <em>Invalid bot passed</em> the token is
          wrong, so nothing dead gets saved. The token is encrypted at rest.
        </>
      ),
    },
    {
      title: "That's it — long polling is on by default",
      body: (
        <>
          New connections use <strong>long polling</strong>: the engine pulls updates with{" "}
          <code>getUpdates</code>. <strong>No public URL, no tunnel, no webhook</strong> needed — it
          works on <code>localhost</code> immediately.
        </>
      ),
    },
    {
      title: "Pair your chat",
      body: (
        <>
          In Telegram, send <code>/start &lt;pairing code&gt;</code> (shown on the card) to your bot.
          Commands are ignored until a chat is paired. Then try <code>/help</code> or{" "}
          <code>/projects</code>.
        </>
      ),
    },
    {
      title: "Webhook mode (optional, advanced)",
      body: (
        <>
          Prefer push delivery at scale? Use <strong>Webhook (advanced)</strong> on the card with a
          public <strong>https</strong> origin (a tunnel like{" "}
          <code>cloudflared tunnel --url http://localhost:8787</code> in dev, or{" "}
          <code>ENGINE_PUBLIC_URL</code> in prod). Switch back anytime with <strong>Use polling</strong>.
        </>
      ),
    },
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BookOpen className="size-4" />
          Setup guide
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a Telegram bot</DialogTitle>
          <DialogDescription>
            Five steps from zero to a bot that drives your projects and runs.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium">{step.title}</div>
                <div className="text-sm text-muted-foreground [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs">
                  {step.body}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="rounded-md border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
          Still silent? The bot only reacts to <strong>paired</strong> chats — send{" "}
          <code>/start &lt;code&gt;</code> first. A bot token can&apos;t run polling and a webhook at
          once: if you ever set a webhook, switch back with <strong>Use polling</strong>.
        </p>
      </DialogContent>
    </Dialog>
  );
}
