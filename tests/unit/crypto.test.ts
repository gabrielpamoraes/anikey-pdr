import { describe, expect, it } from "vitest";
import { canonicalJson, decryptSecret, encryptSecret, hashToken, randomToken, safeEqual, sha256Hex } from "@/lib/crypto";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("crypto", () => {
  it("canonical JSON ignores key order and undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null }, u: undefined })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
    expect(sha256Hex(canonicalJson({ a: 1, b: 2 }))).toBe(sha256Hex(canonicalJson({ b: 2, a: 1 })));
    expect(sha256Hex(canonicalJson({ a: 1 }))).not.toBe(sha256Hex(canonicalJson({ a: 2 })));
  });
  it("creates long unique URL-safe tokens and hashes them", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toBe(a);
  });
  it("round-trips secrets and detects tampering", () => {
    const enc = encryptSecret("signing-token-123");
    expect(enc).not.toContain("signing-token-123");
    expect(decryptSecret(enc)).toBe("signing-token-123");
    const [iv, tag, data] = enc.split(".");
    const flipped = `${iv}.${tag}.${data.slice(0, -2)}${data.endsWith("A") ? "B" : "A"}x`;
    expect(() => decryptSecret(flipped)).toThrow();
  });
  it("compares in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("rate limit", () => {
  it("allows up to the limit per window, then blocks, then resets", () => {
    resetRateLimits();
    const t = 1_000_000;
    expect([1, 2, 3].map(() => rateLimit("k", 3, 1000, t))).toEqual([true, true, true]);
    expect(rateLimit("k", 3, 1000, t + 10)).toBe(false);
    expect(rateLimit("other", 3, 1000, t + 10)).toBe(true);
    expect(rateLimit("k", 3, 1000, t + 1001)).toBe(true);
  });
});
