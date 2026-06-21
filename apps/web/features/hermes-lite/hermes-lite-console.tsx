"use client";

import { useMemo, useState } from "react";
import { Bell, Bot, Check, Loader2, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { HERMES_SCENARIOS, getScenario } from "./catalog";
import { chatHermesLite, testNotifications } from "./api";
import type {
  CompanySize,
  HermesAgentAction,
  HermesChatMessage,
  HermesRunRequest,
  NotificationConfig,
  NotificationResult,
  ScenarioId,
} from "./types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const defaultNotificationConfig: NotificationConfig = {
  discord: { enabled: false, webhookUrl: "" },
  telegram: { enabled: false, botToken: "", chatId: "" },
};

const initialAssistantMessage =
  "Je suis Hermes Lite. Donne-moi une demande client ou une consigne operationnelle. Je te reponds, puis je propose uniquement des actions validables.";

export function HermesLiteConsole({ team }: { team: string }) {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("retail");
  const scenario = useMemo(() => getScenario(scenarioId), [scenarioId]);
  const [companyName, setCompanyName] = useState("Maison Luma");
  const [companySize, setCompanySize] = useState<CompanySize>("tpe");
  const [tone, setTone] = useState<HermesRunRequest["tone"]>("warm");
  const [isolation, setIsolation] = useState<HermesRunRequest["isolation"]>("approval-first");
  const [request, setRequest] = useState(scenario.defaultRequest);
  const [notifications, setNotifications] = useState<NotificationConfig>(defaultNotificationConfig);
  const [notificationResults, setNotificationResults] = useState<NotificationResult[]>([]);
  const [messages, setMessages] = useState<HermesChatMessage[]>([
    { id: "assistant_intro", role: "assistant", content: initialAssistantMessage },
  ]);
  const [input, setInput] = useState("Cliente fidele, commande en retard, demande retour hors delai. Que fais-tu ?");
  const [actions, setActions] = useState<HermesAgentAction[]>([]);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);

  function context(): HermesRunRequest {
    return {
      companyName,
      companySize,
      scenarioId,
      request,
      tone,
      isolation,
    };
  }

  function changeScenario(next: ScenarioId) {
    setScenarioId(next);
    setRequest(getScenario(next).defaultRequest);
    setActions([]);
    setActionLog([]);
  }

  async function sendMessage() {
    if (!input.trim() || isChatting) return;

    const userMessage: HermesChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setActions([]);
    setIsChatting(true);

    try {
      const response = await chatHermesLite({
        context: context(),
        messages: nextMessages,
      });
      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `${response.message}\n\n${response.nextQuestion}`,
        },
      ]);
      setActions(response.actions);
      if (response.memoryWrite) {
        pushLog(`Memoire proposee: ${response.memoryWrite}`);
      }
      toast.success(response.source === "openai" ? "Hermes a repondu avec OpenAI" : "Hermes a repondu en fallback local");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hermes ne peut pas repondre");
    } finally {
      setIsChatting(false);
    }
  }

  async function executeAction(action: HermesAgentAction) {
    setExecutingActionId(action.id);
    try {
      if (action.kind === "send_notification") {
        if (!notifications.discord.enabled && !notifications.telegram.enabled) {
          pushLog("Notification preparee. Active Discord ou Telegram pour l'envoyer.");
          toast.message("Notification preparee");
          return;
        }

        const sent = await testNotifications({
          config: notifications,
          title: action.label,
          summary: action.description,
        });
        setNotificationResults(sent.results);
        pushLog(`Notification: ${sent.results.map((item) => item.message).join(" ")}`);
        return;
      }

      const detail = action.payload.draft || action.payload.checklist || action.payload.policy || action.description;
      pushLog(`${action.label}: ${detail}`);
      toast.success(action.requiresApproval ? "Action preparee pour validation" : "Action executee localement");
    } finally {
      setExecutingActionId(null);
    }
  }

  function pushLog(entry: string) {
    setActionLog((current) => [entry, ...current].slice(0, 6));
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="secondary">Hermes Lite</Badge>
            <Badge variant="outline">Equipe {team}</Badge>
            <Badge variant="outline">{scenario.shortLabel}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Console agent pour TPE/PME</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Un agent conversationnel, un contexte metier, des actions explicites. Rien ne sort sans validation.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
          <span>{isolation === "auto-low-risk" ? "Auto faible risque" : isolation === "sandbox" ? "Sandbox" : "Validation d'abord"}</span>
        </div>
      </header>

      <div className="grid min-h-[calc(100dvh-190px)] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="flex min-h-[640px] flex-col">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4" aria-hidden="true" />
              Conversation
            </CardTitle>
            <CardDescription>Parle a Hermes. Il propose ensuite des actions que tu executes une par une.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4 p-4">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-lg bg-muted/30 p-3">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {isChatting ? (
                <div className="w-fit rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Hermes prepare sa reponse...
                  </span>
                </div>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="agent-message">Message</Label>
              <div className="flex flex-col gap-2 md:flex-row">
                <Textarea
                  id="agent-message"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  className="min-h-20"
                />
                <Button onClick={sendMessage} disabled={!input.trim() || isChatting} className="md:self-end">
                  {isChatting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                  Envoyer
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <aside className="flex flex-col gap-4">
          <ContextPanel
            companyName={companyName}
            setCompanyName={setCompanyName}
            companySize={companySize}
            setCompanySize={setCompanySize}
            scenarioId={scenarioId}
            changeScenario={changeScenario}
            tone={tone}
            setTone={setTone}
            isolation={isolation}
            setIsolation={setIsolation}
            request={request}
            setRequest={setRequest}
          />

          <ActionsPanel
            actions={actions}
            executingActionId={executingActionId}
            executeAction={executeAction}
          />

          <NotificationsPanel
            notifications={notifications}
            setNotifications={setNotifications}
            notificationResults={notificationResults}
          />

          <ActionLog actionLog={actionLog} />
        </aside>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: HermesChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={`max-w-[82%] whitespace-pre-line rounded-lg border px-3 py-2 text-sm leading-6 ${
        isUser ? "ml-auto bg-primary text-primary-foreground" : "bg-background"
      }`}
    >
      {message.content}
    </div>
  );
}

function ContextPanel({
  companyName,
  setCompanyName,
  companySize,
  setCompanySize,
  scenarioId,
  changeScenario,
  tone,
  setTone,
  isolation,
  setIsolation,
  request,
  setRequest,
}: {
  companyName: string;
  setCompanyName: (value: string) => void;
  companySize: CompanySize;
  setCompanySize: (value: CompanySize) => void;
  scenarioId: ScenarioId;
  changeScenario: (value: ScenarioId) => void;
  tone: HermesRunRequest["tone"];
  setTone: (value: HermesRunRequest["tone"]) => void;
  isolation: HermesRunRequest["isolation"];
  setIsolation: (value: HermesRunRequest["isolation"]) => void;
  request: string;
  setRequest: (value: string) => void;
}) {
  const scenario = getScenario(scenarioId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contexte</CardTitle>
        <CardDescription>{scenario.promise}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label="Societe">
          <Input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Taille">
            <Select value={companySize} onValueChange={(value) => setCompanySize(value as CompanySize)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="solo">Solo</SelectItem>
                  <SelectItem value="tpe">TPE</SelectItem>
                  <SelectItem value="pme">PME</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Metier">
            <Select value={scenarioId} onValueChange={(value) => changeScenario(value as ScenarioId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {HERMES_SCENARIOS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.shortLabel}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Ton">
            <Select value={tone} onValueChange={(value) => setTone(value as HermesRunRequest["tone"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="direct">Direct</SelectItem>
                  <SelectItem value="warm">Chaleureux</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Mode">
            <Select value={isolation} onValueChange={(value) => setIsolation(value as HermesRunRequest["isolation"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="sandbox">Sandbox</SelectItem>
                  <SelectItem value="approval-first">Validation</SelectItem>
                  <SelectItem value="auto-low-risk">Auto bas risque</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Demande de reference">
          <Textarea value={request} onChange={(event) => setRequest(event.target.value)} className="min-h-24" />
        </Field>

        <div className="flex flex-wrap gap-2">
          {scenario.tools.map((tool) => (
            <Badge key={tool} variant="secondary">
              {tool}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ActionsPanel({
  actions,
  executingActionId,
  executeAction,
}: {
  actions: HermesAgentAction[];
  executingActionId: string | null;
  executeAction: (action: HermesAgentAction) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>Hermes ne fait rien tout seul. Clique pour executer.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {actions.length ? (
          actions.map((action) => (
            <div key={action.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{action.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.description}</p>
                </div>
                <Badge variant={action.requiresApproval ? "secondary" : "outline"}>
                  {action.requiresApproval ? "validation" : "local"}
                </Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => executeAction(action)}
                disabled={executingActionId === action.id}
              >
                {executingActionId === action.id ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                Executer
              </Button>
            </div>
          ))
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">Envoie un message pour obtenir des actions.</p>
        )}
      </CardContent>
    </Card>
  );
}

function NotificationsPanel({
  notifications,
  setNotifications,
  notificationResults,
}: {
  notifications: NotificationConfig;
  setNotifications: (value: NotificationConfig | ((current: NotificationConfig) => NotificationConfig)) => void;
  notificationResults: NotificationResult[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4" aria-hidden="true" />
          Canaux
        </CardTitle>
        <CardDescription>Optionnel. Utilise seulement les actions de notification.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <NotificationSwitch
          label="Discord"
          checked={notifications.discord.enabled}
          onCheckedChange={(checked) =>
            setNotifications((current) => ({ ...current, discord: { ...current.discord, enabled: checked } }))
          }
        />
        <Input
          type="url"
          placeholder="Webhook Discord"
          value={notifications.discord.webhookUrl}
          onChange={(event) =>
            setNotifications((current) => ({
              ...current,
              discord: { ...current.discord, webhookUrl: event.target.value },
            }))
          }
        />
        <NotificationSwitch
          label="Telegram"
          checked={notifications.telegram.enabled}
          onCheckedChange={(checked) =>
            setNotifications((current) => ({ ...current, telegram: { ...current.telegram, enabled: checked } }))
          }
        />
        <Input
          placeholder="Bot token"
          value={notifications.telegram.botToken}
          onChange={(event) =>
            setNotifications((current) => ({
              ...current,
              telegram: { ...current.telegram, botToken: event.target.value },
            }))
          }
        />
        <Input
          placeholder="Chat id"
          value={notifications.telegram.chatId}
          onChange={(event) =>
            setNotifications((current) => ({
              ...current,
              telegram: { ...current.telegram, chatId: event.target.value },
            }))
          }
        />
        {notificationResults.length ? (
          <div className="flex flex-wrap gap-2">
            {notificationResults.map((item) => (
              <Badge key={`${item.channel}-${item.message}`} variant={item.ok ? "secondary" : "destructive"}>
                {item.channel}: {item.message}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ActionLog({ actionLog }: { actionLog: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Journal</CardTitle>
        <CardDescription>Trace locale des actions de cette session.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {actionLog.length ? (
          actionLog.map((item, index) => (
            <div key={`${item}-${index}`} className="rounded-md bg-muted px-2 py-1.5 text-xs leading-5">
              {item}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Aucune action executee.</p>
        )}
      </CardContent>
    </Card>
  );
}

function NotificationSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
