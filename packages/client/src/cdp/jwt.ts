/**
 * Decodes a JWT payload (without signature verification) and reads the "exp"
 * claim. Returns null if the token is malformed.
 */
export function getJwtExpiry(token: string | null | undefined): Date | null {
  if (!token) {
    return null;
  }

  try {
    const parts = token.split(".");
    if (parts.length < 2 || !parts[1]) {
      return null;
    }

    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims = JSON.parse(payload) as Record<string, unknown>;
    const exp = claims["exp"];
    if (typeof exp !== "number") {
      return null;
    }

    return new Date(exp * 1000);
  } catch {
    return null;
  }
}

/** True when the token expires within the next 60 seconds (or is malformed). */
export function isExpiredOrExpiring(token: string | null | undefined): boolean {
  const expiry = getJwtExpiry(token);
  if (expiry === null) {
    return true;
  }
  return expiry.getTime() < Date.now() + 60_000;
}
