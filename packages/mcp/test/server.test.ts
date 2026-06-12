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

/** A messenger user the way the API really sends it: bloated and duplicated. */
function fullMessengerUser(id: number, name: string, email: string, role: string) {
  return {
    id,
    role,
    mode: null,
    email,
    country: "US",
    phone: "5550001111",
    time_zone: null,
    isConfirmed: true,
    fraud_status: null,
    created_at: "2024-12-02T21:07:56.000000Z",
    name,
    avatar: null,
    meta: { type_name: "User" },
  };
}

function messengerParticipant(id: number, user: ReturnType<typeof fullMessengerUser>) {
  return { id, thread_id: 88001, owner: user, contact: user };
}

const jordanUser = fullMessengerUser(70001, "Jordan Rivera", "jordan@example.com", "landlord_admin");
const adminUser = fullMessengerUser(70002, "Acme Property Management", "admin@example.com", "admin");

const jordanThread = {
  id: 88001,
  type: "private_sub_admin",
  last_message_id: 77,
  last_message: {
    id: 77,
    thread_id: 88001,
    body: `<b>Question about the unit:</b><br />${"x".repeat(250)}`,
    sender_name: null,
    system_type: null,
    is_read: true,
    first_seen_at: null,
    created_at: "2026-06-12T00:00:00.000Z",
    files: [],
    sender: null,
  },
  created_at: "2024-12-02T21:08:57.000Z",
  updated_at: "2026-06-12T00:00:00.000Z",
  participants: [messengerParticipant(1, jordanUser), messengerParticipant(2, adminUser)],
  client: null,
  meta: { is_never_read: false, unread_messages_count: 2 },
};

/** Routes fetch calls by URL substring to canned TenantCloud responses. */
function fakeTenantCloud(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("messenger/threads")) {
      if (url.includes("/messages")) {
        return jsonResponse({
          data: {
            id: 99,
            thread_id: 88001,
            body: "Hi Jordan",
            sender_name: null,
            system_type: null,
            is_read: false,
            first_seen_at: null,
            created_at: "2026-06-12T00:00:00.000Z",
            files: [],
            sender: messengerParticipant(2, adminUser),
          },
        });
      }
      const channel = new URL(url).searchParams.get("channel");
      const threads = channel === "admins" ? [jordanThread] : [];
      return jsonResponse({
        data: threads,
        pagination: { total: threads.length, current_page: 1, per_page: 50, last_page: 1 },
      });
    }
    if (/leads\/\d+\/thread/.test(url)) {
      // Bare thread object, the way /leads/{id}/thread really answers (not JSON:API).
      return jsonResponse({
        type: "leads",
        id: 555001,
        created_at: "2026-06-12T00:00:00.000000Z",
        updated_at: "2026-06-12T00:00:00.000000Z",
      });
    }
    if (url.includes("auth/user")) {
      return jsonResponse({ user: { id: 500, firstName: "Pat", lastName: "Lee", email: "pat@example.com" } });
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
  it("exposes the core, messaging, maintenance, financials, leasing, and generic tools", async () => {
    const client = await connectedClient();

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);

    // Original read tools
    for (const core of [
      "get_user_info",
      "list_contacts",
      "list_leases",
      "list_properties",
      "list_transactions",
      "list_units",
    ]) {
      expect(names).toContain(core);
    }

    // New critical-area tools (read + write)
    for (const added of [
      "list_threads",
      "find_threads",
      "send_message",
      "message_lead",
      "list_maintenance_requests",
      "create_maintenance_request",
      "resolve_maintenance_request",
      "create_transaction",
      "get_transaction_statistics",
      "get_lease",
      "list_applications",
      "list_leads",
      "tc_request",
    ]) {
      expect(names).toContain(added);
    }

    const resources = await client.listResources();
    const uris = resources.resources.map((r) => r.uri);
    expect(uris).toContain("tc://guide");
    expect(uris).toContain("tc://catalog");
  });

  it("list_threads returns slim threads without duplicated participant payloads", async () => {
    const client = await connectedClient();

    const result = await client.callTool({ name: "list_threads", arguments: { channel: "admins" } });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const payload = JSON.parse(text) as {
      count: number;
      data: Array<{
        unreadCount: number;
        participants: Array<{ id: number; name: string; email: string; role: string }>;
        lastMessage: { body: string };
      }>;
    };

    expect(payload.count).toBe(1);
    const thread = payload.data[0]!;
    expect(thread.unreadCount).toBe(2);
    expect(thread.participants).toEqual([
      {
        id: 70001,
        name: "Jordan Rivera",
        email: "jordan@example.com",
        role: "landlord_admin",
      },
      { id: 70002, name: "Acme Property Management", email: "admin@example.com", role: "admin" },
    ]);
    // HTML stripped and preview truncated; raw user bloat is gone entirely.
    expect(thread.lastMessage.body.startsWith("Question about the unit: xxx")).toBe(true);
    expect(thread.lastMessage.body.endsWith("...")).toBe(true);
    expect(thread.lastMessage.body.length).toBe(203);
    expect(text).not.toContain("fraud_status");
    expect(text).not.toContain("time_zone");
  });

  it("find_threads locates a thread by participant name across channels", async () => {
    const client = await connectedClient();

    const result = await client.callTool({ name: "find_threads", arguments: { query: "jordan" } });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const payload = JSON.parse(text) as {
      count: number;
      data: Array<{ id: number; channel: string }>;
    };

    expect(payload.count).toBe(1);
    expect(payload.data[0]!.id).toBe(88001);
    expect(payload.data[0]!.channel).toBe("admins");
  });

  it("find_threads matches by email within a single channel", async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: "find_threads",
      arguments: { query: "jordan@example.com", channel: "admins" },
    });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const payload = JSON.parse(text) as { count: number; data: Array<{ id: number }> };

    expect(payload.count).toBe(1);
    expect(payload.data[0]!.id).toBe(88001);
  });

  it("send_message returns a slim sender", async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: "send_message",
      arguments: { threadId: 88001, body: "Hi Jordan" },
    });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const payload = JSON.parse(text) as {
      sent: boolean;
      message: { body: string; sender: { id: number; name: string } };
    };

    expect(payload.sent).toBe(true);
    expect(payload.message.body).toBe("Hi Jordan");
    expect(payload.message.sender).toEqual({
      id: 70002,
      name: "Acme Property Management",
      email: "admin@example.com",
      role: "admin",
    });
    expect(text).not.toContain("fraud_status");
  });

  it("message_lead creates the lead's thread, then sends to it", async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: "message_lead",
      arguments: { leadId: 70555, body: "Hi Jordan" },
    });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const payload = JSON.parse(text) as {
      sent: boolean;
      threadId: number;
      message: { body: string };
    };

    expect(payload.sent).toBe(true);
    expect(payload.threadId).toBe(555001);
    expect(payload.message.body).toBe("Hi Jordan");
  });

  it("get_user_info returns the signed-in user", async () => {
    const client = await connectedClient();

    const result = await client.callTool({ name: "get_user_info", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    const user = JSON.parse(text) as { id: number; firstName: string };

    expect(user.id).toBe(500);
    expect(user.firstName).toBe("Pat");
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
