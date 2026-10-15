import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents stays off: under workerd its setTimeout dependency hangs every request.
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
