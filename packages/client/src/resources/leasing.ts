/**
 * Leasing: leases (writes), notices, roommates, rental applications,
 * tenant screenings, leads and renter profiles. All JSON:API.
 *
 * Reads for the lease list stay on `client.leases` (PaginatedSource); this
 * client adds the create/update/delete and the surrounding leasing resources.
 *
 * Endpoints:
 *   POST/GET   /leases, /leases/{id}
 *   GET/POST   /leases/roommates
 *   GET/POST   /leases/{id}/notices (+ /draft, /preview)
 *   GET/POST   /applications (+ /{id}, /{id}/submit, /{id}/sign, /{id}/thread)
 *   POST       /applications/apply_invitations/{id}/{accept|decline|cancel}
 *   GET/POST   /screenings (+ /{id}/cancel, /{id}/generate-report)
 *   GET/POST   /leads (+ /{id}/thread, /{id}/view)
 *   GET/POST   /renter_profiles/{incomes|pets|references|residences|vehicles|emergency_contacts}
 */
import { parseLease, type TcLease } from "../models.js";
import {
  parseLeaseStatus,
  parseTcDateOrNull,
  pick,
  toBoolean,
  toNumber,
  toNumberOrNull,
  toStringOrNull,
  type TcLeaseStatus,
} from "../json.js";
import { TcClientError } from "../errors.js";
import { parseThread, type TcThread } from "./messaging.js";
import {
  JsonApiResourceClient,
  jsonApiBody,
  parseJsonApiList,
  parseJsonApiOne,
  withQuery,
  type JsonApiList,
  type JsonApiRecord,
  type TcHttp,
} from "./jsonApi.js";

export interface TcLead {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  type: string | null;
  source: string | null;
  status: string | null;
  lastActionAt: Date | null;
}

export interface LeadListOptions {
  page?: number | undefined;
  /** filter[search]: name or email substring. Honored server-side. */
  search?: string | undefined;
  /** filter[type]: hot, warm, or cold. Honored server-side. */
  type?: string | undefined;
  /**
   * Lead status (new, contacted, closed, ...). The API silently ignores a
   * server-side status filter, so listLeadsAll applies this client-side.
   */
  status?: string | undefined;
  /**
   * Scope leads to one or more marketing listings. This is the ONLY way to
   * narrow leads to a unit/property: a lead belongs to a listing (which carries
   * property_id/unit_id), so resolve listing ids first (resolveListingIds) and
   * pass them here. Sent as filter[listing_ids][i] (the singular filter[*_id]
   * forms the API silently ignores).
   */
  listingIds?: number[] | undefined;
  /** Sort field. Defaults to "-last_action_at" (most recently active first). */
  sort?: string | undefined;
  signal?: AbortSignal | undefined;
}

/** A marketing listing - the link between a unit/property and its leads. */
export interface TcListing {
  id: number;
  propertyId: number | null;
  unitId: number | null;
  /** 1 = listed/active, 0 = unlisted. */
  status: number | null;
  /** statistics.leads - the listing's reported lead count. */
  leadCount: number | null;
}

export function parseListing(raw: Record<string, unknown>): TcListing {
  const stats = pick(raw, "statistics");
  const leadCount =
    stats && typeof stats === "object"
      ? toNumberOrNull((stats as Record<string, unknown>)["leads"])
      : null;
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    propertyId: toNumberOrNull(pick(raw, "property_id")),
    unitId: toNumberOrNull(pick(raw, "unit_id")),
    status: toNumberOrNull(pick(raw, "status")),
    leadCount,
  };
}

export function parseLead(raw: Record<string, unknown>): TcLead {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  // The list serializes last_action_at at the top level; the landlord detail
  // (`/landlord/leads/{id}`) nests it under `meta`. Accept either.
  const meta = pick(raw, "meta");
  const lastAction =
    pick(raw, "last_action_at") ??
    (meta && typeof meta === "object"
      ? (meta as Record<string, unknown>)["last_action_at"]
      : undefined);
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    name: s(pick(raw, "name")),
    email: s(pick(raw, "email")),
    phone: s(pick(raw, "phone")),
    category: s(pick(raw, "category")),
    type: s(pick(raw, "type")),
    source: s(pick(raw, "source")),
    status: s(pick(raw, "status")),
    lastActionAt: parseTcDateOrNull(lastAction),
  };
}

export type RenterProfileKind =
  | "incomes"
  | "pets"
  | "references"
  | "residences"
  | "vehicles"
  | "emergency_contacts";

const RENTER_PROFILE_TYPE: Record<RenterProfileKind, string> = {
  incomes: "renter_profile_income",
  pets: "renter_profile_pet",
  references: "renter_profile_reference",
  residences: "renter_profile_residence",
  vehicles: "renter_profile_vehicle",
  emergency_contacts: "renter_profile_emergency_contact",
};

/**
 * A tenant on a lease (`lease_roommate`). The lease *signing* state lives here,
 * not on the lease itself: `is_signature_required` says whether this tenant must
 * sign, `steps_info.agreement` flips to `true` once they have, and `is_shared`
 * means the lease was sent to them.
 */
export interface TcLeaseRoommate {
  id: number;
  contactId: number | null;
  name: string | null;
  email: string | null;
  isSignatureRequired: boolean;
  isShared: boolean;
  isSigned: boolean;
  signingStatus: "signed" | "not_signed" | "not_required";
}

/** Rolled-up signing state for a lease, derived from its roommates. */
export interface TcLeaseSigning {
  leaseId: number;
  leaseStatus: TcLeaseStatus | null;
  /** At least one roommate must sign. */
  signatureRequired: boolean;
  /** Every roommate who must sign has signed. */
  allSigned: boolean;
  /** Names/emails of roommates who still need to sign. */
  pendingSigners: string[];
  roommates: TcLeaseRoommate[];
  summary: string;
}

/**
 * The renewal outcome for a lease: whether a successor exists on the unit and,
 * if so, its key terms and signing state. `status` is "renewed" once the
 * renewal needs no signature or is fully signed, "awaiting_sig" while signatures
 * are still outstanding, and "no_renewal" when no successor was found.
 */
export interface TcLeaseRenewal {
  found: boolean;
  /** The lease the renewal was looked up for. */
  baseLeaseId: number;
  renewalLeaseId?: number | undefined;
  tenantId?: number | null | undefined;
  /** Renewal start date, ISO (YYYY-MM-DD). */
  rentFrom?: string | undefined;
  /** Renewal end date, ISO (YYYY-MM-DD), or null if open-ended. */
  rentTo?: string | null | undefined;
  rent?: number | null | undefined;
  status: "renewed" | "awaiting_sig" | "no_renewal";
  /** Names/emails still needed when status is "awaiting_sig". */
  pendingSigners?: string[] | undefined;
  summary: string;
}

/**
 * Format a lease Date as an ISO calendar date (YYYY-MM-DD) using its local
 * components. parseTcDate builds dates at local midnight, so reading the local
 * Y/M/D round-trips the original "2026-07-01" without a timezone shift (which
 * toISOString would introduce in negative-offset zones).
 */
function isoDate(date: Date | null | undefined): string | undefined {
  if (!date) {
    return undefined;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface RawRelationship {
  data?: { id?: unknown } | Array<{ id?: unknown }> | null;
}
interface RawResource {
  id?: unknown;
  type?: unknown;
  attributes?: Record<string, unknown> | null;
  relationships?: Record<string, RawRelationship> | null;
}

function relationshipId(rels: Record<string, RawRelationship> | null | undefined, name: string): number | null {
  const data = rels?.[name]?.data;
  const first = Array.isArray(data) ? data[0] : data;
  return first ? toNumberOrNull(first.id) : null;
}

function parseLeaseRoommate(
  item: RawResource,
  contactsById: Map<number, { name: string | null; email: string | null }>,
): TcLeaseRoommate {
  const a = item.attributes ?? {};
  const isSignatureRequired = toBoolean(pick(a, "is_signature_required"));
  const steps = pick(a, "steps_info");
  const isSigned =
    steps !== null && typeof steps === "object"
      ? Boolean((steps as Record<string, unknown>)["agreement"])
      : false;
  const contactId =
    relationshipId(item.relationships, "contact") ?? toNumberOrNull(pick(a, "user_client_id", "contact_id"));
  const contact = contactId !== null ? contactsById.get(contactId) : undefined;
  return {
    id: toNumber(item.id ?? 0),
    contactId,
    name: contact?.name ?? toStringOrNull(pick(a, "name")),
    email: contact?.email ?? toStringOrNull(pick(a, "email")),
    isSignatureRequired,
    isShared: toBoolean(pick(a, "is_shared")),
    isSigned,
    signingStatus: !isSignatureRequired ? "not_required" : isSigned ? "signed" : "not_signed",
  };
}

function summarizeSigning(
  leaseId: number,
  leaseStatus: TcLeaseStatus | null,
  roommates: TcLeaseRoommate[],
): TcLeaseSigning {
  const required = roommates.filter((r) => r.isSignatureRequired);
  const signatureRequired = required.length > 0;
  const pending = required.filter((r) => !r.isSigned);
  const allSigned = signatureRequired && pending.length === 0;
  const pendingSigners = pending.map((r) => r.name ?? r.email ?? `roommate ${r.id}`);
  const noun = leaseStatus === "future" ? "renewal" : "lease";
  let summary: string;
  if (!signatureRequired) {
    summary = `No signatures are required on this ${noun}.`;
  } else if (allSigned) {
    summary = `This ${noun} is fully signed by all ${required.length} required signer(s).`;
  } else {
    summary = `This ${noun} is NOT fully signed - awaiting ${pendingSigners.length} of ${required.length} signer(s): ${pendingSigners.join(", ")}.`;
  }
  return { leaseId, leaseStatus, signatureRequired, allSigned, pendingSigners, roommates, summary };
}

export class LeasingClient {
  constructor(private readonly http: TcHttp) {}

  // --- Leases (writes; reads via client.leases) ---

  async getLease(id: number, signal?: AbortSignal): Promise<TcLease | null> {
    const payload = await this.http.request("GET", `/leases/${id}`, { signal });
    const one = parseJsonApiOne(payload);
    return one ? parseLease(one) : null;
  }

  /**
   * Fetch a lease's signing status. Signing data lives on the lease's
   * `lease_roommate` records, which only appear in `included[]` when the lease
   * is requested with `include=roommates`; this also pulls `roommates.contact`
   * to resolve each signer's name. Returns null if the lease is not found.
   */
  async getLeaseSigning(id: number, signal?: AbortSignal): Promise<TcLeaseSigning | null> {
    const payload = await this.http.request(
      "GET",
      withQuery(`/leases/${id}`, { include: "roommates,roommates.contact" }),
      { signal },
    );
    const env = (payload ?? {}) as { data?: RawResource | null; included?: RawResource[] | null };
    if (!env.data || typeof env.data !== "object") {
      return null;
    }
    const leaseAttrs = env.data.attributes ?? {};
    let leaseStatus: TcLeaseStatus | null = null;
    try {
      leaseStatus = parseLeaseStatus(pick(leaseAttrs, "lease_status"));
    } catch {
      leaseStatus = null;
    }
    const included = Array.isArray(env.included) ? env.included : [];
    const contactsById = new Map<number, { name: string | null; email: string | null }>();
    for (const it of included) {
      if (String(it.type) === "userClient" && it.attributes) {
        const cid = toNumberOrNull(it.id);
        if (cid !== null) {
          const a = it.attributes;
          const composed = [toStringOrNull(pick(a, "first_name")), toStringOrNull(pick(a, "last_name"))]
            .filter(Boolean)
            .join(" ");
          const name = toStringOrNull(pick(a, "name")) ?? (composed !== "" ? composed : null);
          contactsById.set(cid, { name, email: toStringOrNull(pick(a, "email")) });
        }
      }
    }
    const roommates = included
      .filter((it) => String(it.type) === "lease_roommate")
      .map((it) => parseLeaseRoommate(it, contactsById));
    return summarizeSigning(toNumber(env.data.id ?? id), leaseStatus, roommates);
  }

  /**
   * Every lease on a unit, regardless of status. The `/leases` list with
   * `filter[unit_id]` carries no implicit status filter (verified live), so
   * this surfaces the full chain - active, future renewals and ended leases -
   * which is what renewal tracing needs. Pages until maxResults or exhaustion.
   */
  async listLeasesForUnit(unitId: number, maxResults = 200, signal?: AbortSignal): Promise<TcLease[]> {
    const result: TcLease[] = [];
    let page = 1;
    while (result.length < maxResults) {
      signal?.throwIfAborted();
      const payload = await this.http.request(
        "GET",
        withQuery("/leases", { "filter[unit_id]": unitId, page }),
        { signal },
      );
      const { items, pagination } = parseJsonApiList(payload);
      result.push(...items.map(parseLease));
      page += 1;
      if (result.length >= pagination.total || items.length === 0) {
        break;
      }
    }
    return result;
  }

  /**
   * Resolve a lease's renewal: the future lease that replaces it on the same
   * unit, plus that renewal's signing state.
   *
   * Matching: `previous_lease_id === leaseId` is the authoritative signal and is
   * tried first - it is the only reliable link on multi-tenant units (one lease
   * per room), where several future leases can coexist for different tenants.
   * When nothing points back at this lease, fall back to a future lease for the
   * SAME tenant that starts after it. Returns null only when the base lease does
   * not exist (so the tool can report "lease not found"); a missing renewal is a
   * found:false result with status "no_renewal".
   */
  async getLeaseRenewal(leaseId: number, signal?: AbortSignal): Promise<TcLeaseRenewal | null> {
    const base = await this.getLease(leaseId, signal);
    if (!base) {
      return null;
    }
    const others = (await this.listLeasesForUnit(base.unitId, 200, signal)).filter(
      (l) => l.id !== base.id,
    );

    let candidates = others.filter((l) => l.previousLeaseId === leaseId);
    if (candidates.length === 0) {
      candidates = others.filter(
        (l) =>
          l.tenantId !== null &&
          l.tenantId === base.tenantId &&
          l.status === "future" &&
          l.startDate.getTime() > base.startDate.getTime(),
      );
    }

    if (candidates.length === 0) {
      return {
        found: false,
        baseLeaseId: leaseId,
        status: "no_renewal",
        summary: `No renewal lease was found for lease ${leaseId} on unit ${base.unitId}.`,
      };
    }

    // Prefer a future (lease_status 1) candidate, then the earliest start - the
    // immediate successor rather than a later one further down the chain.
    candidates.sort((a, b) => {
      const af = a.status === "future" ? 0 : 1;
      const bf = b.status === "future" ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.startDate.getTime() - b.startDate.getTime();
    });
    const renewal = candidates[0]!;

    const signing = await this.getLeaseSigning(renewal.id, signal);
    const signatureRequired = signing?.signatureRequired ?? false;
    const allSigned = signing?.allSigned ?? false;
    const status: TcLeaseRenewal["status"] = !signatureRequired || allSigned ? "renewed" : "awaiting_sig";
    const pendingSigners = signing?.pendingSigners ?? [];

    const summary =
      status === "renewed"
        ? `Lease ${leaseId} has been renewed by lease ${renewal.id}${signatureRequired ? " (fully signed)" : " (no signature required)"}.`
        : `Lease ${leaseId} has a renewal (lease ${renewal.id}) that is awaiting signature${pendingSigners.length > 0 ? ` from: ${pendingSigners.join(", ")}` : ""}.`;

    return {
      found: true,
      baseLeaseId: leaseId,
      renewalLeaseId: renewal.id,
      tenantId: renewal.tenantId,
      rentFrom: isoDate(renewal.startDate),
      rentTo: isoDate(renewal.endDate),
      rent: renewal.rent,
      status,
      pendingSigners,
      summary,
    };
  }

  async createLease(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcLease | null> {
    const payload = await this.http.request("POST", "/leases", {
      body: jsonApiBody("leases", attributes),
      signal,
    });
    const one = parseJsonApiOne(payload);
    return one ? parseLease(one) : null;
  }

  async updateLease(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcLease | null> {
    const payload = await this.http.request("PATCH", `/leases/${id}`, {
      body: jsonApiBody("leases", attributes, id),
      signal,
    });
    const one = parseJsonApiOne(payload);
    return one ? parseLease(one) : null;
  }

  async deleteLease(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/leases/${id}`, { signal });
  }

  listRoommates(
    filters: Record<string, string | number> = {},
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<JsonApiList> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/leases/roommates", query), { signal: options.signal })
      .then(parseJsonApiList);
  }

  async addRoommate(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", "/leases/roommates", {
      body: jsonApiBody("lease_roommate", attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  // --- Notices ---

  listNotices(leaseId: number, signal?: AbortSignal): Promise<JsonApiList> {
    return this.http.request("GET", `/leases/${leaseId}/notices`, { signal }).then(parseJsonApiList);
  }

  async createNotice(
    leaseId: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", `/leases/${leaseId}/notices`, {
      body: jsonApiBody("notice", attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  draftNotice(leaseId: number, attributes: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", `/leases/${leaseId}/notices/draft`, {
      body: jsonApiBody("notice", attributes),
      signal,
    });
  }

  previewNotice(leaseId: number, attributes: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", `/leases/${leaseId}/notices/preview`, {
      body: jsonApiBody("notice", attributes),
      signal,
    });
  }

  // --- Applications ---

  listApplications(
    filters: Record<string, string | number> = {},
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<JsonApiList> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/applications", query), { signal: options.signal })
      .then(parseJsonApiList);
  }

  getApplication(id: number, signal?: AbortSignal): Promise<JsonApiRecord | null> {
    return this.http.request("GET", `/applications/${id}`, { signal }).then(parseJsonApiOne);
  }

  async createApplication(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", "/applications", {
      body: jsonApiBody("application", attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  submitApplication(id: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", `/applications/${id}/submit`, { signal });
  }

  /** Respond to an application invitation. */
  respondToInvitation(
    invitationId: number,
    decision: "accept" | "decline" | "cancel",
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.http.request("POST", `/applications/apply_invitations/${invitationId}/${decision}`, {
      signal,
    });
  }

  // --- Screenings ---

  listScreenings(
    filters: Record<string, string | number> = {},
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<JsonApiList> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/screenings", query), { signal: options.signal })
      .then(parseJsonApiList);
  }

  async createScreening(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", "/screenings", {
      body: jsonApiBody("screening", attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  cancelScreening(id: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", `/screenings/${id}/cancel`, { signal });
  }

  generateScreeningReport(id: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", `/screenings/${id}/generate-report`, { signal });
  }

  // --- Leads ---

  // Verified live against /leads: `sort` (e.g. "-last_action_at"),
  // `filter[search]` (name/email substring), `filter[type]` (hot/warm/cold) and
  // `filter[listing_ids][i]` (scope to listings) are honored. `filter[status]`
  // and the SINGULAR `filter[unit_id|property_id|listing_id]` are SILENTLY
  // IGNORED (the API returns the full set), so we never send them - status is
  // filtered client-side in listLeadsAll, and unit/property scoping goes through
  // listing ids (resolveListingIds). The default order is oldest first, which
  // buries the live pipeline, so we default to most-recent-active.

  /** Single page of leads. Only sends filters the API actually honors. */
  async listLeads(
    options: LeadListOptions = {},
  ): Promise<{ items: TcLead[]; total: number }> {
    const query: Record<string, string | number | undefined> = {
      page: options.page,
      sort: options.sort ?? "-last_action_at",
    };
    if (options.search !== undefined) query["filter[search]"] = options.search;
    if (options.type !== undefined) query["filter[type]"] = options.type;
    // The API only honors the indexed-array form filter[listing_ids][0], [1], ...
    options.listingIds?.forEach((id, i) => {
      query[`filter[listing_ids][${i}]`] = id;
    });
    const payload = await this.http.request("GET", withQuery("/leads", query), {
      signal: options.signal,
    });
    const { items, pagination } = parseJsonApiList(payload);
    return { items: items.map(parseLead), total: pagination.total };
  }

  // --- Listings (the bridge from a unit/property to its leads) ---

  /** Single page of marketing listings. */
  async listListings(
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<{ items: TcListing[]; total: number }> {
    const payload = await this.http.request(
      "GET",
      withQuery("/listings", { page: options.page }),
      { signal: options.signal },
    );
    const { items, pagination } = parseJsonApiList(payload);
    return { items: items.map(parseListing), total: pagination.total };
  }

  /** Fetch every page of listings up to maxResults. */
  async listAllListings(maxResults = 300, signal?: AbortSignal): Promise<TcListing[]> {
    const result: TcListing[] = [];
    let page = 1;
    while (result.length <= maxResults) {
      signal?.throwIfAborted();
      const { items, total } = await this.listListings({ page, signal });
      result.push(...items);
      page += 1;
      if (result.length >= total || items.length === 0) break;
    }
    return result;
  }

  /**
   * Resolve the listing ids for a property and/or unit by scanning listings
   * (the API has no server-side listings filter). The result feeds
   * LeadListOptions.listingIds to scope leads to that unit/property.
   */
  async resolveListingIds(
    opts: { propertyId?: number | undefined; unitId?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<number[]> {
    if (opts.propertyId === undefined && opts.unitId === undefined) return [];
    const listings = await this.listAllListings(1000, opts.signal);
    return listings
      .filter(
        (l) =>
          (opts.propertyId === undefined || l.propertyId === opts.propertyId) &&
          (opts.unitId === undefined || l.unitId === opts.unitId),
      )
      .map((l) => l.id);
  }

  /**
   * Page through leads (most-recently-active first by default) up to maxResults.
   * Applies the `status` filter client-side because the API ignores a server
   * status filter. `total` is the server-side match count (search/type are
   * honored, status is not); `scanned` is how many rows were examined to gather
   * the matches (relevant only when status-filtering, which can stop early).
   */
  async listLeadsAll(
    maxResults = 100,
    options: LeadListOptions = {},
  ): Promise<{ items: TcLead[]; total: number; scanned: number }> {
    const wantStatus = options.status?.trim().toLowerCase();
    const collected: TcLead[] = [];
    let page = 1;
    let total = 0;
    let scanned = 0;
    // With no status filter we only need maxResults rows; with one, scan further
    // (recent-first clusters active leads up front) but stay bounded.
    const scanCap = wantStatus ? Math.max(maxResults * 5, 60) : maxResults;
    while (collected.length < maxResults && scanned < scanCap) {
      options.signal?.throwIfAborted();
      const { items, total: t } = await this.listLeads({ ...options, page });
      total = t;
      scanned += items.length;
      for (const lead of items) {
        if (wantStatus && (lead.status ?? "").toLowerCase() !== wantStatus) continue;
        collected.push(lead);
        if (collected.length >= maxResults) break;
      }
      page += 1;
      if (scanned >= total || items.length === 0) break;
    }
    return { items: collected, total, scanned };
  }

  async createLead(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcLead | null> {
    const payload = await this.http.request("POST", "/leads", {
      body: jsonApiBody("lead", attributes),
      signal,
    });
    const one = parseJsonApiOne(payload);
    return one ? parseLead(one) : null;
  }

  // Per-lead detail/update/delete live under the landlord namespace
  // (`/landlord/leads/{id}`); the bare `/leads/{id}` path does not exist.
  // This endpoint is NOT JSON:API: the body is a plain object of attributes
  // (e.g. {"status":"working"}) and the response is a plain lead object.
  async updateLead(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcLead | null> {
    const payload = await this.http.request("PATCH", `/landlord/leads/${id}`, {
      body: attributes,
      signal,
    });
    const data = (payload as { data?: Record<string, unknown> })?.data ?? payload;
    return data && typeof data === "object" ? parseLead(data as Record<string, unknown>) : null;
  }

  /**
   * Move a lead through its pipeline by setting its status. Known values:
   * "new", "working", "closed" (others may exist). PATCHes the plain
   * {"status": ...} body the web app sends.
   */
  async updateLeadStatus(
    leadId: number,
    status: string,
    signal?: AbortSignal,
  ): Promise<TcLead | null> {
    return this.updateLead(leadId, { status }, signal);
  }

  async deleteLead(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/landlord/leads/${id}`, { signal });
  }

  /**
   * Get or create the messenger thread for a lead (`/leads/{id}/thread`).
   * Not JSON:API - the API answers with a bare `{ id, type, created_at,
   * updated_at }` thread. GET 404s until the thread exists, so POST first
   * (which creates it) and fall back to GET if the create is rejected.
   */
  async openLeadThread(leadId: number, signal?: AbortSignal): Promise<TcThread | null> {
    let payload: unknown;
    try {
      payload = await this.http.request("POST", `/leads/${leadId}/thread`, { signal });
    } catch (error) {
      if (!(error instanceof TcClientError)) {
        throw error;
      }
      payload = await this.http.request("GET", `/leads/${leadId}/thread`, { signal });
    }
    const data = (payload as { data?: Record<string, unknown> })?.data ?? payload;
    return data && typeof data === "object" ? parseThread(data as Record<string, unknown>) : null;
  }

  // --- Renter profiles ---

  /** CRUD client for a renter-profile sub-resource (incomes, pets, etc.). */
  renterProfiles(kind: RenterProfileKind): JsonApiResourceClient {
    return new JsonApiResourceClient(this.http, `/renter_profiles/${kind}`, RENTER_PROFILE_TYPE[kind]);
  }
}
