import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// The workspace keeps one .env at its root. Load it for dev and build (the standalone
// server behind `pnpm web:start` loads it with --env-file, as it skips this file);
// variables already set in the environment win.
for (const dir of [process.cwd(), resolve(process.cwd(), "../..")]) {
  const file = resolve(dir, ".env");
  if (existsSync(resolve(dir, "pnpm-workspace.yaml")) && existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

const config: NextConfig = {
  // The core and adapters are TypeScript source with .ts imports; Next compiles them.
  transpilePackages: ["@mnemon/core", "@mnemon/db", "@mnemon/anthropic", "@mnemon/voyage"],
  serverExternalPackages: ["postgres"],
  // A self-contained server for the web image (Dockerfile); `pnpm web:start` uses it too.
  output: "standalone",
  // Types are checked by `pnpm typecheck` (TypeScript 7) in CI, not by next build.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
  // Don't write AGENTS.md into the app on `next dev`; the repo's CLAUDE.md is the one guide.
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
