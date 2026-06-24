import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output so Electron can run the server in production.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  // Keep sql.js external so it loads its bundled wasm from node_modules at runtime.
  serverExternalPackages: ["sql.js"],
  // Runtime-only data dirs must never be pulled into the server file trace.
  outputFileTracingExcludes: {
    "*": ["./next.config.ts", "./src/skills/**", "./.data/**", "./workspaces/**", "./release/**", "./dist-electron/**", "./vaultgate-production-workspace/**", "./src/assets/vaultgate-production-workspace/**"],
  },
};

export default nextConfig;
