import type { TcAuthTokenProvider } from "./auth.js";
import { TcClientError } from "./errors.js";
import { pick, toNumber } from "./json.js";
import {
  parseContact,
  parseLease,
  parseProperty,
  parseTransaction,
  parseUnit,
  parseUserInfo,
  type TcUserInfo,
} from "./models.js";
import {
  ContactsSource,
  LeasesSource,
  PropertiesSource,
  TransactionsSource,
  UnitsSource,
  type Page,
  type PageGetter,
} from "./paginatedSource.js";

export interface TcClientOptions {
  /** TenantCloud API base URL. */
  baseUrl?: string;
  /** Custom fetch implementation (for testing). */
  fetch?: typeof fetch;
}

const USER_AGENT = "tenantcloud-client-ts/0.1";

export class TcClient {
  private readonly tokenProvider: TcAuthTokenProvider;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  readonly contacts: ContactsSource;
  readonly properties: PropertiesSource;
  readonly units: UnitsSource;
  readonly transactions: TransactionsSource;
  readonly leases: LeasesSource;

  constructor(tokenProvider: TcAuthTokenProvider, options: TcClientOptions = {}) {
    this.tokenProvider = tokenProvider;
    this.baseUrl = (options.baseUrl ?? "https://api.tenantcloud.com/").replace(/\/?$/, "/");
    this.fetchImpl = options.fetch ?? fetch;

    this.contacts = new ContactsSource(this.makePageGetter("contacts", parseContact));
    this.properties = new PropertiesSource(this.makePageGetter("properties", parseProperty));
    this.units = new UnitsSource(this.makePageGetter("units", parseUnit));
    this.transactions = new TransactionsSource(
      this.makePageGetter("transactions", parseTransaction),
    );
    this.leases = new LeasesSource(this.makePageGetter("leases", parseLease));
  }

  async getUserInfo(signal?: AbortSignal): Promise<TcUserInfo | null> {
    const payload = await this.httpGet("auth/user", signal);
    const user = pick(payload as Record<string, unknown>, "user");
    if (user === null || user === undefined || typeof user !== "object") {
      return null;
    }
    return parseUserInfo(user as Record<string, unknown>);
  }

  private makePageGetter<T>(
    endpoint: string,
    parse: (raw: Record<string, unknown>) => T,
  ): PageGetter<T> {
    return async (pageNo, extraUrl, signal): Promise<Page<T>> => {
      const url = `${endpoint}?page=${pageNo}${extraUrl}`;
      const payload = (await this.httpGet(url, signal)) as {
        data?: Array<{ id?: unknown; attributes?: Record<string, unknown> | null }> | null;
        meta?: { pagination?: { total?: number } | null } | null;
      };

      const entries: T[] = [];
      for (const item of payload.data ?? []) {
        if (!item.attributes) {
          continue;
        }
        // The wrapper id is authoritative; inject it into the attributes
        entries.push(parse({ ...item.attributes, id: toNumber(item.id ?? 0) }));
      }

      return {
        entries,
        pageNo,
        totalEntries: payload.meta?.pagination?.total ?? 0,
      };
    };
  }

  private async httpGet(uri: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.send(uri, signal);

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new TcClientError(response.status, "Invalid JSON response payload", { cause });
    }

    if (response.ok) {
      if (body === null || body === undefined) {
        throw new TcClientError(response.status, "Null response payload");
      }
      return body;
    }

    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : "Http error";
    throw new TcClientError(response.status, message);
  }

  private async send(uri: string, signal?: AbortSignal): Promise<Response> {
    const token = await this.tokenProvider.getToken(signal);
    if (!token) {
      throw new TcClientError(401, "No auth token available");
    }

    const response = await this.fetchImpl(this.baseUrl + uri, {
      headers: this.headers(token),
      signal: signal ?? null,
    });

    if (response.status !== 401) {
      return response;
    }

    // Token was rejected: notify provider and try once more
    await this.tokenProvider.onTokenRejected(token, signal);
    const newToken = await this.tokenProvider.getToken(signal);

    if (!newToken || newToken === token) {
      throw new TcClientError(401, "Auth token rejected and no new token available");
    }

    return this.fetchImpl(this.baseUrl + uri, {
      headers: this.headers(newToken),
      signal: signal ?? null,
    });
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/json, text/plain, text/*",
      "User-Agent": USER_AGENT,
    };
  }
}
