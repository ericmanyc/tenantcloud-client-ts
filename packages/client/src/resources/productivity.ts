/**
 * Productivity: tasks, calendar events, notes, and the timeline feed.
 *
 * Endpoints:
 *   GET/POST   /tasks (+ /{id}, /statistics) - JSON:API
 *   GET/POST   /calendar_events - JSON:API
 *   GET        /timeline - NOT JSON:API; plain params entity_id + entity_type
 *              (numeric code) + optional filter tab; notes are read here
 *   POST       /notes, PUT/DELETE /notes/{id} - NOT JSON:API; plain body with
 *              resource_id + resource_type (same numeric codes)
 *
 * There is no GET /notes: the dashboard lists notes via GET /timeline with
 * filter=notes.
 */
import { parseTcDateOrNull, pick, toBoolean, toNumber } from "../json.js";
import {
  jsonApiBody,
  parseJsonApiList,
  parseJsonApiOne,
  withQuery,
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

  // --- Timeline & notes (entity-scoped) ---

  /**
   * Timeline/notes feed for an entity. `filter` selects the dashboard tab.
   * Returns the raw payload: { pagination, list, unread_count, counts }.
   */
  async listTimeline(
    entityType: TimelineEntityType | number,
    entityId: number,
    options: {
      filter?: TimelineFilter | undefined;
      page?: number | undefined;
      take?: number | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<{ items: Record<string, unknown>[]; total: number; raw: unknown }> {
    const payload = await this.http.request("GET", withQuery("/timeline", {
      entity_id: entityId,
      entity_type: resolveTimelineEntityType(entityType),
      filter: options.filter,
      page: options.page,
      take: options.take,
    }), { signal: options.signal });
    const body = payload as {
      list?: Record<string, unknown>[] | null;
      pagination?: { total?: number } | null;
    };
    return {
      items: body.list ?? [],
      total: toNumber(body.pagination?.total ?? 0),
      raw: payload,
    };
  }

  /** List notes attached to an entity (timeline feed filtered to the Notes tab). */
  listNotes(
    entityType: TimelineEntityType | number,
    entityId: number,
    options: { page?: number | undefined; take?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<{ items: Record<string, unknown>[]; total: number; raw: unknown }> {
    return this.listTimeline(entityType, entityId, { ...options, filter: "notes" });
  }

  /** Create a note. Body is plain JSON: { resource_id, resource_type, text, ... }. */
  async createNote(
    entityType: TimelineEntityType | number,
    entityId: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.http.request("POST", "/notes", {
      body: {
        ...attributes,
        resource_id: entityId,
        resource_type: resolveTimelineEntityType(entityType),
      },
      signal,
    });
  }

  async updateNote(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.http.request("PUT", `/notes/${id}`, { body: { ...attributes, id }, signal });
  }

  async deleteNote(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/notes/${id}`, { signal });
  }
}

/** Dashboard tab names accepted by GET /timeline's `filter` param. */
export type TimelineFilter = "all" | "notes" | "tasks" | "activity" | "files";

/**
 * Numeric entity codes for /timeline (entity_type) and /notes
 * (resource_type), recovered from the dashboard bundle's timeline enum.
 */
export const TIMELINE_ENTITY_TYPES = {
  lease: 1,
  contact: 2,
  application: 3,
  user: 4,
  maintenance: 5,
  demo: 6,
  ticket: 7,
  lead: 8,
  documents: 9,
  disputes: 10,
  inspection: 11,
  listing: 12,
} as const;

export type TimelineEntityType = keyof typeof TIMELINE_ENTITY_TYPES;

function resolveTimelineEntityType(entityType: TimelineEntityType | number): number {
  if (typeof entityType === "number") return entityType;
  const code = TIMELINE_ENTITY_TYPES[entityType];
  if (code === undefined) {
    throw new Error(
      `Unknown timeline entity type "${entityType}"; expected one of ${Object.keys(TIMELINE_ENTITY_TYPES).join(", ")} or a numeric code`,
    );
  }
  return code;
}
