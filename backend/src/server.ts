import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./infra/logger.js";

const app = createApp();

app.listen(env.PORT, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, "Failed to start API server");
    process.exit(1);
  }
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, `API listening on http://localhost:${env.PORT}`);
});
