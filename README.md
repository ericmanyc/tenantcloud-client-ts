# tenantcloud-client-ts

TypeScript port of [yllibed/TenantCloudClient](https://github.com/yllibed/TenantCloudClient): an unofficial toolkit for [TenantCloud](https://tenantcloud.com), a rental property management platform.

> **This is not an official TenantCloud product.** TenantCloud does not provide a public API; this library works against their internal endpoints and can break whenever TenantCloud changes their frontend.

## Packages

| Package | Description |
|---------|-------------|
| [`packages/client`](packages/client) (`tenantcloud-client`) | API client, paginated sources with fluent filters, token store abstractions (OS credential store via `@napi-rs/keyring`, file store), CDP token provider (`tenantcloud-client/cdp`) |
| [`packages/mcp`](packages/mcp) (`tc-mcp`) | MCP server (stdio) exposing TenantCloud data to AI agents, plus `login`/`logout`/`install` CLI |

## Quick start

### Client library

```ts
import { TcClient, SecureTokenStore } from "tenantcloud-client";
import { CdpTokenProvider } from "tenantcloud-client/cdp";

const provider = new CdpTokenProvider({
  tokenStore: new SecureTokenStore(),
  allowInteractiveLogin: true,
});
const tc = new TcClient(provider);

const user = await tc.getUserInfo();
const tenants = await tc.contacts.onlyTenants().getAll();
const balances = await tc.transactions.forCategory("income").forStatus("with_balance").getAll();
```

### MCP server

```bash
npm run build
node packages/mcp/dist/cli.js login                 # browser-based sign-in, tokens go to the OS credential store
node packages/mcp/dist/cli.js install claude-code   # register with Claude Code
node packages/mcp/dist/cli.js install claude-desktop
```

Tools: `get_user_info`, `list_contacts`, `list_properties`, `list_units`, `list_transactions`, `list_leases`. Resources: `tc://guide`, `tc://property/{id}`, `tc://unit/{id}`, `tc://contact/{id}`.

## How authentication works

TenantCloud has no OAuth or API keys. The CDP token provider:

1. Returns the in-memory token if its JWT is still valid
2. Loads from the token store, refreshing via `POST /auth/token` if expired
3. Connects to a running Chromium browser (debug port 9222) and extracts `access_token`/`fingerprint` from localStorage and the `tc_refresh_token` cookie of an `app.tenantcloud.com` tab
4. If allowed, launches a temporary browser window for interactive login and polls until you finish signing in

## Development

```bash
npm install
npm run build      # tsc --build for both packages
npm test           # vitest (unit + MCP in-memory transport tests)
TC_AUTH_TOKEN=<jwt> npm test   # also runs live API integration tests
```

See [SPEC.md](SPEC.md) for the design decisions and the documented internal API surface.

## License

MIT
