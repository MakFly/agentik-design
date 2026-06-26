import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const scriptPath = path.resolve(process.cwd(), "../../scripts/install.sh");
  const body = await readFile(scriptPath, "utf8");
  return new Response(body, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
