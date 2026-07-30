import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/api/university-submissions/**/*.test.ts"],
  },
});
