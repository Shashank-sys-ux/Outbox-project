import { describe, expect, it } from "vitest";
import { SecretBox, hmacSha256Hex, safeEqual, sha256Base64Url } from "../../src/utils/crypto.js";

const key = Buffer.alloc(32, 1).toString("base64");

describe("SecretBox", () => {
  it("round trips a secret", () => {
    const box = new SecretBox(key);
    const encrypted = box.encrypt("smtp-password-123");

    expect(encrypted).not.toContain("smtp-password-123");
    expect(box.decrypt(encrypted)).toBe("smtp-password-123");
  });

  it("produces different ciphertext every time", () => {
    const box = new SecretBox(key);

    expect(box.encrypt("same")).not.toBe(box.encrypt("same"));
  });

  it("detects tampering", () => {
    const box = new SecretBox(key);
    const [version, iv, tag, ciphertext] = box.encrypt("webhook").split(":");
    const flipped = `${ciphertext?.[0] === "A" ? "B" : "A"}${ciphertext?.slice(1)}`;

    expect(() => box.decrypt([version, iv, tag, flipped].join(":"))).toThrow();
  });

  it("refuses to decrypt with the wrong key", () => {
    const encrypted = new SecretBox(key).encrypt("token");
    const other = new SecretBox(Buffer.alloc(32, 2).toString("base64"));

    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => new SecretBox(Buffer.alloc(16).toString("base64"))).toThrow();
  });
});

describe("hash helpers", () => {
  it("builds the PKCE S256 challenge from RFC 7636", () => {
    expect(sha256Base64Url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("keys session ids with a secret", () => {
    expect(hmacSha256Hex("secret-a", "session")).not.toBe(hmacSha256Hex("secret-b", "session"));
  });

  it("compares tokens without leaking length differences", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
