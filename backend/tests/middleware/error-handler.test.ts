import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "../../src/middleware/error-handler.js";
import { requestLogger } from "../../src/middleware/request-logger.js";
import { AppError } from "../../src/utils/errors.js";

function buildApp() {
  const app = express();
  app.use(requestLogger);

  app.get("/app-error", () => {
    throw AppError.conflict("Campaign already exists", { field: "idempotencyKey" });
  });

  app.get("/validation-error", () => {
    z.object({ email: z.email() }).parse({ email: "not-an-email" });
  });

  app.get("/async-crash", async () => {
    await Promise.resolve();
    throw new Error("connection failed for postgres://admin:hunter2@db/outbox");
  });

  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  it("returns the status, code and details of an AppError", async () => {
    const response = await request(buildApp()).get("/app-error");

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: "CONFLICT",
      message: "Campaign already exists",
      details: { field: "idempotencyKey" },
    });
  });

  it("turns zod errors into a 400 with field level details", async () => {
    const response = await request(buildApp()).get("/validation-error");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ path: "email" }),
    ]);
  });

  it("catches errors thrown in async handlers and hides internal details", async () => {
    const response = await request(buildApp()).get("/async-crash");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
  });
});
