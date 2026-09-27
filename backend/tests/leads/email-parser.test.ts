import { describe, expect, it } from "vitest";
import { isValidEmail, looksLikeText, parseEmailList } from "../../src/modules/leads/email-parser.js";

describe("isValidEmail", () => {
  it.each(["jane@example.com", "john.doe+tag@sub.example.co.uk", "o'brien@example.ie", "a@xn--80ak6aa92e.com"])(
    "accepts %s",
    (email) => {
      expect(isValidEmail(email)).toBe(true);
    },
  );

  it.each([
    "plainaddress",
    "@example.com",
    "jane@",
    "jane@@example.com",
    "jane..doe@example.com",
    ".jane@example.com",
    "jane@example",
    "jane@-example.com",
    "jane@example.c",
    `${"a".repeat(65)}@example.com`,
  ])("rejects %s", (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

describe("parseEmailList", () => {
  it("extracts emails from a CSV with headers, quotes and extra columns", () => {
    const csv = 'name,email,company\n"Jane Doe","jane@example.com",Acme\nJohn,JOHN@Example.com,Globex\n';
    const result = parseEmailList(csv, 100);

    expect(result.emails).toEqual(["jane@example.com", "john@example.com"]);
    expect(result.stats).toMatchObject({ valid: 2, invalid: 0, duplicates: 0 });
  });

  it("removes duplicates case insensitively and keeps first seen order", () => {
    const result = parseEmailList("b@x.com\na@x.com\nB@X.com\na@x.com", 100);

    expect(result.emails).toEqual(["b@x.com", "a@x.com"]);
    expect(result.stats.duplicates).toBe(2);
  });

  it("counts invalid addresses and keeps a few samples", () => {
    const result = parseEmailList("good@example.com, bad@, also@bad, @nope.com", 100);

    expect(result.emails).toEqual(["good@example.com"]);
    expect(result.stats.invalid).toBe(3);
    expect(result.invalidSamples).toContain("bad@");
  });

  it("handles semicolons, tabs, angle brackets, mailto and a BOM", () => {
    const text = "\uFEFFJane <jane@example.com>;\tmailto:john@example.com | ann@example.com";

    expect(parseEmailList(text, 100).emails).toEqual(["jane@example.com", "john@example.com", "ann@example.com"]);
  });

  it("returns nothing for an empty or email free file", () => {
    expect(parseEmailList("", 100).emails).toEqual([]);
    expect(parseEmailList("name,company\nJane,Acme", 100).stats.candidates).toBe(0);
  });

  it("stops at the recipient cap and reports how many were cut", () => {
    const text = Array.from({ length: 12 }, (_, index) => `user${index}@example.com`).join("\n");
    const result = parseEmailList(text, 10);

    expect(result.emails).toHaveLength(10);
    expect(result.stats.truncated).toBe(2);
  });

  it("parses a large upload quickly", () => {
    const text = Array.from({ length: 50_000 }, (_, index) => `lead${index}@example.com,Name ${index}`).join("\n");
    const startedAt = performance.now();
    const result = parseEmailList(text, 100_000);

    expect(result.emails).toHaveLength(50_000);
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });
});

describe("looksLikeText", () => {
  it("rejects binary content", () => {
    expect(looksLikeText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(false);
    expect(looksLikeText(Buffer.from("a@b.com\n"))).toBe(true);
  });
});
