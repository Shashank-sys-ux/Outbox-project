import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      APP_URL: "https://localhost:5173",
      DATABASE_URL: "postgresql://outbox:outbox_dev_password@localhost:5432/outbox",
      REDIS_URL: "redis://localhost:6379/15",
      ELASTICSEARCH_URL: "http://localhost:9200",
      ELASTICSEARCH_INDEX: "outbox-emails-test",
      SESSION_SECRET: "test-session-secret-that-is-long-enough-123",
      ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      MIN_SEND_DELAY_MS: "2000",
      MAX_EMAILS_PER_HOUR_PER_SENDER: "200",
    },
  },
});
