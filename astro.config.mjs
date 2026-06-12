// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import yaml from "@rollup/plugin-yaml";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss(), yaml()],
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Runtime-tunable identify config (access: "secret" = read at runtime, not
      // bundled — change in the Cloudflare dashboard without a rebuild). Optional;
      // src/lib/ai/config.ts supplies defaults when unset.
      IDENTIFY_MODEL: envField.string({ context: "server", access: "secret", optional: true }),
      IDENTIFY_DAILY_LIMIT: envField.number({ context: "server", access: "secret", optional: true }),
    },
  },
});
