import type { TcAuthTokenProvider, TcTokenSet } from "tenantcloud-client";
import { isExpiredOrExpiring, refreshTokens } from "tenantcloud-client/cdp";
import { open, seal } from "./crypto.js";
import type { RemoteStore } from "./store.js";

const API_URL = "https://api.tenantcloud.com";

/**
 * Per-user token gates, shared across provider instances. TenantCloud rotates
 * refresh tokens on every use, so two concurrent refreshes for the same user
 * would race and one would kill the chain. All token operations for a user
 * run strictly one at a time, even when the user has several MCP sessions.
 */
const userGates = new Map<number, Promise<unknown>>();

function serialized<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const gate = userGates.get(userId) ?? Promise.resolve();
  const run = gate.then(fn, fn);
  userGates.set(
    userId,
    run.catch(() => {}),
  );
  return run;
}

/**
 * Token provider backed by the encrypted server-side vault. Strategy on each
 * getToken(): in-memory cache (if still valid) -> vault load -> refresh if
 * expiring -> PERSIST THE ROTATED SET BEFORE USING IT -> serve. A failed
 * chain returns null, which surfaces as the "not signed in" tool error.
 */
export class VaultTokenProvider implements TcAuthTokenProvider {
  private cached: TcTokenSet | null = null;

  constructor(
    private readonly userId: number,
    private readonly store: RemoteStore,
    private readonly vaultKey: Buffer,
  ) {}

  getToken(signal?: AbortSignal): Promise<string | null> {
    return serialized(this.userId, async () => {
      if (this.cached && !isExpiredOrExpiring(this.cached.accessToken)) {
        return this.cached.accessToken;
      }

      // ALWAYS re-read the vault before refreshing. Refresh tokens rotate on
      // every use, and another provider instance (another MCP session, or the
      // keep-alive) may have rotated ours since we cached it. Refreshing from a
      // stale cached copy replays a dead refresh token and kills the chain.
      const stored = await this.loadFromVault();
      if (!stored) {
        this.cached = null;
        return null;
      }

      if (!isExpiredOrExpiring(stored.accessToken)) {
        this.cached = stored;
        return stored.accessToken;
      }

      return (await this.refresh(stored, signal))?.accessToken ?? null;
    });
  }

  onTokenRejected(rejectedToken: string, signal?: AbortSignal): Promise<void> {
    return serialized(this.userId, async () => {
      if (this.cached?.accessToken !== rejectedToken) {
        return;
      }
      const stored = await this.loadFromVault();
      if (stored && stored.accessToken !== rejectedToken) {
        this.cached = stored; // already rotated elsewhere; adopt it
        return;
      }
      await this.refresh(stored, signal);
    });
  }

  /**
   * Force a refresh from the vault's current token set, even if the access
   * token is still valid, so the refresh-token chain never sits idle long
   * enough to expire. Returns whether the chain is still alive.
   */
  keepAlive(signal?: AbortSignal): Promise<boolean> {
    return serialized(this.userId, async () => {
      const stored = await this.loadFromVault();
      return (await this.refresh(stored, signal)) !== null;
    });
  }

  private async refresh(stored: TcTokenSet | null, signal?: AbortSignal): Promise<TcTokenSet | null> {
    const refreshed = stored ? await refreshTokens(stored, API_URL, signal) : null;
    if (refreshed) {
      await this.persist(refreshed); // persist the rotated set before anyone uses it
    }
    this.cached = refreshed;
    return refreshed;
  }

  private async loadFromVault(): Promise<TcTokenSet | null> {
    const sealed = await this.store.loadVault(this.userId);
    if (!sealed) {
      return null;
    }
    try {
      const parsed = JSON.parse(open(sealed, this.vaultKey)) as TcTokenSet;
      return parsed.accessToken && parsed.refreshToken && parsed.fingerprint ? parsed : null;
    } catch {
      return null; // wrong key or corrupted row; treat as not paired
    }
  }

  private persist(tokens: TcTokenSet): Promise<void> {
    return this.store.saveVault(this.userId, seal(JSON.stringify(tokens), this.vaultKey));
  }
}

/** Encrypt and store a freshly paired token set for a user. */
export function sealTokenSet(tokens: TcTokenSet, vaultKey: Buffer): string {
  return seal(JSON.stringify(tokens), vaultKey);
}
