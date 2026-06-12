import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StaticTokenProvider, TcClient } from "tenantcloud-client";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function page(items: Array<{ id: number; attributes: Record<string, unknown> }>) {
  return {
    data: items.map(({ id, attributes }) => ({ type: "x", id, attributes })),
    meta: {
      pagination: {
        total: items.length,
        count: items.length,
        per_page: 100,
        current_page: 1,
        total_pages: 1,
      },
    },
  };
}

/** Routes fetch calls by URL substring to canned TenantCloud responses. */
function fakeTenantCloud(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("auth/user")) {
      return jsonResponse({ user: { id: 500, firstName: "Eric", lastName: "Ma", email: "e@x.com" } });
    }
    if (url.includes("properties")) {
      return jsonResponse(
        page([
          {
            id: 10,
            attributes: {
              name: "Evergreen Terrace",
              address1: "742 Evergreen Terrace",
              cityAddress: "Springfield",
              property_status: "active",
            },
          },
        ]),
      );
    }
    if (url.includes("units")) {
      return jsonResponse(
        page([
          {
            id: 20,
            attributes: {
              property_id: 10,
              name: "Unit 3B",
              price: 1200,
              is_rented: true,
              pets_allowed: false,
              is_furnished: false,
              is_utilities: false,
            },
          },
        ]),
      );
    }
    if (url.includes("contacts")) {
      return jsonResponse(
        page([
          {
            id: 30,
            attributes: {
              name: "John Smith",
              first_name: "John",
              last_name: "Smith",
              email: "john@example.com",
              phone: "555-123-4567",
            },
          },
        ]),
      );
    }
    if (url.includes("leases")) {
      return jsonResponse(
        page([
          {
            id: 40,
            attributes: {
              name: "Lease 3B",
              created_at: "2024-01-01T00:00:00Z",
              rent_from: "2024-02-01",
              rent_to: null,
              move_out_date: null,
              unit_id: 20,
              user_client_id: 30,
              lease_status: "active",
            },
          },
        ]),
      );
    }
    if (url.includes("transactions")) {
      return jsonResponse(page([]));
    }
    return jsonResponse({ message: "not found" }, 404);
  }) as typeof fetch;
}

async function connectedClient() {
  const tcClient = new TcClient(new StaticTokenProvider("test-token"), {
    fetch: fakeTenantCloud(),
  });
  const server = createServer(tcClient);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("tc-mcp server", () => {
  it("exposes the six tools and the guide resource", async () => {
    const client = await connectedClient();

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "get_user_info",
      "list_contacts",
      "list_leases",
      "list_properties",
      "list_transactions",
      "list_units",
    ]);

    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toContain("tc://guide");
  });

  it("get_user_info returns the signed-in user", async () => {
    const client = await connectedClient();

    const result = await client.callTool({ name: "get_user_info", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const user = JSON.parse(text) as { id: number; firstName: string };

    expect(user.id).toBe(500);
    expect(user.firstName).toBe("Eric");
  });

  it("list_leases enriches results with name references", async () => {
    const client = await connectedClient();

    const result = await client.callTool({ name: "list_leases", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const payload = JSON.parse(text) as {
      count: number;
      references: Record<string, Record<string, string>>;
    };

    expect(payload.count).toBe(1);
    expect(payload.references["units"]).toEqual({ "20": "Unit 3B (Evergreen Terrace)" });
    expect(payload.references["contacts"]).toEqual({ "30": "John Smith" });
  });

  it("reads entity detail resources", async () => {
    const client = await connectedClient();

    const result = await client.readResource({ uri: "tc://unit/20" });
    const text = (result.contents as Array<{ text: string }>)[0]!.text;
    const unit = JSON.parse(text) as { name: string; propertyName: string };

    expect(unit.name).toBe("Unit 3B");
    expect(unit.propertyName).toBe("Evergreen Terrace");
  });

  it("returns isError for unauthenticated calls", async () => {
    const tcClient = new TcClient(new StaticTokenProvider("bad"), {
      fetch: (async () => jsonResponse({ message: "Unauthenticated." }, 401)) as typeof fetch,
    });
    const server = createServer(tcClient);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "list_properties", arguments: {} });
    expect(result.isError).toBe(true);
  });
});
