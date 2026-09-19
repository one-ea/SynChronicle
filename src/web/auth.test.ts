import { describe, expect, it } from "vitest";
import { hashPassword, issueToken, LoginRateLimiter, parseCookie, verifyPassword, verifyToken } from "./auth.js";

describe("web auth", () => {
  it("hashes and verifies passwords", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword("correct horse", stored.salt, stored.hash)).toBe(true);
    expect(verifyPassword("wrong horse", stored.salt, stored.hash)).toBe(false);
  });

  it("signs, expires, and rejects tampered tokens", () => {
    const token = issueToken("u-1", "secret", 100);
    expect(verifyToken(token, "secret", 101)?.uid).toBe("u-1");
    expect(verifyToken(token, "secret", 100 + 8 * 24 * 60 * 60)).toBeNull();
    expect(verifyToken(`${token}bad`, "secret", 101)).toBeNull();
  });

  it("parses cookie values containing equals signs", () => {
    expect(parseCookie("a=1; sc_token=abc=def; z=2", "sc_token")).toBe("abc=def");
  });

  it("locks after five failures and clears on success", () => {
    const limiter = new LoginRateLimiter(5, 1000);
    for (let index = 0; index < 5; index += 1) limiter.fail("ip", 100);
    expect(limiter.isLocked("ip", 101)).toBe(true);
    expect(limiter.isLocked("ip", 1101)).toBe(false);
    limiter.success("ip");
    expect(limiter.isLocked("ip", 101)).toBe(false);
  });
});
