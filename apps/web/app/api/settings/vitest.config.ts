import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));

export default defineConfig({
  root: webRoot,
  resolve: {
    alias: {
      "@": webRoot,
    },
  },
  test: {
    environment: "node",
    include: ["app/api/settings/**/*.test.ts"],
  },
});
