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
 * Note: a key's owning property is NOT an attribute - it is carried by the
 * JSON:API `relationships` object (`property`, and `unit` for a unit-specific
 * key). A POST that puts `property_id` in `attributes` is accepted with 201 but
 * silently creates an orphan key that never shows up under the property
 * (verified live 2026-08-06), so the ids are lifted into `relationships` here.
 * The web app's own POST always sends the complete relationship set -
 * `avatar`, `property` and `unit` - filling unset ones with `{"data":null}`
 * rather than leaving them out, so create() mirrors that shape exactly.
 * Reads never echo relationships back - only the create/update response does.
 */
import {
  labelPropertyKeyType,
  parseTcDateOrNull,
  pick,
  toBoolean,
  toNumber,
  toNumberOrNull,
  toStringOrNull,
} from "../json.js";
import { jsonApiBody, jsonApiRelationships, withQuery, type TcHttp } from "./jsonApi.js";

export interface TcPropertyKey {
  id: number;
  /** Human label, e.g. "Front Gate", "Mailbox". */
  keyname: string | null;
  /** Free-text notes (often HTML) - this is where door/lockbox codes live. */
  comment: string | null;
  /** Numeric key type/category (e.g. 1=Main door, 5=Laundry room). */
  type: number | null;
  /** Human label for `type` (e.g. "Main door"), or null if the code is unknown. */
  typeLabel: string | null;
  /**
   * Owning property, read from the JSON:API `property` relationship. Only the
   * create/update response carries it; list/get responses leave it null (use
   * the `propertyId` list filter to know which property a key belongs to).
   */
  propertyId: number | null;
  /** Owning unit, if the key is unit-specific. Same caveat as `propertyId`. */
  unitId: number | null;
  createdAt: Date | null;
}

export function parsePropertyKey(raw: Record<string, unknown>): TcPropertyKey {
  const type = toNumberOrNull(pick(raw, "type"));
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    keyname: toStringOrNull(pick(raw, "keyname")),
    comment: toStringOrNull(pick(raw, "comment")),
    type,
    typeLabel: labelPropertyKeyType(type),
    propertyId: toNumberOrNull(pick(raw, "property_id")),
    unitId: toNumberOrNull(pick(raw, "unit_id")),
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
  relationships?: Record<string, unknown> | null;
}

/**
 * Flatten `relationships: { property: { data: { id } } }` into `property_id`
 * entries so the parsers can read them like any other field. Existing
 * attributes win; a relationship with `data: null` yields a null id.
 */
function relationshipIds(relationships: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, rel] of Object.entries(relationships ?? {})) {
    const data = (rel as { data?: { id?: unknown } | null } | null)?.data;
    if (data === undefined) continue;
    const id = data === null ? null : (data.id ?? null);
    // Relationship names are inconsistently pluralised ("property" but "units"),
    // so record both spellings: "units" -> unit_id and units_id.
    out[`${name}_id`] = id;
    if (name.endsWith("s")) out[`${name.slice(0, -1)}_id`] = id;
  }
  return out;
}

function flattenItem(item: RawEnvelopeItem): Record<string, unknown> {
  return {
    ...relationshipIds(item.relationships),
    ...item.attributes,
    id: toNumber(item.id ?? 0),
  };
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
    records.push(flattenItem(item));
  }
  return { records, total: p.meta?.pagination?.total ?? records.length };
}

function rawOne(payload: unknown): Record<string, unknown> | null {
  const p = (payload ?? {}) as { data?: RawEnvelopeItem | null };
  if (!p.data || typeof p.data !== "object" || !p.data.attributes) return null;
  return flattenItem(p.data);
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

  /**
   * Split `property_id`/`unit_id` out of a caller-supplied attribute bag and
   * into a JSON:API relationships object - the API only links a key to its
   * property through `relationships`, and silently ignores the attributes.
   *
   * On create (`full`) the whole relationship set is sent the way the web app
   * sends it - `avatar`, `property` and `unit` are all present, with
   * `{"data":null}` standing in for the ones the caller left out. On update the
   * omitted ones stay omitted, so a partial PATCH cannot clear the key's unit
   * or avatar by accident.
   */
  private splitBody(
    input: Record<string, unknown>,
    full: boolean,
  ): {
    attributes: Record<string, unknown>;
    relationships: ReturnType<typeof jsonApiRelationships>;
  } {
    const { property_id: propertyId, unit_id: unitId, ...attributes } = input;
    const absent = full ? null : undefined;
    const relationships = jsonApiRelationships({
      avatar: full ? ["avatar", null] : undefined,
      property:
        propertyId === undefined ? undefined : ["property", propertyId as number | string | null],
      unit: ["units", unitId === undefined ? absent : (unitId as number | string | null)],
    });
    return { attributes, relationships };
  }

  /**
   * Create a key. `property_id` (and optional `unit_id`) may be passed among the
   * attributes; they are sent as JSON:API relationships.
   */
  async create(attributes: Record<string, unknown>, signal?: AbortSignal): Promise<TcPropertyKey | null> {
    const { attributes: attrs, relationships } = this.splitBody(attributes, true);
    const payload = await this.http.request("POST", "/property/keys", {
      body: jsonApiBody("property_key", attrs, undefined, relationships),
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
    const { attributes: attrs, relationships } = this.splitBody(attributes, false);
    const payload = await this.http.request("PATCH", `/property/keys/${id}`, {
      body: jsonApiBody("property_key", attrs, id, relationships),
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
