import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env.js";

export const elasticsearch = new Client({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 5000,
  maxRetries: 2,
});

export async function assertElasticsearchHealthy(client: Client, timeoutMs: number): Promise<void> {
  const health = await client.cluster.health({}, { requestTimeout: timeoutMs, maxRetries: 0 });
  if (health.status === "red") {
    throw new Error("Elasticsearch cluster status is red");
  }
}
