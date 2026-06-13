import { describe, expect, it, vi } from "vitest";
import { StaticTokenProvider } from "../src/auth.js";
import { TcClient } from "../src/tcClient.js";
import {
  jsonApiBody,
  parseJsonApiList,
  parseJsonApiOne,
  parseLaravelList,
  withQuery,
} from "../src/resources/jsonApi.js";
import { parseMessage, parseThread } from "../src/resources/messaging.js";
import { parseMaintenanceRequest } from "../src/resources/maintenance.js";
import { parseLead } from "../src/resources/leasing.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

describe("jsonApi helpers", () => {
  it("builds a JSON:API create body without id", () => {
    expect(jsonApiBody("transaction", { amount: 5 })).toEqual({
      data: { type: "transaction", attributes: { amount: 5 } },
    });
  });

  it("builds a JSON:API update body with stringified id", () => {
    expect(jsonApiBody("transaction", { amount: 5 }, 42)).toEqual({
      data: { type: "transaction", id: "42", attributes: { amount: 5 } },
    });
  });

  it("parses a JSON:API collection and injects ids", () => {
    const { items, pagination } = parseJsonApiList({
      data: [{ type: "t", id: "7", attributes: { name: "x" } }],
      meta: { pagination: { total: 1, current_page: 1, per_page: 100, total_pages: 1 } },
    });
    expect(items).toEqual([{ name: "x", type: "t", id: 7 }]);
    expect(pagination.total).toBe(1);
  });

  it("parses a single JSON:API resource", () => {
    expect(parseJsonApiOne({ data: { type: "t", id: 3, attributes: { a: 1 } } })).toEqual({
      a: 1,
      type: "t",
      id: 3,
    });
    expect(parseJsonApiOne({ data: null })).toBeNull();
  });

  it("parses a Laravel paginator envelope", () => {
    const { items, pagination } = parseLaravelList({
      data: [{ id: 1 }, { id: 2 }],
      pagination: { current_page: 2, last_page: 5, per_page: 20, total: 100 },
    });
    expect(items).toHaveLength(2);
    expect(pagination).toEqual({ total: 100, currentPage: 2, perPage: 20, totalPages: 5 });
  });

  it("appends query parameters, skipping null/undefined", () => {
    expect(withQuery("/x", { a: 1, b: undefined, c: "y" })).toBe("/x?a=1&c=y");
    expect(withQuery("/x?z=1", { a: 2 })).toBe("/x?z=1&a=2");
    expect(withQuery("/x", {})).toBe("/x");
  });
});

describe("parsers", () => {
  it("parses a messenger message", () => {
    const m = parseMessage({
      id: 9,
      thread_id: 4,
      body: "hi",
      sender_name: "Pat",
      system_type: null,
      is_read: true,
      created_at: "2026-01-02T03:04:05.000000Z",
      files: [],
    });
    expect(m.id).toBe(9);
    expect(m.threadId).toBe(4);
    expect(m.body).toBe("hi");
    expect(m.isRead).toBe(true);
    expect(m.createdAt).toBeInstanceOf(Date);
  });

  it("parses a thread with a nested last message", () => {
    const t = parseThread({
      id: 4,
      type: "tenant",
      last_message_id: 9,
      last_message: { id: 9, thread_id: 4, body: "hi" },
      participants: [],
      client: { id: 1 },
    });
    expect(t.id).toBe(4);
    expect(t.lastMessageId).toBe(9);
    expect(t.lastMessage?.body).toBe("hi");
  });

  it("parses a maintenance request", () => {
    const r = parseMaintenanceRequest({
      id: 11,
      title: "Leaky faucet",
      text: "kitchen",
      status: "new",
      priority: "high",
      property_id: 10,
      client_id: 30,
      due: "2026-06-30",
      has_returned_key: false,
      entry_allowed: true,
    });
    expect(r).toMatchObject({
      id: 11,
      title: "Leaky faucet",
      status: "new",
      priority: "high",
      propertyId: 10,
      clientId: 30,
      entryAllowed: true,
    });
    expect(r.dueDate).toBeInstanceOf(Date);
  });

  it("parses a lead", () => {
    const l = parseLead({ id: 2, name: "Jane", email: "j@x.com", phone: null, status: "new" });
    expect(l).toMatchObject({ id: 2, name: "Jane", email: "j@x.com", phone: null, status: "new" });
  });
});

describe("TcClient write paths", () => {
  it("POSTs a JSON:API create body for maintenance requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { type: "maintenance_request", id: "77", attributes: { title: "X" } } }, 201),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const created = await client.maintenance.create({ title: "X", property_id: 10 });

    expect(created?.id).toBe(77);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tenantcloud.com/maintenance_requests");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: "maintenance_request", attributes: { title: "X", property_id: 10 } },
    });
  });

  it("PATCHes a transaction with an id in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { type: "transaction", id: "5", attributes: { amount: 9, date: "2026-01-01", created_at: "2026-01-01T00:00:00Z", category: "income", status: "due", currency: "USD", paid: 0, balance: 9 } } }),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    await client.financials.updateTransaction(5, { amount: 9 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tenantcloud.com/transactions/5");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: "transaction", id: "5", attributes: { amount: 9 } },
    });
  });

  it("sends a messenger message with a plain body (not JSON:API)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { id: 1, thread_id: 4, body: "hello" } }),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    await client.messaging.sendMessage(4, "hello");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tenantcloud.com/messenger/threads/4/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ body: "hello" });
  });

  it("opens a lead thread with POST and parses the bare (non-JSON:API) response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ type: "leads", id: 88002, created_at: "2026-06-12T20:09:51.000000Z", updated_at: "2026-06-12T20:09:51.000000Z" }),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const thread = await client.leasing.openLeadThread(70555);

    expect(thread?.id).toBe(88002);
    expect(thread?.type).toBe("leads");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tenantcloud.com/leads/70555/thread");
    expect(init.method).toBe("POST");
  });

  it("falls back to GET when the lead thread create is rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "already exists" }, 422))
      .mockResolvedValueOnce(jsonResponse({ type: "leads", id: 42 }));
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const thread = await client.leasing.openLeadThread(7);

    expect(thread?.id).toBe(42);
    expect(fetchMock.mock.calls[0]![1].method).toBe("POST");
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("https://api.tenantcloud.com/leads/7/thread");
    expect(init.method).toBe("GET");
  });

  it("handles a 204 No Content response as null (DELETE)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse(204));
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    await expect(client.financials.deleteTransaction(5)).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tenantcloud.com/transactions/5");
    expect(init.method).toBe("DELETE");
  });

  it("exposes a generic JSON:API resource accessor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { type: "task", id: "1", attributes: { title: "t" } } }, 201));
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const rec = await client.resource("/tasks", "task").create({ title: "t" });

    expect(rec).toEqual({ title: "t", type: "task", id: 1 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: "task", attributes: { title: "t" } },
    });
  });
});

describe("lease signing status", () => {
  function leaseSigningResponse() {
    return jsonResponse({
      data: {
        type: "leases",
        id: "555",
        attributes: { lease_status: "future" },
        relationships: { roommates: { data: [{ id: "1" }, { id: "2" }] } },
      },
      included: [
        {
          type: "lease_roommate",
          id: "1",
          attributes: { is_signature_required: true, is_shared: true, steps_info: { agreement: true } },
          relationships: { contact: { data: { id: "9001" } } },
        },
        {
          type: "lease_roommate",
          id: "2",
          attributes: { is_signature_required: true, is_shared: true, steps_info: { agreement: false } },
          relationships: { contact: { data: { id: "9002" } } },
        },
        { type: "userClient", id: "9001", attributes: { name: "Alice Tenant", email: "alice@x.com" } },
        { type: "userClient", id: "9002", attributes: { name: "Bob Tenant", email: "bob@x.com" } },
      ],
    });
  }

  it("requests roommates and derives per-signer + overall signing state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(leaseSigningResponse());
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const signing = await client.leasing.getLeaseSigning(555);

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/leases/555");
    expect(url).toContain(`${encodeURIComponent("include")}=${encodeURIComponent("roommates,roommates.contact")}`);

    expect(signing?.leaseStatus).toBe("future");
    expect(signing?.signatureRequired).toBe(true);
    expect(signing?.allSigned).toBe(false);
    expect(signing?.pendingSigners).toEqual(["Bob Tenant"]);
    expect(signing?.roommates).toHaveLength(2);
    expect(signing?.roommates[0]).toMatchObject({ name: "Alice Tenant", isSigned: true, signingStatus: "signed" });
    expect(signing?.roommates[1]).toMatchObject({ name: "Bob Tenant", isSigned: false, signingStatus: "not_signed" });
    // future + unsigned reads as an unsigned renewal
    expect(signing?.summary).toContain("renewal");
    expect(signing?.summary).toContain("NOT fully signed");
  });

  it("reports not_required when no roommate needs a signature", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { type: "leases", id: "7", attributes: { lease_status: "active" } },
        included: [
          {
            type: "lease_roommate",
            id: "1",
            attributes: { is_signature_required: false, steps_info: { agreement: true } },
          },
        ],
      }),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const signing = await client.leasing.getLeaseSigning(7);

    expect(signing?.signatureRequired).toBe(false);
    expect(signing?.allSigned).toBe(false);
    expect(signing?.roommates[0]?.signingStatus).toBe("not_required");
    expect(signing?.summary).toContain("No signatures are required");
  });
});
