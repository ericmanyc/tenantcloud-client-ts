import { describe, expect, it } from "vitest";
import { StaticTokenProvider } from "../src/auth.js";
import { TcClient } from "../src/tcClient.js";

/**
 * Live integration tests against the real TenantCloud API, ported from the
 * C# Given_TcClient suite. Skipped unless TC_AUTH_TOKEN is set.
 */
const token = process.env["TC_AUTH_TOKEN"];

describe.skipIf(!token)("TcClient (live API)", () => {
  const client = () => new TcClient(new StaticTokenProvider(token!));

  function uniqueIds(items: Array<{ id: number }>): void {
    const ids = items.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  }

  it("gets user info", async () => {
    const user = await client().getUserInfo();
    expect(user).not.toBeNull();
    expect(user!.id).not.toBe(0);
    expect(user!.firstName).toBeTruthy();
  });

  it("gets all contacts", async () => {
    const all = await client().contacts.getAll();
    expect(all.length).toBeGreaterThan(0);
    uniqueIds(all);
  });

  it("gets moved-in contacts", async () => {
    const all = await client().contacts.onlyMovedIn().getAll();
    uniqueIds(all);
  });

  it("gets properties", async () => {
    const all = await client().properties.getAll();
    expect(all.length).toBeGreaterThan(0);
    uniqueIds(all);
  });

  it("gets units", async () => {
    const all = await client().units.getAll();
    expect(all.length).toBeGreaterThan(0);
    uniqueIds(all);
  });

  it("gets income transactions for the first tenant", async () => {
    const c = client();
    const contacts = await c.contacts.onlyMovedIn().getAll(1);
    const tenantId = contacts[0]!.id;

    const all = await c.transactions.forCategory("income").forTenant(tenantId).getAll();
    uniqueIds(all);
  });

  it("gets expense transactions", async () => {
    const all = await client().transactions.forCategory("expense").getAll();
    uniqueIds(all);
  });

  it("gets leases and active leases", async () => {
    const c = client();
    const all = await c.leases.getAll();
    expect(all.length).toBeGreaterThan(0);
    uniqueIds(all);

    const active = await c.leases.onlyActive().getAll();
    uniqueIds(active);
  });
});
