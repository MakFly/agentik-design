import { describe, expect, test } from "vitest";
import {
  buildAgentikSetupCommand,
  buildDockerDaemonCommand,
} from "./runtimes-tab";

describe("daemon install commands", () => {
  test("uses the native Agentik CLI as the primary path", () => {
    const cmd = buildAgentikSetupCommand("dtkn_test", "https://engine.test");
    expect(cmd).toBe(
      "agentik setup --url https://engine.test --token dtkn_test --runtimes echo,claude,hermes --start",
    );
    expect(cmd).not.toContain("codex");
  });

  test("keeps Docker as an explicit runner path", () => {
    const cmd = buildDockerDaemonCommand("dtkn_test", "https://engine.test");
    expect(cmd).toBe(
      "docker run -d --name agentik-daemon -e ENGINE_URL=https://engine.test -e DAEMON_USER_TOKEN=dtkn_test -e RUNTIME_KINDS=echo,claude,hermes agentik-daemon:latest",
    );
  });
});
