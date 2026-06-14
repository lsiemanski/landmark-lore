import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import yaml from "@rollup/plugin-yaml";

export default defineConfig({
  plugins: [yaml()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    passWithNoTests: true,
    alias: {
      "astro:env/server": resolve(import.meta.dirname, "./test/stubs/astro-env-server.ts"),
    },
  },
});
