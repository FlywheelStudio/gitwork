import type { NextConfig } from "next";

// Build-time driver split (decision 004). `pnpm cf:build` sets GITWORK_TARGET=cloudflare, so the
// Worker bundle gets only the D1 runtime; every other build gets only the libsql runtime. A runtime
// branch would let the bundler trace the native libsql module into the Worker.
const dbRuntime =
  process.env.GITWORK_TARGET === "cloudflare"
    ? "./src/server/db/runtime.workerd.ts"
    : "./src/server/db/runtime.node.ts";

const nextConfig: NextConfig = {
  // cacheComponents stays off: under workerd its setTimeout dependency hangs every request.
  reactCompiler: true,
  transpilePackages: ["@gitwork/core", "@gitwork/db"],
  serverExternalPackages: ["@libsql/client", "libsql"],
  turbopack: {
    resolveAlias: {
      "@gitwork/db-runtime": dbRuntime,
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
