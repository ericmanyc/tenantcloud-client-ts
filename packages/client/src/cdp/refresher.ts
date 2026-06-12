import type { TcTokenSet } from "../auth.js";

/**
 * Calls TenantCloud's token refresh endpoint. Returns the new token set
 * (fingerprint is carried over), or null on any failure.
 */
export async function refreshTokens(
  current: TcTokenSet,
  apiUrl: string,
  signal?: AbortSignal,
): Promise<TcTokenSet | null> {
  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/auth/token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${current.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        fingerprint: current.fingerprint,
        refresh_token: current.refreshToken,
      }),
      signal: signal ?? null,
    });

    if (!response.ok) {
      return null;
    }

    const result = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    if (!result.access_token || !result.refresh_token) {
      return null;
    }

    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      fingerprint: current.fingerprint,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return null;
  }
}
