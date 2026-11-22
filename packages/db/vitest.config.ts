import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Each test file creates and drops its own database; give Postgres time.
    hookTimeout: 30_000,
  },
});
