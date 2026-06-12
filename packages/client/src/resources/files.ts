/**
 * Files: the document/file storage layer. JSON:API.
 *
 * Endpoints:
 *   GET    /files (+ /{id}, /statistics, /sorting)
 *   DELETE /files/{id}
 *   POST   /messenger/file/{id}/archive (archive is messenger-scoped)
 *
 * Note: the "Documents" UI (/documents, /file_manager) is folder/entity-scoped
 * and is reachable via the generic client.request / tc_request.
 */
import { parseTcDateOrNull, pick, toBoolean, toNumber, toNumberOrNull } from "../json.js";
import {
  parseJsonApiList,
  parseJsonApiOne,
  withQuery,
  type JsonApiRecord,
  type PageInfo,
  type TcHttp,
} from "./jsonApi.js";

export interface TcFile {
  id: number;
  senderId: number | null;
  parentId: number | null;
  type: string | null;
  name: string | null;
  token: string | null;
  size: number | null;
  ext: string | null;
  isImage: boolean;
  isArchived: boolean;
  fileUrl: string | null;
  createdAt: Date | null;
}

export function parseFile(raw: Record<string, unknown>): TcFile {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    senderId: toNumberOrNull(pick(raw, "sender_id")),
    parentId: toNumberOrNull(pick(raw, "parent_id")),
    type: s(pick(raw, "type")),
    name: s(pick(raw, "name")),
    token: s(pick(raw, "token")),
    size: toNumberOrNull(pick(raw, "size")),
    ext: s(pick(raw, "ext")),
    isImage: toBoolean(pick(raw, "is_image")),
    isArchived: toBoolean(pick(raw, "is_archived")),
    fileUrl: s(pick(raw, "file_url")),
    createdAt: parseTcDateOrNull(pick(raw, "created_at")),
  };
}

export class FilesClient {
  constructor(private readonly http: TcHttp) {}

  async list(
    options: {
      page?: number | undefined;
      filters?: Record<string, string | number> | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<{ items: TcFile[]; pagination: PageInfo }> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(options.filters ?? {})) query[`filter[${k}]`] = v;
    const payload = await this.http.request("GET", withQuery("/files", query), {
      signal: options.signal,
    });
    const { items, pagination } = parseJsonApiList(payload);
    return { items: items.map(parseFile), pagination };
  }

  async get(id: number, signal?: AbortSignal): Promise<TcFile | null> {
    const one = parseJsonApiOne(await this.http.request("GET", `/files/${id}`, { signal }));
    return one ? parseFile(one) : null;
  }

  statistics(signal?: AbortSignal): Promise<unknown> {
    return this.http.request("GET", "/files/statistics", { signal });
  }

  async delete(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/files/${id}`, { signal });
  }

  /** Raw passthrough for the folder-scoped Documents view. */
  documents(
    filters: Record<string, string | number> = {},
    signal?: AbortSignal,
  ): Promise<JsonApiRecord[]> {
    const query: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/documents", query), { signal })
      .then((p) => parseJsonApiList(p).items);
  }
}
