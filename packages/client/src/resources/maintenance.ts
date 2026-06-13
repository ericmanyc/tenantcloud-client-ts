/**
 * Maintenance: work orders / maintenance requests, their materials and
 * recurring schedules, plus inspections. All JSON:API.
 *
 * Endpoints:
 *   GET/POST   /maintenance_requests
 *   GET/PATCH/DELETE /maintenance_requests/{id}
 *   POST       /maintenance_requests/validate
 *   POST       /maintenance_requests/{id}/resolve
 *   GET        /maintenance_requests/{id}/print
 *   GET/POST   /maintenance_requests/{id}/materials
 *   DELETE     /maintenance_requests/{id}/materials/{mid}
 *   GET/POST   /maintenance_requests/recurring (+ /{id}, /{id}/end)
 *   GET        /maintenance_requests/default_assignees (+ /{id})
 *   GET/POST   /inspections/items (+ /{id}, /{id}/sign)
 *   GET        /inspections/records (+ /{id})
 */
import {
  maintenancePriorityCode,
  maintenanceStatusCode,
  parseMaintenancePriority,
  parseMaintenanceStatus,
  parseTcDateOrNull,
  pick,
  toBoolean,
  toNumber,
  toNumberOrNull,
} from "../json.js";
import {
  jsonApiBody,
  parseJsonApiList,
  parseJsonApiOne,
  withQuery,
  type JsonApiList,
  type JsonApiRecord,
  type TcHttp,
} from "./jsonApi.js";

export interface TcMaintenanceRequest {
  id: number;
  title: string | null;
  text: string | null;
  status: string | null;
  priority: string | null;
  propertyId: number | null;
  clientId: number | null;
  categoryId: number | null;
  assigneeId: number | null;
  assigneeType: string | null;
  professionalId: number | null;
  recurringId: number | null;
  threadId: number | null;
  authorId: number | null;
  dueDate: Date | null;
  availableOn: Date | null;
  createdAt: Date | null;
  statusChangedAt: Date | null;
  laborTimeHours: number | null;
  laborTimeMinutes: number | null;
  hasReturnedKey: boolean;
  entryAllowed: boolean;
}

export function parseMaintenanceRequest(raw: Record<string, unknown>): TcMaintenanceRequest {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    title: (pick(raw, "title") as string | null) ?? null,
    text: (pick(raw, "text") as string | null) ?? null,
    status: parseMaintenanceStatus(pick(raw, "status")),
    priority: parseMaintenancePriority(pick(raw, "priority")),
    propertyId: toNumberOrNull(pick(raw, "property_id")),
    clientId: toNumberOrNull(pick(raw, "client_id")),
    categoryId: toNumberOrNull(pick(raw, "category_id")),
    assigneeId: toNumberOrNull(pick(raw, "assignee_id")),
    assigneeType: toStr(pick(raw, "assignee_type")),
    professionalId: toNumberOrNull(pick(raw, "professional_id")),
    recurringId: toNumberOrNull(pick(raw, "recurring_id")),
    threadId: toNumberOrNull(pick(raw, "thread_id")),
    authorId: toNumberOrNull(pick(raw, "author_id")),
    dueDate: parseTcDateOrNull(pick(raw, "due")),
    availableOn: parseTcDateOrNull(pick(raw, "available_on")),
    createdAt: parseTcDateOrNull(pick(raw, "created_at")),
    statusChangedAt: parseTcDateOrNull(pick(raw, "status_changed_at")),
    laborTimeHours: toNumberOrNull(pick(raw, "labor_time_hours")),
    laborTimeMinutes: toNumberOrNull(pick(raw, "labor_time_minutes")),
    hasReturnedKey: toBoolean(pick(raw, "has_returned_key")),
    entryAllowed: toBoolean(pick(raw, "entry_allowed")),
  };
}

function toStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export interface MaintenanceListOptions {
  page?: number | undefined;
  propertyId?: number | undefined;
  clientId?: number | undefined;
  status?: string | undefined;
  priority?: string | undefined;
  assigneeId?: number | undefined;
  sort?: string | undefined;
  signal?: AbortSignal | undefined;
}

export class MaintenanceClient {
  constructor(private readonly http: TcHttp) {}

  private buildQuery(o: MaintenanceListOptions): Record<string, string | number | undefined> {
    const q: Record<string, string | number | undefined> = { page: o.page, sort: o.sort };
    if (o.propertyId !== undefined) q["filter[property_id]"] = o.propertyId;
    if (o.clientId !== undefined) q["filter[client_id]"] = o.clientId;
    // The API filters on numeric status/priority codes; accept a name or a code
    // and send the code when we recognize it, otherwise pass the value through.
    if (o.status !== undefined) q["filter[status]"] = maintenanceStatusCode(o.status) ?? o.status;
    if (o.priority !== undefined) q["filter[priority]"] = maintenancePriorityCode(o.priority) ?? o.priority;
    if (o.assigneeId !== undefined) q["filter[assignee_id]"] = o.assigneeId;
    return q;
  }

  /** List maintenance requests (typed). */
  async list(options: MaintenanceListOptions = {}): Promise<{
    items: TcMaintenanceRequest[];
    total: number;
  }> {
    const path = withQuery("/maintenance_requests", this.buildQuery(options));
    const payload = await this.http.request("GET", path, { signal: options.signal });
    const { items, pagination } = parseJsonApiList(payload);
    return { items: items.map(parseMaintenanceRequest), total: pagination.total };
  }

  /** Fetch every page of maintenance requests up to maxResults. */
  async listAll(maxResults = 300, options: MaintenanceListOptions = {}): Promise<TcMaintenanceRequest[]> {
    const result: TcMaintenanceRequest[] = [];
    let page = 1;
    while (result.length <= maxResults) {
      options.signal?.throwIfAborted();
      const { items, total } = await this.list({ ...options, page });
      result.push(...items);
      page += 1;
      if (result.length >= total || items.length === 0) break;
    }
    return result;
  }

  async get(id: number, signal?: AbortSignal): Promise<TcMaintenanceRequest | null> {
    const payload = await this.http.request("GET", `/maintenance_requests/${id}`, { signal });
    const one = parseJsonApiOne(payload);
    return one ? parseMaintenanceRequest(one) : null;
  }

  async create(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcMaintenanceRequest | null> {
    const payload = await this.http.request("POST", "/maintenance_requests", {
      body: jsonApiBody("maintenance_request", attributes),
      signal,
    });
    const one = parseJsonApiOne(payload);
    return one ? parseMaintenanceRequest(one) : null;
  }

  async update(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcMaintenanceRequest | null> {
    const payload = await this.http.request("PATCH", `/maintenance_requests/${id}`, {
      body: jsonApiBody("maintenance_request", attributes, id),
      signal,
    });
    const one = parseJsonApiOne(payload);
    return one ? parseMaintenanceRequest(one) : null;
  }

  async delete(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/maintenance_requests/${id}`, { signal });
  }

  /** Mark a request resolved. Optional body carries labor time, notes, etc. */
  async resolve(
    id: number,
    attributes: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<TcMaintenanceRequest | null> {
    const payload = await this.http.request("POST", `/maintenance_requests/${id}/resolve`, {
      body: jsonApiBody("maintenance_request", attributes, id),
      signal,
    });
    const one = parseJsonApiOne(payload);
    return one ? parseMaintenanceRequest(one) : null;
  }

  /** Server-side validation of a draft request (no side effects). */
  validate(attributes: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", "/maintenance_requests/validate", {
      body: jsonApiBody("maintenance_request", attributes),
      signal,
    });
  }

  listMaterials(requestId: number, signal?: AbortSignal): Promise<JsonApiList> {
    return this.http
      .request("GET", `/maintenance_requests/${requestId}/materials`, { signal })
      .then(parseJsonApiList);
  }

  async addMaterial(
    requestId: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", `/maintenance_requests/${requestId}/materials`, {
      body: jsonApiBody("maintenance_request_material", attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  async deleteMaterial(requestId: number, materialId: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/maintenance_requests/${requestId}/materials/${materialId}`, {
      signal,
    });
  }

  /** List recurring maintenance schedules. */
  listRecurring(options: { page?: number | undefined; signal?: AbortSignal | undefined } = {}): Promise<JsonApiList> {
    const path = withQuery("/maintenance_requests/recurring", { page: options.page });
    return this.http.request("GET", path, { signal: options.signal }).then(parseJsonApiList);
  }

  async createRecurring(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", "/maintenance_requests/recurring", {
      body: jsonApiBody("maintenance_request_recurring", attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  async endRecurring(recurringId: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("POST", `/maintenance_requests/recurring/${recurringId}/end`, { signal });
  }

  defaultAssignees(options: { page?: number | undefined; signal?: AbortSignal | undefined } = {}): Promise<unknown> {
    const path = withQuery("/maintenance_requests/default_assignees", { page: options.page });
    return this.http.request("GET", path, { signal: options.signal });
  }

  print(id: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("GET", `/maintenance_requests/${id}/print`, { signal });
  }

  // --- Inspections ---

  listInspectionItems(options: { page?: number | undefined; signal?: AbortSignal | undefined } = {}): Promise<JsonApiList> {
    const path = withQuery("/inspections/items", { page: options.page });
    return this.http.request("GET", path, { signal: options.signal }).then(parseJsonApiList);
  }

  getInspectionItem(id: number, signal?: AbortSignal): Promise<JsonApiRecord | null> {
    return this.http
      .request("GET", `/inspections/items/${id}`, { signal })
      .then(parseJsonApiOne);
  }

  async createInspectionItem(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", "/inspections/items", {
      body: jsonApiBody("inspection_item", attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  /** List inspection records. Requires a filter such as property/unit. */
  listInspectionRecords(
    filters: Record<string, string | number> = {},
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<JsonApiList> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/inspections/records", query), { signal: options.signal })
      .then(parseJsonApiList);
  }
}
