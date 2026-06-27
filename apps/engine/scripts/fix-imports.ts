import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "../src");

const MODULE_MAP: Record<string, string> = {
  "./db/client": "infra/db/client",
  "./db/ids": "infra/db/ids",
  "./db/schema": "infra/db/schema",
  "./env": "infra/env",
  "./hub": "infra/hub",
  "./crypto": "infra/crypto",
  "./queue": "infra/queue",
  "./oauth": "infra/oauth",
  "./validation": "infra/validation",
  "./control": "infra/control",
  "./auth": "app/middleware/auth",
  "./auth-routes": "gateway/routes/auth",
  "./auth-repo": "gateway/auth-repo",
  "./repo": "domains/workflows/repo",
  "./agents-repo": "domains/runs",
  "./learning-repo": "domains/learning/repo",
  "./chat-repo": "domains/chat/repo",
  "./orchestrator-repo": "domains/chat/orchestrator",
  "./projects-repo": "domains/projects/repo",
  "./settings-repo": "domains/settings/repo",
  "./providers-repo": "domains/settings/providers-repo",
  "./settings-schemas": "domains/settings/schemas",
  "./mcp-repo": "domains/mcp/repo",
  "./mcp-schemas": "domains/mcp/schemas",
  "./channels-repo": "domains/channels/repo",
  "./daemon-repo": "execution/daemon/repo",
  "./daemon-routes": "execution/daemon/routes",
  "./bundle-repo": "execution/bundle/repo",
  "./observability-repo": "observation/traces",
  "./task-scanner": "jobs/task-scanner",
  "./telegram-poller": "domains/channels/telegram/poller",
  "./review-agent": "domains/learning/reviews/agent",
  "./server": "app/server",
  "./worker": "execution/worker/worker",
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else if (ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function relImport(fromDir: string, target: string): string {
  const from = join(fromDir, "_");
  const to = join(SRC, target);
  let rel = relative(fromDir, to).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel.replace(/\.ts$/, "");
}

async function main() {
  const files = await walk(SRC);
  for (const file of files) {
    let src = await readFile(file, "utf8");
    const dir = file.slice(0, file.lastIndexOf("/"));
    let changed = false;
    for (const [oldImp, target] of Object.entries(MODULE_MAP)) {
      const patterns = [
        new RegExp(`from "${oldImp.replace(/\./g, "\\.")}"`, "g"),
        new RegExp(`from '${oldImp.replace(/\./g, "\\.")}'`, "g"),
      ];
      const next = relImport(dir, target);
      for (const re of patterns) {
        if (re.test(src)) {
          src = src.replace(re, `from "${next}"`);
          changed = true;
        }
      }
    }
    if (changed) {
      await writeFile(file, src);
      console.log("fixed", relative(SRC, file));
    }
  }
}

await main();
