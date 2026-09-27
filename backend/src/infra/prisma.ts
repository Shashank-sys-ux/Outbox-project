import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";
import { logger } from "./logger.js";

const log = logger.child({ component: "database" });

const adapter = new PrismaPg(
  { connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX },
  {
    onPoolError: (error) => log.error({ err: error }, "Idle database connection failed"),
    onConnectionError: (error) => log.error({ err: error }, "Database connection error"),
  },
);

export const prisma = new PrismaClient({ adapter });

export async function assertDatabaseHealthy(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
