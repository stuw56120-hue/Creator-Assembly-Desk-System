import { defineConfig } from "vitest/config";

// Vitest is scoped to C.A.D.S.'s own source only. The vendored Hyperframes
// monorepo (hyperframes-main/) is porting reference, not part of this build —
// its tests use bun:test and workspace aliases that don't resolve here.
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", "dist-electron", "hyperframes-main"],
    environment: "node",
  },
});
