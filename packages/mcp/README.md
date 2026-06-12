# tc-mcp

MCP server that lets AI agents (Claude Desktop, Claude Code, Cursor, any MCP client) work with your [TenantCloud](https://tenantcloud.com) account: tenants, leases, rent, messaging, maintenance, and leads.

> **Not an official TenantCloud product.** Built on [`tenantcloud-client`](https://www.npmjs.com/package/tenantcloud-client), which uses TenantCloud's internal endpoints.

## Setup

One command (needs Node 20+):

```bash
npx tc-mcp install claude-code   # or: claude-desktop
```

Then restart Claude Code (or Claude Desktop) and start asking questions. No separate sign-in step: when you are not signed in, the agent tells you and offers to open a TenantCloud sign-in window (normal password + 2FA flow); tokens are stored in your OS credential store, never in files. Prefer to sign in ahead of time? `npx tc-mcp login`.

For other MCP clients, configure a stdio server that runs `npx tc-mcp mcp`.

Ask your agent things like:

- "What is our outstanding rent balance, by property?"
- "Message the lead who inquired yesterday and ask about their move-in date"
- "Create a high-priority maintenance request for unit 3B"
- "Which leases expire in the next 60 days?"

## Tools

35 tools across six areas:

| Area | Tools |
|------|-------|
| Core reads | `get_user_info`, `list_contacts`, `list_properties`, `list_units`, `list_transactions`, `list_leases` |
| Messaging | `list_message_channels`, `list_threads`, `find_threads`, `list_messages`, `send_message`, `message_lead`, `mark_thread_read` |
| Maintenance | `list_maintenance_requests`, `get_maintenance_request`, `create_maintenance_request`, `update_maintenance_request`, `resolve_maintenance_request`, `list_inspections` |
| Financials | `get_transaction_statistics`, `create_transaction`, `update_transaction`, `delete_transaction`, `list_recurring_transactions`, `list_payments`, `list_reconciliation_accounts`, `owner_balances` |
| Leasing | `get_lease`, `update_lease`, `list_lease_notices`, `list_applications`, `list_screenings`, `list_leads`, `create_lead` |
| Escape hatch | `tc_request` - any of the ~1100 cataloged internal endpoints |
| Auth | `tc_login` - opens a browser sign-in window when the user is not signed in |

Plus resources: `tc://guide` (usage guide for agents), `tc://catalog` (endpoint catalog), `tc://property/{id}`, `tc://unit/{id}`, `tc://contact/{id}`.

Quality-of-life for agents: responses resolve foreign-key IDs to names via an entity cache, messenger payloads are slimmed to fit context windows, and `message_lead` handles first contact with a lead (creates their thread and sends in one step).

## Hosted server (Claude on web, teams)

`tc-mcp serve` runs a multi-user remote MCP server for claude.ai custom connectors: OAuth 2.1 with dynamic client registration (teammates sign in with email + admin-issued invite code), an AES-256-GCM-encrypted per-user TenantCloud token vault (Postgres), and one-time pairing via `tc-mcp login --remote <url>` so every person acts under their own TenantCloud account. Deployment guide: [docs/DEPLOY_RAILWAY.md](https://github.com/ericmanyc/tenantcloud-client-ts/blob/main/docs/DEPLOY_RAILWAY.md).

## CLI

```bash
tc-mcp mcp         # run the stdio MCP server (what your MCP client invokes)
tc-mcp login       # interactive browser sign-in, stores tokens securely
tc-mcp login --remote <url> --email <e> --code <c>   # pair with a hosted server
tc-mcp logout      # remove stored tokens
tc-mcp install claude-code|claude-desktop
tc-mcp serve       # run the hosted multi-user server (BASE_URL, TC_VAULT_KEY, TC_ADMIN_KEY, DATABASE_URL)
tc-mcp invite <email> --server <url>                 # admin: invite a teammate
```

## License

MIT. Part of [tenantcloud-client-ts](https://github.com/ericmanyc/tenantcloud-client-ts).
