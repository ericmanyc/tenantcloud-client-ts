# tenantcloud-client

Unofficial TypeScript client for [TenantCloud](https://tenantcloud.com) (rental property management).

> **Not an official TenantCloud product.** TenantCloud has no public API; this library works against their internal endpoints (the same ones the web app calls) and can break whenever TenantCloud changes their frontend.

## Install

```bash
npm install tenantcloud-client
```

Node >= 20, ESM only.

## Usage

```ts
import { TcClient, SecureTokenStore } from "tenantcloud-client";
import { CdpTokenProvider } from "tenantcloud-client/cdp";

const provider = new CdpTokenProvider({
  tokenStore: new SecureTokenStore(),   // OS credential store; FileTokenStore also available
  allowInteractiveLogin: true,          // opens a browser window if no token can be found
});
const tc = new TcClient(provider);
```

### Entity reads with fluent filters

```ts
const user = await tc.getUserInfo();
const tenants = await tc.contacts.onlyTenants().getAll();
const vacant = await tc.units.onlyVacant().getAll();
const overdue = await tc.transactions.forCategory("income").forStatus("with_balance").getAll();
const leases = await tc.leases.onlyActive().forProperty(propertyId).getAll();
```

### Typed sub-clients

```ts
// Messaging (the in-app Messenger)
const { items: threads } = await tc.messaging.threads("tenant");
await tc.messaging.sendMessage(threads[0].id, "Hi!");

// First contact with a lead: creates their thread if none exists
const thread = await tc.leasing.openLeadThread(leadId);
await tc.messaging.sendMessage(thread!.id, "Thanks for your interest!");

// Maintenance
await tc.maintenance.create({ title: "Leaky faucet", property_id: 123, priority: "high" });

// Financials
const stats = await tc.financials.statistics({ property_id: 123 });
```

### Anything else

Most TenantCloud resources are JSON:API; a generic CRUD accessor covers endpoints without a dedicated sub-client:

```ts
const tasks = tc.resource("/tasks", "task");
await tasks.create({ title: "Call plumber" });
await tasks.update(taskId, { title: "Call electrician" });

// Or raw requests with auth and 401-refresh-retry handled for you
const payload = await tc.request("GET", "/landlord/statistics/rent_outstanding");
```

## Authentication

TenantCloud has no OAuth or API keys. `CdpTokenProvider` resolves tokens in order: valid in-memory token, token store (refreshing if expired), a running Chromium's `app.tenantcloud.com` tab via the DevTools protocol, and finally an interactive login window. You can also supply a raw JWT with `StaticTokenProvider` for testing.

## Documentation

Part of [tenantcloud-client-ts](https://github.com/ericmanyc/tenantcloud-client-ts); see the repo for the MCP server (`tc-mcp`), design notes, and the discovered API catalog (~1100 endpoints).

## License

MIT. Port of [yllibed/TenantCloudClient](https://github.com/yllibed/TenantCloudClient) (C#), copyright Carl de Billy, MIT.
