import { describe, expect, it } from "vitest";
import {
  CLAIMABLE_STATUSES,
  InvalidStatusTransitionError,
  assertTransition,
  canTransition,
  isTerminalStatus,
} from "../../src/modules/emails/email-status.js";

describe("email status transitions", () => {
  it.each([
    ["scheduled", "processing"],
    ["rate_limited", "processing"],
    ["processing", "sent"],
    ["processing", "failed"],
    ["processing", "rate_limited"],
    ["processing", "scheduled"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["scheduled", "sent"],
    ["scheduled", "failed"],
    ["rate_limited", "sent"],
    ["sent", "processing"],
    ["sent", "scheduled"],
    ["failed", "processing"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("never lets a sent email be sent again", () => {
    expect(() => assertTransition("sent", "processing")).toThrow(InvalidStatusTransitionError);
  });

  it("treats only sent and failed as terminal", () => {
    expect(isTerminalStatus("sent")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("scheduled")).toBe(false);
    expect(isTerminalStatus("processing")).toBe(false);
    expect(isTerminalStatus("rate_limited")).toBe(false);
  });

  it("derives the claimable statuses from the transition table", () => {
    expect([...CLAIMABLE_STATUSES].sort()).toEqual(["rate_limited", "scheduled"]);
  });
});
