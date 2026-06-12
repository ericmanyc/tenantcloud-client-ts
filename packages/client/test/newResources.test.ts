import { describe, expect, it, vi } from "vitest";
import { StaticTokenProvider } from "../src/auth.js";
import { TcClient } from "../src/tcClient.js";
import { parseTask } from "../src/resources/productivity.js";
import { parseFile } from "../src/resources/files.js";
import { parseJsonApiList } from "../src/resources/jsonApi.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("productivity & files parsers", () => {
  it("parses a task", () => {
    const t = parseTask({
      id: 3,
      title: "Renew CO",
      text: "annual",
      is_recurring: false,
      is_resolved: false,
      is_full_day: true,
      remind_date: "2026-06-30T13:00:00.000000Z",
      created_at: "2026-06-01T00:00:00Z",
    });
    expect(t).toMatchObject({ id: 3, title: "Renew CO", isFullDay: true, isResolved: false });
    expect(t.remindDate).toBeInstanceOf(Date);
  });

  it("parses a file", () => {
    const f = parseFile({
      id: 8,
      sender_id: 100,
      parent_id: null,
      type: "lease",
      name: "lease.pdf",
      token: "abc",
      size: 1234,
      ext: "pdf",
      is_image: false,
      is_archived: false,
      file_url: "https://x/lease.pdf",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(f).toMatchObject({ id: 8, name: "lease.pdf", ext: "pdf", isImage: false, size: 1234 });
    expect(f.fileUrl).toBe("https://x/lease.pdf");
  });
});

describe("parseJsonApiList envelope tolerance", () => {
  it("treats a single-object data envelope as a one-item list (statistics endpoints)", () => {
    const { items, pagination } = parseJsonApiList({
      data: { type: "transaction_statistics", id: 0, attributes: { amount: 100, balance: 25 } },
    });
    expect(items).toEqual([{ amount: 100, balance: 25, type: "transaction_statistics", id: 0 }]);
    expect(pagination.total).toBe(1);
  });

  it("returns an empty list for null/absent data", () => {
    expect(parseJsonApiList({ data: null }).items).toEqual([]);
    expect(parseJsonApiList({}).items).toEqual([]);
  });
});

describe("financials statistics survive a single-object response", () => {
  it("does not throw when /transactions/statistics returns one object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { type: "transaction_statistics", id: 0, attributes: { amount: 5, balance: 1, currency: "USD", paid: 4 } } }),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const stats = await client.financials.statistics({ property_id: 10 });

    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ amount: 5, balance: 1 });
  });
});

describe("new write paths", () => {
  it("creates a task via JSON:API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { data: { type: "task", id: "9", attributes: { title: "T", remind_date: "2026-06-30", is_full_day: true } } },
        201,
      ),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const task = await client.productivity.createTask({ title: "T", remind_date: "2026-06-30" });

    expect(task?.id).toBe(9);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tenantcloud.com/tasks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: "task", attributes: { title: "T", remind_date: "2026-06-30" } },
    });
  });

  it("creates a contact with the userClient JSON:API type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { data: { type: "userClient", id: "55", attributes: { firstName: "Jane", lastName: "Doe", email: "j@x.com" } } },
        201,
      ),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const contact = await client.crm.create({ firstName: "Jane", lastName: "Doe", email: "j@x.com" });

    expect(contact?.id).toBe(55);
    expect(contact?.firstName).toBe("Jane");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tenantcloud.com/contacts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: "userClient", attributes: { firstName: "Jane", lastName: "Doe", email: "j@x.com" } },
    });
  });

  it("lists files and parses items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ type: "file", id: "1", attributes: { name: "a.pdf", ext: "pdf", is_image: false } }],
        meta: { pagination: { total: 1, current_page: 1, per_page: 100, total_pages: 1 } },
      }),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const { items, pagination } = await client.files.list();

    expect(items[0]?.name).toBe("a.pdf");
    expect(pagination.total).toBe(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/files");
  });

  it("exposes owner agreements on the financials client", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: [], meta: { pagination: { total: 0, current_page: 1, per_page: 100, total_pages: 1 } } }),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const { items } = await client.financials.ownerAgreements();

    expect(items).toEqual([]);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/owner_agreements");
  });
});
