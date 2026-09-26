import type { Client } from "@elastic/elasticsearch";
import type { Redis } from "ioredis";
import { assertElasticsearchHealthy } from "../../infra/elasticsearch.js";
import type { HealthCheck } from "./health.service.js";

export function createRedisHealthCheck(client: Redis): HealthCheck {
  return {
    name: "redis",
    critical: true,
    check: async () => {
      const reply = await client.ping();
      if (reply !== "PONG") {
        throw new Error(`Unexpected Redis PING reply: ${reply}`);
      }
    },
  };
}

export function createElasticsearchHealthCheck(client: Client, timeoutMs: number): HealthCheck {
  return {
    name: "elasticsearch",
    critical: false,
    check: () => assertElasticsearchHealthy(client, timeoutMs),
  };
}
