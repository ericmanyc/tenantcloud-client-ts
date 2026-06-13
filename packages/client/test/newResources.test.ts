import { describe, expect, it, vi } from "vitest";
import { StaticTokenProvider } from "../src/auth.js";
import { TcClient } from "../src/tcClient.js";
import { parseTask } from "../src/resources/productivity.js";
import { parseFile } from "../src/resources/files.js";
import { parseJsonApiList, normalizeItem } from "../src/resources/jsonApi.js";
import { parseMaintenanceRequest } from "../src/resources/maintenance.js";
import { parsePropertyEquipment, parsePropertyKey } from "../src/resources/portfolio.js";
import { parseTcDateOrNull } from "../src/json.js";

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

describe("real-data robustness (found via live smoke test)", () => {
  it("parseTcDateOrNull treats [], '', and blanks as null instead of throwing", () => {
    expect(parseTcDateOrNull([])).toBeNull();
    expect(parseTcDateOrNull("")).toBeNull();
    expect(parseTcDateOrNull("   ")).toBeNull();
    expect(parseTcDateOrNull({})).toBeNull();
    // a real date string still parses
    expect(parseTcDateOrNull("2026-06-30")).toBeInstanceOf(Date);
  });

  it("parseMaintenanceRequest survives an empty-array date field", () => {
    const r = parseMaintenanceRequest({ id: 1, title: "x", available_on: [], due: [], status: "new" });
    expect(r.availableOn).toBeNull();
    expect(r.dueDate).toBeNull();
  });

  it("normalizeItem treats an empty-string id as 0 (aggregate/statistics resources)", () => {
    expect(normalizeItem({ type: "transaction_payment_statistics", id: "", attributes: { amount: 5 } })).toEqual({
      amount: 5,
      type: "transaction_payment_statistics",
      id: 0,
    });
  });
});

describe("portfolio parsers (synthetic data matching the live JSON:API shape)", () => {
  it("parses a property key (codes live in comment; property_id not echoed)", () => {
    const k = parsePropertyKey({
      id: "11",
      keyname: "Unit A Front Door",
      comment: "<p>Code - 0000</p>",
      type: 1,
      created_at: "2026-03-30T15:59:55.000000Z",
    });
    expect(k).toMatchObject({ id: 11, keyname: "Unit A Front Door", type: 1 });
    expect(k.comment).toContain("0000");
    expect(k.createdAt).toBeInstanceOf(Date);
  });

  it("parses property equipment with snake_case -> camelCase mapping", () => {
    const e = parsePropertyEquipment({
      id: "22",
      make: "Acme HVAC",
      property_id: 1,
      unit_id: 2,
      category_id: 3,
      model_number: null,
      vin_number: "SN-001",
      price: null,
      install_date: null,
      warranty_expiration_date: null,
      life_time_warranty: false,
      notes: null,
      created_at: "2025-12-01T14:44:03.000000Z",
      updated_at: "2025-12-01T14:44:03.000000Z",
    });
    expect(e).toMatchObject({
      id: 22,
      make: "Acme HVAC",
      propertyId: 1,
      unitId: 2,
      categoryId: 3,
      vinNumber: "SN-001",
      lifeTimeWarranty: false,
    });
    expect(e.installDate).toBeNull();
    expect(e.createdAt).toBeInstanceOf(Date);
  });
});

describe("portfolio client paths", () => {
  it("lists keys with a property_id filter and parses items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ type: "property_key", id: "1", attributes: { keyname: "Front Door", type: 1 } }],
        meta: { pagination: { total: 1, current_page: 1, per_page: 12, total_pages: 1 } },
      }),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const { items, total } = await client.portfolio.keys.list({ propertyId: 123 });

    expect(total).toBe(1);
    expect(items[0]?.keyname).toBe("Front Door");
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/property/keys");
    expect(url).toContain(`${encodeURIComponent("filter[property_id]")}=123`);
  });

  it("creates equipment via the property_equipment JSON:API type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { data: { type: "property_equipment", id: "9", attributes: { make: "Carrier", property_id: 5 } } },
        201,
      ),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const eq = await client.portfolio.equipment.create({ property_id: 5, make: "Carrier" });

    expect(eq?.id).toBe(9);
    expect(eq?.make).toBe("Carrier");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tenantcloud.com/property/equipment");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: "property_equipment", attributes: { property_id: 5, make: "Carrier" } },
    });
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
