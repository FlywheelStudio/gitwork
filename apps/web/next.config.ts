import type { NextConfig } from "next";

// Build-time driver split (decision 004). `pnpm cf:build` sets GITWORK_TARGET=cloudflare, so the
// Worker bundle gets only the D1 runtime; every other build gets only the libsql + nodemailer runtime. A runtime
// branch would let the bundler trace Node-only modules into the Worker.
const runtime =
  process.env.GITWORK_TARGET === "cloudflare"
    ? "./src/server/runtime/runtime.workerd.ts"
    : "./src/server/runtime/runtime.node.ts";

const nextConfig: NextConfig = {
  // cacheComponents stays off: under workerd its setTimeout dependency hangs every request.
  reactCompiler: true,
  transpilePackages: ["@gitwork/core", "@gitwork/db", "@gitwork/server"],
  serverExternalPackages: ["@libsql/client", "libsql", "nodemailer"],
  turbopack: {
    resolveAlias: {
      "@gitwork/runtime": runtime,
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
