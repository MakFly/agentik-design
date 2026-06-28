type Suspect = {
  category: string;
  path: string;
  reason: string;
};

function run(args: string[]) {
  const proc = Bun.spawnSync(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!proc.success) {
    throw new Error(`${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString();
}

const tracked = run(["git", "ls-files"])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const suspects: Suspect[] = [];

for (const path of tracked) {
  if (
    path.startsWith("apps/web/mocks/") ||
    path === "apps/web/public/mockServiceWorker.js"
  ) {
    suspects.push({
      category: "mock-layer",
      path,
      reason: "MSW is opt-in and should not remain in the production cockpit unless tests still require it.",
    });
  }

  if (
    path.startsWith("apps/web/features/workflow-builder/") ||
    path.startsWith("packages/workflow-engine/")
  ) {
    suspects.push({
      category: "parked-workflows",
      path,
      reason: "Workflow routes are currently redirected or marked in progress; keep only if workflow builder is restored as a real product surface.",
    });
  }

  if (
    path.startsWith("apps/web/components/examples/") ||
    path.startsWith("apps/web/components/runtime/demo-")
  ) {
    suspects.push({
      category: "demo-ui",
      path,
      reason: "Demo-only UI should not be reachable from the Hermes/OpenClaw cockpit runtime path.",
    });
  }

  if (
    path.startsWith("apps/web/components/landing/") ||
    path.startsWith("apps/web/public/landing/")
  ) {
    suspects.push({
      category: "marketing-surface",
      path,
      reason: "Landing assets are outside the authenticated operator cockpit; verify they still serve the current product strategy.",
    });
  }
}

const redirectPages: string[] = [];
for (const path of tracked) {
  if (!path.startsWith("apps/web/app/") || !path.endsWith("/page.tsx")) {
    continue;
  }
  const content = await Bun.file(path).text();
  if (
    /from "next\/navigation"|from 'next\/navigation'/.test(content) &&
    /redirect\(/.test(content)
  ) {
    redirectPages.push(path);
  }
}

for (const path of redirectPages) {
  suspects.push({
    category: "redirect-only-route",
    path,
    reason: "Route only redirects; either delete the route or restore the feature it represents.",
  });
}

const byCategory = new Map<string, Suspect[]>();
for (const suspect of suspects) {
  const group = byCategory.get(suspect.category) ?? [];
  group.push(suspect);
  byCategory.set(suspect.category, group);
}

console.log("# Dead Code Audit");
console.log("");
console.log(`Tracked files scanned: ${tracked.length}`);
console.log(`Suspects found: ${suspects.length}`);
console.log("");
for (const [category, items] of [...byCategory.entries()].sort()) {
  console.log(`## ${category}`);
  console.log("");
  for (const item of items.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`- ${item.path}`);
    console.log(`  - ${item.reason}`);
  }
  console.log("");
}
