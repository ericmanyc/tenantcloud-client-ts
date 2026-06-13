/**
 * Portfolio: per-property records shown under a property in TenantCloud -
 * Keys & Locks (door codes, lockboxes, physical keys) and Equipment (appliances,
 * HVAC, meters, etc.). Both are JSON:API.
 *
 * Endpoints:
 *   GET/POST         /property/keys           (filter[property_id])
 *   GET/PATCH/DELETE /property/keys/{id}
 *   GET/POST         /property/equipment      (filter[property_id], filter[unit_id])
 *   GET/PATCH/DELETE /property/equipment/{id}
 *
 * Note: a key's owning property is not echoed back in its attributes, but the
 * list still honours filter[property_id].
 */
import { parseTcDateOrNull, pick, toBoolean, toNumber, toNumberOrNull, toStringOrNull } from "../json.js";
import { jsonApiBody, withQuery, type TcHttp } from "./jsonApi.js";

export interface TcPropertyKey {
  id: number;
  /** Human label, e.g. "Front Gate", "Mailbox". */
  keyname: string | null;
  /** Free-text notes (often HTML) - this is where door/lockbox codes live. */
  comment: string | null;
  /** Numeric key type/category (e.g. 1, 5); meaning is TenantCloud-internal. */
  type: number | null;
  createdAt: Date | null;
}

export function parsePropertyKey(raw: Record<string, unknown>): TcPropertyKey {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    keyname: toStringOrNull(pick(raw, "keyname")),
    comment: toStringOrNull(pick(raw, "comment")),
    type: toNumberOrNull(pick(raw, "type")),
    createdAt: parseTcDateOrNull(pick(raw, "created_at")),
  };
}

export interface TcPropertyEquipment {
  id: number;
  /** Manufacturer/brand. */
  make: string | null;
  propertyId: number | null;
  unitId: number | null;
  categoryId: number | null;
  modelNumber: string | null;
  /** Serial/VIN identifier. */
  vinNumber: string | null;
  price: number | null;
  installDate: Date | null;
  warrantyExpirationDate: Date | null;
  lifeTimeWarranty: boolean;
  notes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export function parsePropertyEquipment(raw: Record<string, unknown>): TcPropertyEquipment {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    make: toStringOrNull(pick(raw, "make")),
    propertyId: toNumberOrNull(pick(raw, "property_id")),
    unitId: toNumberOrNull(pick(raw, "unit_id")),
    categoryId: toNumberOrNull(pick(raw, "category_id")),
    modelNumber: toStringOrNull(pick(raw, "model_number")),
    vinNumber: toStringOrNull(pick(raw, "vin_number")),
    price: toNumberOrNull(pick(raw, "price")),
    installDate: parseTcDateOrNull(pick(raw, "install_date")),
    warrantyExpirationDate: parseTcDateOrNull(pick(raw, "warranty_expiration_date")),
    lifeTimeWarranty: toBoolean(pick(raw, "life_time_warranty")),
    notes: toStringOrNull(pick(raw, "notes")),
    createdAt: parseTcDateOrNull(pick(raw, "created_at")),
    updatedAt: parseTcDateOrNull(pick(raw, "updated_at")),
  };
}

/**
 * Parse a JSON:API envelope into raw `{ ...attributes, id }` records WITHOUT
 * going through normalizeItem. The `property_key` resource has an attribute
 * literally named `type`, which normalizeItem would clobber with the envelope's
 * resource-type string ("property_key"); reading `attributes` directly keeps it.
 */
interface RawEnvelopeItem {
  id?: unknown;
  attributes?: Record<string, unknown> | null;
}

function rawRecords(payload: unknown): { records: Record<string, unknown>[]; total: number } {
  const p = (payload ?? {}) as {
    data?: RawEnvelopeItem[] | RawEnvelopeItem | null;
    meta?: { pagination?: { total?: number } | null } | null;
  };
  const arr = Array.isArray(p.data) ? p.data : p.data ? [p.data] : [];
  const records: Record<string, unknown>[] = [];
  for (const item of arr) {
    if (!item || !item.attributes) continue;
    records.push({ ...item.attributes, id: toNumber(item.id ?? 0) });
  }
  return { records, total: p.meta?.pagination?.total ?? records.length };
}

function rawOne(payload: unknown): Record<string, unknown> | null {
  const p = (payload ?? {}) as { data?: RawEnvelopeItem | null };
  if (!p.data || typeof p.data !== "object" || !p.data.attributes) return null;
  return { ...p.data.attributes, id: toNumber(p.data.id ?? 0) };
}

export interface PropertyKeyListOptions {
  page?: number | undefined;
  propertyId?: number | undefined;
  sort?: string | undefined;
  signal?: AbortSignal | undefined;
}

/** Keys & Locks for a property. */
export class PropertyKeysClient {
  constructor(private readonly http: TcHttp) {}

  private buildQuery(o: PropertyKeyListOptions): Record<string, string | number | undefined> {
    const q: Record<string, string | number | undefined> = { page: o.page, sort: o.sort };
    if (o.propertyId !== undefined) q["filter[property_id]"] = o.propertyId;
    return q;
  }

  async list(options: PropertyKeyListOptions = {}): Promise<{ items: TcPropertyKey[]; total: number }> {
    const path = withQuery("/property/keys", this.buildQuery(options));
    const payload = await this.http.request("GET", path, { signal: options.signal });
    const { records, total } = rawRecords(payload);
    return { items: records.map(parsePropertyKey), total };
  }

  /** Fetch every page up to maxResults. */
  async listAll(maxResults = 300, options: PropertyKeyListOptions = {}): Promise<TcPropertyKey[]> {
    const result: TcPropertyKey[] = [];
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

  async get(id: number, signal?: AbortSignal): Promise<TcPropertyKey | null> {
    const one = rawOne(await this.http.request("GET", `/property/keys/${id}`, { signal }));
    return one ? parsePropertyKey(one) : null;
  }

  async create(attributes: Record<string, unknown>, signal?: AbortSignal): Promise<TcPropertyKey | null> {
    const payload = await this.http.request("POST", "/property/keys", {
      body: jsonApiBody("property_key", attributes),
      signal,
    });
    const one = rawOne(payload);
    return one ? parsePropertyKey(one) : null;
  }

  async update(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcPropertyKey | null> {
    const payload = await this.http.request("PATCH", `/property/keys/${id}`, {
      body: jsonApiBody("property_key", attributes, id),
      signal,
    });
    const one = rawOne(payload);
    return one ? parsePropertyKey(one) : null;
  }

  async delete(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/property/keys/${id}`, { signal });
  }
}

export interface EquipmentListOptions {
  page?: number | undefined;
  propertyId?: number | undefined;
  unitId?: number | undefined;
  categoryId?: number | undefined;
  sort?: string | undefined;
  signal?: AbortSignal | undefined;
}

/** Equipment/appliances tracked against a property or unit. */
export class PropertyEquipmentClient {
  constructor(private readonly http: TcHttp) {}

  private buildQuery(o: EquipmentListOptions): Record<string, string | number | undefined> {
    const q: Record<string, string | number | undefined> = { page: o.page, sort: o.sort };
    if (o.propertyId !== undefined) q["filter[property_id]"] = o.propertyId;
    if (o.unitId !== undefined) q["filter[unit_id]"] = o.unitId;
    if (o.categoryId !== undefined) q["filter[category_id]"] = o.categoryId;
    return q;
  }

  async list(options: EquipmentListOptions = {}): Promise<{ items: TcPropertyEquipment[]; total: number }> {
    const path = withQuery("/property/equipment", this.buildQuery(options));
    const payload = await this.http.request("GET", path, { signal: options.signal });
    const { records, total } = rawRecords(payload);
    return { items: records.map(parsePropertyEquipment), total };
  }

  /** Fetch every page up to maxResults. */
  async listAll(maxResults = 300, options: EquipmentListOptions = {}): Promise<TcPropertyEquipment[]> {
    const result: TcPropertyEquipment[] = [];
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

  async get(id: number, signal?: AbortSignal): Promise<TcPropertyEquipment | null> {
    const one = rawOne(await this.http.request("GET", `/property/equipment/${id}`, { signal }));
    return one ? parsePropertyEquipment(one) : null;
  }

  async create(attributes: Record<string, unknown>, signal?: AbortSignal): Promise<TcPropertyEquipment | null> {
    const payload = await this.http.request("POST", "/property/equipment", {
      body: jsonApiBody("property_equipment", attributes),
      signal,
    });
    const one = rawOne(payload);
    return one ? parsePropertyEquipment(one) : null;
  }

  async update(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcPropertyEquipment | null> {
    const payload = await this.http.request("PATCH", `/property/equipment/${id}`, {
      body: jsonApiBody("property_equipment", attributes, id),
      signal,
    });
    const one = rawOne(payload);
    return one ? parsePropertyEquipment(one) : null;
  }

  async delete(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/property/equipment/${id}`, { signal });
  }
}

/** Per-property portfolio records: keys & locks and equipment. */
export class PortfolioClient {
  /** Keys & Locks (door codes, lockboxes, physical keys). */
  readonly keys: PropertyKeysClient;
  /** Equipment / appliances tracked against a property or unit. */
  readonly equipment: PropertyEquipmentClient;

  constructor(http: TcHttp) {
    this.keys = new PropertyKeysClient(http);
    this.equipment = new PropertyEquipmentClient(http);
  }
}
