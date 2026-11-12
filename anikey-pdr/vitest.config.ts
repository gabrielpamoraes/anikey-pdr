import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5433/anikey_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      DATABASE_URL: TEST_DB,
      DIRECT_URL: TEST_DB,
      AUTH_SECRET: "test-secret-test-secret-test-secret-test-secret-0123",
      APP_URL: "http://localhost:3000",
      STORAGE_PROVIDER: "memory",
      EMAIL_PROVIDER: "memory",
      BCRYPT_COST: "4",
    },
  },
});
