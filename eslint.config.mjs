import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Isolated dev servers (NEXT_DIST_DIR=.next-<name>) write generated code here.
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees (other branches checked out under .claude/worktrees) are not this tree's code.
    ".claude/**",
  ]),
  // Node scripts (e2e, fixtures) are CommonJS and load Playwright with require().
  {
    files: ["scripts/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
