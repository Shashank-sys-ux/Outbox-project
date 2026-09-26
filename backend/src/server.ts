import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, (error?: Error) => {
  if (error) {
    console.error("Failed to start API server", error);
    process.exit(1);
  }
  console.log(`API listening on http://localhost:${port}`);
});
