/**
 * Productivity: tasks, calendar events, and notes. All JSON:API.
 *
 * Endpoints:
 *   GET/POST   /tasks (+ /{id}, /statistics)
 *   GET/POST   /calendar_events
 *   GET/POST   /notes (+ /{id}) - notes are entity-scoped; list needs filters
 */
import { parseTcDateOrNull, pick, toBoolean, toNumber } from "../json.js";
import {
  jsonApiBody,
  parseJsonApiList,
  parseJsonApiOne,
  withQuery,
  type JsonApiList,
  type JsonApiRecord,
  type TcHttp,
} from "./jsonApi.js";

export interface TcTask {
  id: number;
  title: string | null;
  text: string | null;
  isRecurring: boolean;
  isResolved: boolean;
  isSent: boolean;
  isFullDay: boolean;
  remindDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function parseTask(raw: Record<string, unknown>): TcTask {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    title: (pick(raw, "title") as string | null) ?? null,
    text: (pick(raw, "text") as string | null) ?? null,
    isRecurring: toBoolean(pick(raw, "is_recurring")),
    isResolved: toBoolean(pick(raw, "is_resolved")),
    isSent: toBoolean(pick(raw, "is_sent")),
    isFullDay: toBoolean(pick(raw, "is_full_day")),
    remindDate: parseTcDateOrNull(pick(raw, "remind_date")),
    createdAt: parseTcDateOrNull(pick(raw, "created_at")),
    updatedAt: parseTcDateOrNull(pick(raw, "updated_at")),
  };
}

export class ProductivityClient {
  constructor(private readonly http: TcHttp) {}

  // --- Tasks ---

  async listTasks(
    options: {
      page?: number | undefined;
      filters?: Record<string, string | number> | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<{ items: TcTask[]; total: number }> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(options.filters ?? {})) query[`filter[${k}]`] = v;
    const payload = await this.http.request("GET", withQuery("/tasks", query), {
      signal: options.signal,
    });
    const { items, pagination } = parseJsonApiList(payload);
    return { items: items.map(parseTask), total: pagination.total };
  }

  async getTask(id: number, signal?: AbortSignal): Promise<TcTask | null> {
    const one = parseJsonApiOne(await this.http.request("GET", `/tasks/${id}`, { signal }));
    return one ? parseTask(one) : null;
  }

  /** Create a task. `remind_date` (YYYY-MM-DD) is required by the API. */
  async createTask(attributes: Record<string, unknown>, signal?: AbortSignal): Promise<TcTask | null> {
    const one = parseJsonApiOne(
      await this.http.request("POST", "/tasks", { body: jsonApiBody("task", attributes), signal }),
    );
    return one ? parseTask(one) : null;
  }

  async updateTask(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcTask | null> {
    const one = parseJsonApiOne(
      await this.http.request("PATCH", `/tasks/${id}`, {
        body: jsonApiBody("task", attributes, id),
        signal,
      }),
    );
    return one ? parseTask(one) : null;
  }

  async deleteTask(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/tasks/${id}`, { signal });
  }

  taskStatistics(signal?: AbortSignal): Promise<unknown> {
    return this.http.request("GET", "/tasks/statistics", { signal });
  }

  // --- Calendar events ---

  /** List calendar events. Returns the raw API payload (shape varies by view). */
  listCalendarEvents(
    options: {
      query?: Record<string, string | number> | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<unknown> {
    return this.http.request("GET", withQuery("/calendar_events", options.query), {
      signal: options.signal,
    });
  }

  async createCalendarEvent(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    return parseJsonApiOne(
      await this.http.request("POST", "/calendar_events", {
        body: jsonApiBody("calendar_event", attributes),
        signal,
      }),
    );
  }

  async deleteCalendarEvent(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/calendar_events/${id}`, { signal });
  }

  // --- Notes (entity-scoped) ---

  /** List notes. Notes attach to an entity, so pass filters (e.g. noteable_type/id). */
  listNotes(
    filters: Record<string, string | number> = {},
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<JsonApiList> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/notes", query), { signal: options.signal })
      .then(parseJsonApiList);
  }

  async createNote(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    return parseJsonApiOne(
      await this.http.request("POST", "/notes", { body: jsonApiBody("note", attributes), signal }),
    );
  }

  async updateNote(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    return parseJsonApiOne(
      await this.http.request("PATCH", `/notes/${id}`, {
        body: jsonApiBody("note", attributes, id),
        signal,
      }),
    );
  }

  async deleteNote(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/notes/${id}`, { signal });
  }
}
