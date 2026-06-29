export const PERSONAL_RUNTIMES =
  "claude,hermes,codex,openai,anthropic,custom";

export const DEFAULT_ENGINE_URL =
  process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:8787";

export const DEFAULT_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

export function buildAgentikSetupCommand(
  token: string,
  engineUrl = DEFAULT_ENGINE_URL,
): string {
  return `agentik setup --url ${engineUrl} --token ${token} --runtimes ${PERSONAL_RUNTIMES} --start`;
}

export function buildInstallScriptCommand(appUrl = DEFAULT_APP_URL): string {
  return `curl -fsSL ${appUrl}/scripts/install.sh | bash`;
}

export function buildDockerDaemonCommand(
  token: string,
  engineUrl = DEFAULT_ENGINE_URL,
): string {
  return `docker run -d --name agentik-daemon -e ENGINE_URL=${engineUrl} -e DAEMON_USER_TOKEN=${token} -e RUNTIME_KINDS=${PERSONAL_RUNTIMES} agentik-daemon:latest`;
}

export function buildPersonalDaemonCommand(token: string): string {
  return buildAgentikSetupCommand(token);
}
