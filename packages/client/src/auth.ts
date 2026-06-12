/** The three pieces required for TenantCloud API authentication and token refresh. */
export interface TcTokenSet {
  accessToken: string;
  refreshToken: string;
  fingerprint: string;
}

/** Provides Bearer tokens for TenantCloud API authentication. */
export interface TcAuthTokenProvider {
  /** Returns a valid Bearer token, or null if no token is available. */
  getToken(signal?: AbortSignal): Promise<string | null>;

  /**
   * Called when the server returns 401 Unauthorized. The provider should
   * invalidate its cached token so the next getToken() attempts a refresh.
   * The rejected token is passed to avoid a race where two simultaneous
   * requests both receive 401.
   */
  onTokenRejected(rejectedToken: string, signal?: AbortSignal): Promise<void>;
}

/** Persists TenantCloud auth tokens across sessions. */
export interface TcTokenStore {
  load(signal?: AbortSignal): Promise<TcTokenSet | null>;
  save(tokens: TcTokenSet, signal?: AbortSignal): Promise<void>;
  delete(signal?: AbortSignal): Promise<void>;
}

/** A token provider that returns a fixed token. Once rejected, returns null. */
export class StaticTokenProvider implements TcAuthTokenProvider {
  private token: string | null;

  constructor(token: string) {
    if (!token) {
      throw new Error("token is required");
    }
    this.token = token;
  }

  getToken(): Promise<string | null> {
    return Promise.resolve(this.token);
  }

  onTokenRejected(rejectedToken: string): Promise<void> {
    if (this.token === rejectedToken) {
      this.token = null;
    }
    return Promise.resolve();
  }
}
