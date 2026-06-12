import { describe, expect, it } from "vitest";
import { getJwtExpiry, isExpiredOrExpiring } from "../src/cdp/jwt.js";

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("getJwtExpiry", () => {
  it("reads the exp claim", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(getJwtExpiry(makeJwt({ exp }))?.getTime()).toBe(exp * 1000);
  });

  it("returns null for malformed tokens", () => {
    expect(getJwtExpiry("garbage")).toBeNull();
    expect(getJwtExpiry("")).toBeNull();
    expect(getJwtExpiry(null)).toBeNull();
    expect(getJwtExpiry(makeJwt({}))).toBeNull();
  });
});

describe("isExpiredOrExpiring", () => {
  it("is false for a token valid for an hour", () => {
    expect(isExpiredOrExpiring(makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }))).toBe(false);
  });

  it("is true within the 60s safety window", () => {
    expect(isExpiredOrExpiring(makeJwt({ exp: Math.floor(Date.now() / 1000) + 30 }))).toBe(true);
  });

  it("is true for expired and malformed tokens", () => {
    expect(isExpiredOrExpiring(makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 }))).toBe(true);
    expect(isExpiredOrExpiring("junk")).toBe(true);
  });
});
