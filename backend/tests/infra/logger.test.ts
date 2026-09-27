import { describe, expect, it } from "vitest";
import { serializeError } from "../../src/infra/logger.js";

describe("serializeError", () => {
  it("keeps type, message, code and stack", () => {
    const error = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });

    expect(serializeError(error)).toMatchObject({
      type: "Error",
      message: "connection refused",
      code: "ECONNREFUSED",
      stack: expect.stringContaining("connection refused"),
    });
  });

  it("drops arbitrary properties such as attached driver clients", () => {
    const error = Object.assign(new Error("terminating connection"), {
      client: { connectionParameters: { password: "hunter2" }, secretKey: 12345 },
    });

    const serialized = JSON.stringify(serializeError(error));

    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("secretKey");
  });

  it("follows the cause chain", () => {
    const error = new Error("send failed", { cause: new TypeError("socket closed") });

    expect(serializeError(error)).toMatchObject({
      message: "send failed",
      cause: { type: "TypeError", message: "socket closed" },
    });
  });

  it("limits the number of nested errors kept from an AggregateError", () => {
    const nested = Array.from({ length: 20 }, (_, index) => new Error(`attempt ${index}`));
    const serialized = serializeError(new AggregateError(nested, "all attempts failed"));

    expect(typeof serialized === "object" && serialized.errors).toHaveLength(5);
  });

  it("turns non error values into strings", () => {
    expect(serializeError("plain failure")).toBe("plain failure");
    expect(serializeError(undefined)).toBe("undefined");
  });
});
