import { describe, expect, it, vi } from "vitest";
import { StaticTokenProvider, type TcAuthTokenProvider } from "../src/auth.js";
import { TcClientError } from "../src/errors.js";
import { TcClient } from "../src/tcClient.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pageBody(ids: number[], total: number) {
  return {
    data: ids.map((id) => ({ type: "contacts", id: String(id), attributes: { name: `c${id}` } })),
    meta: { pagination: { total, count: ids.length, per_page: ids.length, current_page: 1, total_pages: 1 } },
  };
}

describe("TcClient", () => {
  it("sends bearer token and parses user info", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ user: { id: 7, firstName: "Pat", lastName: "Lee", email: "pat@example.com" } }),
    );
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const user = await client.getUserInfo();

    expect(user?.id).toBe(7);
    expect(user?.firstName).toBe("Pat");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tenantcloud.com/auth/user");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("paginates until the reported total is reached", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(pageBody([1, 2], 4)))
      .mockResolvedValueOnce(jsonResponse(pageBody([3, 4], 4)));
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const all = await client.contacts.getAll();

    expect(all.map((c) => c.id)).toEqual([1, 2, 3, 4]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toContain("contacts?page=1");
    expect(fetchMock.mock.calls[1]![0]).toContain("contacts?page=2");
  });

  it("applies chained filters to the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(pageBody([], 0)));
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    await client.transactions.forCategory("income").forTenant(42).getAll();

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("transactions?page=1");
    expect(url).toContain("&filter[category][]=income");
    expect(url).toContain("&filter[client_id]=42");
  });

  it("retries once with a new token on 401", async () => {
    let token = "old";
    const provider: TcAuthTokenProvider = {
      getToken: () => Promise.resolve(token),
      onTokenRejected: (rejected) => {
        if (rejected === token) {
          token = "new";
        }
        return Promise.resolve();
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 1 } }));
    const client = new TcClient(provider, { fetch: fetchMock });

    const user = await client.getUserInfo();

    expect(user?.id).toBe(1);
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe("Bearer new");
  });

  it("fails when the provider cannot supply a new token after 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "expired" }, 401));
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    await expect(client.getUserInfo()).rejects.toThrow(TcClientError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces server error messages with status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Server exploded" }, 500));
    const client = new TcClient(new StaticTokenProvider("tok"), { fetch: fetchMock });

    const error = await client.getUserInfo().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TcClientError);
    expect((error as TcClientError).httpStatus).toBe(500);
    expect((error as TcClientError).message).toBe("Server exploded");
  });
});
