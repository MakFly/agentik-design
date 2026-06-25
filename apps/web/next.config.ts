import type { NextConfig } from "next";

// Workflow engine (apps/engine, Hono/Bun). Dev default :8787.
const API_URL = process.env.API_URL ?? "http://localhost:8787";

const nextConfig: NextConfig = {
  // Workspace TS packages consumed as source must be transpiled by Next.
  transpilePackages: ["@agentik/workflow-schema"],
  async rewrites() {
    return {
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: `${API_URL}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
