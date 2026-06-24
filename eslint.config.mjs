import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

// Native flat config (no FlatCompat — eslint-config-next 16 + FlatCompat
// crash under ESLint 9.39). Uses the Next plugin's flat rule sets directly.
export default tseslint.config(
  {
    ignores: [
      "src/skills/**",
      ".archive/**",
      "electron/**",
      ".data/**",
      ".next/**",
      "node_modules/**",
      "dist-electron/**",
      "release/**",
      "claude-code-main/**",
      "hermes-agent-main/**",
      "opencode-dev/**",
      "ref/**",
      "vaultgate-production-workspace/**",
      "src/assets/**",
      "next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
);
