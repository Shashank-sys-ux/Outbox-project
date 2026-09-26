import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      REDIS_URL: "redis://localhost:6379",
      ELASTICSEARCH_URL: "http://localhost:9200",
    },
  },
});
