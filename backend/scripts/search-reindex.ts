import { elasticsearch } from "../src/infra/elasticsearch.js";
import { logger } from "../src/infra/logger.js";
import { prisma } from "../src/infra/prisma.js";
import { closeRedisClient, redis } from "../src/infra/redis.js";
import { emailSearchIndex } from "../src/infra/search.js";

const BATCH_SIZE = 200;

async function main(): Promise<void> {
  await emailSearchIndex.ensureIndex();
  let cursor: string | undefined;
  let indexed = 0;
  let skipped = 0;

  for (;;) {
    const rows = await prisma.email.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) {
      break;
    }
    cursor = rows[rows.length - 1]?.id;
    const result = await emailSearchIndex.bulkIndex(rows.map((row) => row.id));
    indexed += result.indexed;
    skipped += result.skipped;
    logger.info({ indexed, skipped }, "Reindex progress");
  }

  await elasticsearch.indices.refresh({ index: emailSearchIndex.indexName });
  logger.info({ indexed, skipped, index: emailSearchIndex.indexName }, "Reindex complete");
}

main()
  .catch((error: unknown) => {
    logger.fatal({ err: error }, "Reindex failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await closeRedisClient(redis);
    await elasticsearch.close();
  });
