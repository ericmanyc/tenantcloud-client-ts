import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import CDP from "chrome-remote-interface";
import type { TcAuthTokenProvider, TcTokenSet, TcTokenStore } from "../auth.js";
import { findChromiumBrowsers } from "./chromiumFinder.js";
import { isExpiredOrExpiring } from "./jwt.js";
import { refreshTokens } from "./refresher.js";

export interface CdpTokenProviderOptions {
  /** CDP debug port to connect to an existing browser. Default 9222. */
  debugPort?: number;
  /** When true, the provider may launch a browser for interactive login. */
  allowInteractiveLogin?: boolean;
  /** TenantCloud web application URL. */
  appUrl?: string;
  /** TenantCloud API URL. */
  apiUrl?: string;
  /** Optional token store for persisting tokens across sessions. */
  tokenStore?: TcTokenStore;
  /** Override automatic browser discovery with a specific executable path. */
  browserExecutablePath?: string;
  /** Timeout for the whole interactive login flow, in milliseconds. Default 5 minutes. */
  interactiveLoginTimeoutMs?: number;
}

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/**
 * Token provider that connects to a Chromium browser via Chrome DevTools
 * Protocol to extract TenantCloud auth tokens from an existing browser
 * session, with automatic refresh and optional interactive login.
 *
 * Token acquisition strategy, in order:
 *   1. In-memory cache (if the JWT is still valid)
 *   2. Token store (load + refresh if expired)
 *   3. CDP extraction from an existing browser tab on the app URL
 *   4. Interactive login (if allowed): launch a temporary browser instance
 */
export class CdpTokenProvider implements TcAuthTokenProvider {
  private readonly options: Required<
    Pick<CdpTokenProviderOptions, "debugPort" | "allowInteractiveLogin" | "appUrl" | "apiUrl" | "interactiveLoginTimeoutMs">
  > &
    CdpTokenProviderOptions;

  private cached: TcTokenSet | null = null;
  private browserProcess: ChildProcess | null = null;
  private gate: Promise<unknown> = Promise.resolve();

  constructor(options: CdpTokenProviderOptions = {}) {
    this.options = {
      debugPort: 9222,
      allowInteractiveLogin: false,
      appUrl: "https://app.tenantcloud.com",
      apiUrl: "https://api.tenantcloud.com",
      interactiveLoginTimeoutMs: 5 * 60_000,
      ...options,
    };
  }

  getToken(signal?: AbortSignal): Promise<string | null> {
    return this.serialized(() => this.getTokenCore(signal));
  }

  /**
   * Run the interactive browser login flow now, regardless of
   * `allowInteractiveLogin`. Launches a temporary browser window, waits for
   * the user to finish signing in, then caches and persists the tokens.
   * Returns null if the user closed the window, the flow timed out, or no
   * Chromium browser could be found.
   */
  interactiveLogin(signal?: AbortSignal): Promise<TcTokenSet | null> {
    return this.serialized(async () => {
      const tokens = await this.tryInteractiveLogin(signal);
      if (tokens) {
        this.cached = tokens;
        await this.persist(tokens);
      }
      return tokens;
    });
  }

  onTokenRejected(rejectedToken: string, signal?: AbortSignal): Promise<void> {
    return this.serialized(async () => {
      if (this.cached?.accessToken !== rejectedToken) {
        return;
      }
      try {
        const refreshed = await refreshTokens(this.cached, this.options.apiUrl, signal);
        this.cached = refreshed;
        if (refreshed) {
          await this.persist(refreshed);
        }
      } catch {
        this.cached = null;
      }
    });
  }

  /** Serializes concurrent calls, mirroring the C# SemaphoreSlim gate. */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gate.then(fn, fn);
    this.gate = run.catch(() => {});
    return run;
  }

  private async getTokenCore(signal?: AbortSignal): Promise<string | null> {
    // Step 1: in-memory cache
    if (this.cached && !isExpiredOrExpiring(this.cached.accessToken)) {
      return this.cached.accessToken;
    }

    // Step 2: token store (load + refresh if expired)
    let tokens = await this.tryLoadAndRefreshFromStore(signal);
    if (tokens) {
      this.cached = tokens;
      return tokens.accessToken;
    }

    // Step 3: CDP extraction from an existing browser
    tokens = await this.tryExtractFromBrowser(this.options.debugPort, signal);
    if (tokens) {
      this.cached = tokens;
      await this.persist(tokens);
      return tokens.accessToken;
    }

    // Step 4: interactive login
    if (this.options.allowInteractiveLogin) {
      tokens = await this.tryInteractiveLogin(signal);
      if (tokens) {
        this.cached = tokens;
        await this.persist(tokens);
        return tokens.accessToken;
      }
    }

    return null;
  }

  private async tryLoadAndRefreshFromStore(signal?: AbortSignal): Promise<TcTokenSet | null> {
    const store = this.options.tokenStore;
    if (!store) {
      return null;
    }

    try {
      const stored = await store.load(signal);
      if (!stored) {
        return null;
      }

      if (!isExpiredOrExpiring(stored.accessToken)) {
        return stored;
      }

      const refreshed = await refreshTokens(stored, this.options.apiUrl, signal);
      if (refreshed) {
        await this.persist(refreshed);
      }
      return refreshed;
    } catch {
      return null;
    }
  }

  private async tryExtractFromBrowser(
    port: number,
    signal?: AbortSignal,
  ): Promise<TcTokenSet | null> {
    try {
      const target = await this.findTarget(port, true);
      if (!target) {
        return null;
      }
      return await this.extractTokensViaCdp(port, target, signal);
    } catch {
      return null;
    }
  }

  private async findTarget(port: number, requireAppUrl: boolean): Promise<CdpTarget | null> {
    let targets: CdpTarget[];
    try {
      targets = (await CDP.List({ port })) as CdpTarget[];
    } catch {
      return null;
    }

    const appHost = new URL(this.options.appUrl).host;

    for (const target of targets) {
      if (target.type !== "page" || !target.webSocketDebuggerUrl) {
        continue;
      }
      if (!requireAppUrl) {
        return target;
      }
      try {
        const host = new URL(target.url).host;
        if (host.toLowerCase().endsWith(appHost.toLowerCase())) {
          return target;
        }
      } catch {
        // Not a parsable URL (chrome:// etc.)
      }
    }

    return null;
  }

  private async extractTokensViaCdp(
    port: number,
    target: CdpTarget,
    _signal?: AbortSignal,
  ): Promise<TcTokenSet | null> {
    const client = await CDP({ port, target: target.id });
    try {
      const accessToken = await this.evaluateString(
        client,
        "JSON.parse(localStorage.getItem('access_token'))",
      );
      const fingerprint = await this.evaluateString(
        client,
        "JSON.parse(localStorage.getItem('fingerprint'))",
      );
      const refreshToken = await this.extractRefreshTokenCookie(client);

      if (!accessToken || !fingerprint || !refreshToken) {
        return null;
      }

      return { accessToken, refreshToken, fingerprint };
    } finally {
      await client.close().catch(() => {});
    }
  }

  private async evaluateString(client: CDP.Client, expression: string): Promise<string | null> {
    try {
      const result = await client.Runtime.evaluate({ expression, returnByValue: true });
      if (result.exceptionDetails || result.result?.value === undefined || result.result.value === null) {
        return null;
      }
      return String(result.result.value);
    } catch {
      return null;
    }
  }

  private async extractRefreshTokenCookie(client: CDP.Client): Promise<string | null> {
    try {
      const { cookies } = await client.Network.getCookies({
        urls: [this.options.apiUrl, this.options.appUrl],
      });
      const cookie = cookies.find((c) => c.name === "tc_refresh_token" && c.value);
      return cookie?.value ?? null;
    } catch {
      return null;
    }
  }

  private async tryInteractiveLogin(signal?: AbortSignal): Promise<TcTokenSet | null> {
    const browserPath = await this.resolveBrowserPath();
    if (!browserPath) {
      return null;
    }

    const port = 10_000 + Math.floor(Math.random() * 50_000);
    const tempProfile = join(tmpdir(), `tc-cdp-${port}`);

    try {
      return await this.launchBrowserAndExtractTokens(browserPath, port, tempProfile, signal);
    } catch {
      return null;
    } finally {
      this.killBrowserProcess();
      await rm(tempProfile, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async resolveBrowserPath(): Promise<string | null> {
    if (this.options.browserExecutablePath) {
      return this.options.browserExecutablePath;
    }
    const browsers = await findChromiumBrowsers();
    return browsers[0]?.executablePath ?? null;
  }

  private async launchBrowserAndExtractTokens(
    browserPath: string,
    port: number,
    tempProfile: string,
    signal?: AbortSignal,
  ): Promise<TcTokenSet | null> {
    await mkdir(tempProfile, { recursive: true });

    const loginUrl = `${this.options.appUrl.replace(/\/+$/, "")}/login`;

    this.browserProcess = spawn(
      browserPath,
      [
        `--remote-debugging-port=${port}`,
        `--app=${loginUrl}`,
        `--user-data-dir=${tempProfile}`,
        "--no-first-run",
        "--disable-extensions",
      ],
      { stdio: "ignore" },
    );

    // Wait for the browser to start CDP
    await delay(2000, undefined, { signal });

    return this.pollForLoginCompletion(port, signal);
  }

  private async pollForLoginCompletion(
    port: number,
    signal?: AbortSignal,
  ): Promise<TcTokenSet | null> {
    const deadline = Date.now() + this.options.interactiveLoginTimeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted || this.browserProcess?.exitCode !== null) {
        return null; // Aborted, or the user closed the browser
      }

      try {
        await delay(1500, undefined, { signal });
      } catch {
        return null;
      }

      try {
        const tokens = await this.tryExtractAfterLogin(port, signal);
        if (tokens) {
          return tokens;
        }
      } catch {
        // CDP not ready yet, keep polling
      }
    }

    return null;
  }

  private async tryExtractAfterLogin(
    port: number,
    signal?: AbortSignal,
  ): Promise<TcTokenSet | null> {
    const target = await this.findTarget(port, false);
    if (!target) {
      return null;
    }

    const client = await CDP({ port, target: target.id });
    let currentUrl: string | null;
    try {
      currentUrl = await this.evaluateString(client, "window.location.href");
    } finally {
      await client.close().catch(() => {});
    }

    if (!currentUrl) {
      return null;
    }

    // Still on login or 2FA page; keep waiting
    const lower = currentUrl.toLowerCase();
    if (lower.includes("/login") || lower.includes("/two_factor")) {
      return null;
    }

    return this.extractTokensViaCdp(port, target, signal);
  }

  private async persist(tokens: TcTokenSet): Promise<void> {
    try {
      await this.options.tokenStore?.save(tokens);
    } catch {
      // Persistence failure is non-fatal
    }
  }

  private killBrowserProcess(): void {
    try {
      if (this.browserProcess && this.browserProcess.exitCode === null) {
        this.browserProcess.kill();
      }
    } catch {
      // Best effort
    } finally {
      this.browserProcess = null;
    }
  }

  dispose(): void {
    this.killBrowserProcess();
  }
}
