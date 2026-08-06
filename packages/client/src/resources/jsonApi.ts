/**
 * Generic JSON:API and Laravel-paginator helpers shared by the typed resource
 * clients (messaging, maintenance, financials, leasing) and the generic
 * `client.resource()` accessor.
 *
 * TenantCloud's API uses two envelope styles:
 *  - JSON:API:   `{ data: [{ type, id, attributes }], meta: { pagination } }`
 *                writes use `{ data: { type, id?, attributes } }`
 *  - Laravel:    `{ data: [ ...plain objects... ], pagination: { current_page, ... } }`
 *                used by the `/messenger/*` endpoints
 */
import { toNumber } from "../json.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  /** JSON-serializable request body; sent as `application/json`. */
  body?: unknown;
  /** Extra query parameters appended to the path. */
  query?: Record<string, string | number | boolean | undefined | null> | undefined;
  signal?: AbortSignal | undefined;
}

/** The minimal HTTP surface the resource clients depend on (implemented by TcClient). */
export interface TcHttp {
  request<T = unknown>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>;
}

/** A JSON:API resource flattened to `{ id, type, ...attributes }`. */
export interface JsonApiRecord {
  id: number;
  type: string;
  [key: string]: unknown;
}

export interface PageInfo {
  total: number;
  currentPage: number;
  perPage: number;
  totalPages: number;
}

export interface JsonApiList<T = JsonApiRecord> {
  items: T[];
  pagination: PageInfo;
}

interface RawItem {
  type?: unknown;
  id?: unknown;
  attributes?: Record<string, unknown> | null;
  relationships?: Record<string, unknown> | null;
}

/** Flatten a JSON:API resource object into `{ id, type, ...attributes }`. */
export function normalizeItem(item: RawItem): JsonApiRecord {
  // Aggregate/statistics resources sometimes carry an empty-string id; treat
  // any missing/blank id as 0 instead of throwing in toNumber.
  const rawId = item.id;
  const id = rawId === null || rawId === undefined || rawId === "" ? 0 : toNumber(rawId);
  return {
    ...(item.attributes ?? {}),
    type: String(item.type ?? ""),
    id,
  };
}

function emptyPage(): PageInfo {
  return { total: 0, currentPage: 1, perPage: 0, totalPages: 1 };
}

/**
 * Parse a JSON:API collection envelope (`{ data: [...], meta.pagination }`).
 * Tolerates a single-resource `data` object (some aggregate/statistics
 * endpoints return `{ data: { ... } }`) by treating it as a one-item list.
 */
export function parseJsonApiList(payload: unknown): JsonApiList {
  const p = (payload ?? {}) as {
    data?: RawItem[] | RawItem | null;
    meta?: { pagination?: Partial<Record<string, number>> | null } | null;
  };
  const rawData = Array.isArray(p.data) ? p.data : p.data ? [p.data] : [];
  const items = rawData.filter((it) => it && it.attributes).map(normalizeItem);
  const pag = p.meta?.pagination ?? {};
  return {
    items,
    pagination: {
      total: pag.total ?? items.length,
      currentPage: pag.current_page ?? 1,
      perPage: pag.per_page ?? items.length,
      totalPages: pag.total_pages ?? 1,
    },
  };
}

/** Parse a JSON:API single-resource envelope (`{ data: { ... } }`). */
export function parseJsonApiOne(payload: unknown): JsonApiRecord | null {
  const p = (payload ?? {}) as { data?: RawItem | null };
  if (!p.data || typeof p.data !== "object") {
    return null;
  }
  return normalizeItem(p.data);
}

/** Parse a Laravel paginator envelope (`{ data: [...], pagination: {...} }`). */
export function parseLaravelList<T = Record<string, unknown>>(payload: unknown): {
  items: T[];
  pagination: PageInfo;
} {
  const p = (payload ?? {}) as {
    data?: T[] | null;
    pagination?: Partial<Record<string, number>> | null;
  };
  const items = (p.data ?? []) as T[];
  const pag = p.pagination ?? {};
  return {
    items,
    pagination: {
      total: pag.total ?? items.length,
      currentPage: pag.current_page ?? 1,
      perPage: pag.per_page ?? items.length,
      totalPages: pag.last_page ?? 1,
    },
  };
}

/** Append query parameters to a path, skipping null/undefined values. */
export function withQuery(
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  if (!query) {
    return path;
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (parts.length === 0) {
    return path;
  }
  return `${path}${path.includes("?") ? "&" : "?"}${parts.join("&")}`;
}

/**
 * A JSON:API relationship linkage: `{ data: { type, id } }`, or `{ data: null }`
 * to clear the link.
 */
export interface JsonApiRelationship {
  data: { type: string; id: string } | null;
}

/**
 * Build a relationships object from `{ name: [type, id] }` pairs. Entries whose
 * id is undefined are skipped; an explicit `null` id clears the relationship.
 */
export function jsonApiRelationships(
  links: Record<string, [type: string, id: number | string | null | undefined] | undefined>,
): Record<string, JsonApiRelationship> {
  const out: Record<string, JsonApiRelationship> = {};
  for (const [name, link] of Object.entries(links)) {
    if (!link) continue;
    const [type, id] = link;
    if (id === undefined) continue;
    out[name] = id === null ? { data: null } : { data: { type, id: String(id) } };
  }
  return out;
}

/** Build a JSON:API write body: `{ data: { type, id?, attributes, relationships? } }`. */
export function jsonApiBody(
  type: string,
  attributes: Record<string, unknown>,
  id?: number | string,
  relationships?: Record<string, JsonApiRelationship>,
): { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { type, attributes };
  if (id !== undefined && id !== null) {
    data.id = String(id);
  }
  if (relationships && Object.keys(relationships).length > 0) {
    data.relationships = relationships;
  }
  return { data };
}

/**
 * Generic CRUD client over a single JSON:API endpoint. Returned by
 * `client.resource(endpoint, type)`; lets callers reach any resource in the
 * API catalog even when it has no bespoke typed client.
 */
export class JsonApiResourceClient {
  constructor(
    private readonly http: TcHttp,
    private readonly endpoint: string,
    private readonly type: string,
  ) {}

  async list(
    options: {
      page?: number;
      filters?: Record<string, string | number | boolean>;
      sort?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<JsonApiList> {
    const query: Record<string, string | number | boolean> = {};
    if (options.page !== undefined) query.page = options.page;
    if (options.sort !== undefined) query.sort = options.sort;
    for (const [k, v] of Object.entries(options.filters ?? {})) {
      query[`filter[${k}]`] = v;
    }
    const payload = await this.http.request("GET", withQuery(this.endpoint, query), {
      signal: options.signal,
    });
    return parseJsonApiList(payload);
  }

  /** Fetch every page up to `maxResults`, mirroring PaginatedSource.getAll. */
  async listAll(
    maxResults = 300,
    options: { filters?: Record<string, string | number | boolean>; sort?: string; signal?: AbortSignal } = {},
  ): Promise<JsonApiRecord[]> {
    const result: JsonApiRecord[] = [];
    let page = 1;
    while (result.length <= maxResults) {
      options.signal?.throwIfAborted();
      const { items, pagination } = await this.list({ ...options, page });
      result.push(...items);
      page += 1;
      if (result.length >= pagination.total || items.length === 0) {
        break;
      }
    }
    return result;
  }

  async get(id: number | string, signal?: AbortSignal): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("GET", `${this.endpoint}/${id}`, { signal });
    return parseJsonApiOne(payload);
  }

  async create(attributes: Record<string, unknown>, signal?: AbortSignal): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", this.endpoint, {
      body: jsonApiBody(this.type, attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  async update(
    id: number | string,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("PATCH", `${this.endpoint}/${id}`, {
      body: jsonApiBody(this.type, attributes, id),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  async delete(id: number | string, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `${this.endpoint}/${id}`, { signal });
  }
}
