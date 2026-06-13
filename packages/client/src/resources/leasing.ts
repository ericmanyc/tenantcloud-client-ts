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

export function parseLead(raw: Record<string, unknown>): TcLead {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    name: s(pick(raw, "name")),
    email: s(pick(raw, "email")),
    phone: s(pick(raw, "phone")),
    category: s(pick(raw, "category")),
    type: s(pick(raw, "type")),
    source: s(pick(raw, "source")),
    status: s(pick(raw, "status")),
    lastActionAt: parseTcDateOrNull(pick(raw, "last_action_at")),
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

  async listLeads(
    options: {
      page?: number | undefined;
      filters?: Record<string, string | number> | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<{ items: TcLead[]; total: number }> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(options.filters ?? {})) query[`filter[${k}]`] = v;
    const payload = await this.http.request("GET", withQuery("/leads", query), {
      signal: options.signal,
    });
    const { items, pagination } = parseJsonApiList(payload);
    return { items: items.map(parseLead), total: pagination.total };
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
  async updateLead(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcLead | null> {
    const payload = await this.http.request("PATCH", `/landlord/leads/${id}`, {
      body: jsonApiBody("lead", attributes, id),
      signal,
    });
    const one = parseJsonApiOne(payload);
    return one ? parseLead(one) : null;
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
