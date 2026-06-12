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
import {
  JsonApiResourceClient,
  withQuery,
  type HttpMethod,
  type RequestOptions,
  type TcHttp,
} from "./resources/jsonApi.js";
import { MessengerClient } from "./resources/messaging.js";
import { MaintenanceClient } from "./resources/maintenance.js";
import { FinancialsClient } from "./resources/financials.js";
import { LeasingClient } from "./resources/leasing.js";
import { ProductivityClient } from "./resources/productivity.js";
import { FilesClient } from "./resources/files.js";
import { ContactsClient } from "./resources/contacts.js";

export interface TcClientOptions {
  /** TenantCloud API base URL. */
  baseUrl?: string;
  /** Custom fetch implementation (for testing). */
  fetch?: typeof fetch;
}

const USER_AGENT = "tenantcloud-client-ts/0.2";

export class TcClient implements TcHttp {
  private readonly tokenProvider: TcAuthTokenProvider;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  readonly contacts: ContactsSource;
  readonly properties: PropertiesSource;
  readonly units: UnitsSource;
  readonly transactions: TransactionsSource;
  readonly leases: LeasesSource;

  /** In-app messaging (Messenger). */
  readonly messaging: MessengerClient;
  /** Maintenance requests and inspections. */
  readonly maintenance: MaintenanceClient;
  /** Transactions writes, payments, recurring, reconciliation, reports. */
  readonly financials: FinancialsClient;
  /** Leases, notices, applications, screenings, leads, renter profiles. */
  readonly leasing: LeasingClient;
  /** Tasks, calendar events, and notes. */
  readonly productivity: ProductivityClient;
  /** Files and documents. */
  readonly files: FilesClient;
  /** Contact writes (create/update/invite) and insurances. */
  readonly crm: ContactsClient;

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

    this.messaging = new MessengerClient(this);
    this.maintenance = new MaintenanceClient(this);
    this.financials = new FinancialsClient(this);
    this.leasing = new LeasingClient(this);
    this.productivity = new ProductivityClient(this);
    this.files = new FilesClient(this);
    this.crm = new ContactsClient(this);
  }

  async getUserInfo(signal?: AbortSignal): Promise<TcUserInfo | null> {
    const payload = await this.request("GET", "auth/user", { signal });
    const user = pick(payload as Record<string, unknown>, "user");
    if (user === null || user === undefined || typeof user !== "object") {
      return null;
    }
    return parseUserInfo(user as Record<string, unknown>);
  }

  /**
   * Low-level authenticated request. Handles the 401 refresh-and-retry-once
   * flow, JSON encoding/decoding, and error mapping. Every typed resource
   * client is built on this.
   *
   * @returns the parsed JSON body, or `null` for empty (204) responses.
   */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const uri = withQuery(path.replace(/^\//, ""), options.query);
    const response = await this.send(method, uri, options.body, options.signal);
    return (await this.parse(response)) as T;
  }

  /**
   * Generic JSON:API CRUD accessor for any endpoint in the catalog, for
   * resources without a bespoke typed client (e.g. `client.resource("/tasks",
   * "task")`).
   */
  resource(endpoint: string, type: string): JsonApiResourceClient {
    return new JsonApiResourceClient(this, endpoint, type);
  }

  private makePageGetter<T>(
    endpoint: string,
    parse: (raw: Record<string, unknown>) => T,
  ): PageGetter<T> {
    return async (pageNo, extraUrl, signal): Promise<Page<T>> => {
      const url = `${endpoint}?page=${pageNo}${extraUrl}`;
      const payload = (await this.request("GET", url, { signal })) as {
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

  /** Parse a response: ok -> JSON (or null for empty), otherwise TcClientError. */
  private async parse(response: Response): Promise<unknown> {
    // Empty body (204 No Content, or DELETE with no payload)
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      if (response.ok) {
        return null;
      }
    }

    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch (cause) {
        if (response.ok) {
          throw new TcClientError(response.status, "Invalid JSON response payload", { cause });
        }
        body = null;
      }
    }

    if (response.ok) {
      return body;
    }

    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : "Http error";
    throw new TcClientError(response.status, message);
  }

  private async send(
    method: HttpMethod,
    uri: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const token = await this.tokenProvider.getToken(signal);
    if (!token) {
      throw new TcClientError(401, "No auth token available");
    }

    const init = this.buildInit(method, token, body, signal);
    const response = await this.fetchImpl(this.baseUrl + uri, init);

    if (response.status !== 401) {
      return response;
    }

    // Token was rejected: notify provider and try once more
    await this.tokenProvider.onTokenRejected(token, signal);
    const newToken = await this.tokenProvider.getToken(signal);

    if (!newToken || newToken === token) {
      throw new TcClientError(401, "Auth token rejected and no new token available");
    }

    return this.fetchImpl(this.baseUrl + uri, this.buildInit(method, newToken, body, signal));
  }

  private buildInit(
    method: HttpMethod,
    token: string,
    body: unknown,
    signal?: AbortSignal,
  ): RequestInit {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/json, text/plain, text/*",
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
    };

    const init: RequestInit = { method, headers, signal: signal ?? null };
    if (body !== undefined && method !== "GET") {
      headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    return init;
  }
}
