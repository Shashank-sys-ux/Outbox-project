import { env } from "../config/env.js";
import { EmailSearchIndex } from "../modules/search/email-search.index.js";
import { elasticsearch } from "./elasticsearch.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";

export const emailSearchIndex = new EmailSearchIndex(
  elasticsearch,
  env.ELASTICSEARCH_INDEX,
  prisma,
  logger.child({ component: "search" }),
);
