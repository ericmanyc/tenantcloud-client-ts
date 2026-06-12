# tc-mcp

MCP server that lets AI agents (Claude Desktop, Claude Code, Cursor, any MCP client) work with your [TenantCloud](https://tenantcloud.com) account: tenants, leases, rent, messaging, maintenance, and leads.

> **Not an official TenantCloud product.** Built on [`tenantcloud-client`](https://www.npmjs.com/package/tenantcloud-client), which uses TenantCloud's internal endpoints.

## Setup

```bash
npx tc-mcp login                 # browser-based sign-in; tokens go to the OS credential store
npx tc-mcp install claude-code   # or: claude-desktop
```

`install` registers the server in the right config file. For other MCP clients, configure a stdio server running `npx tc-mcp mcp`.

Not signed in yet (or tokens expired)? Tools fail with a clear "not signed in" message and the agent offers to open the sign-in window for you via the `tc_login` tool - so step 1 is optional; you can also just start asking questions and sign in when prompted.

Then ask your agent things like:

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

## CLI

```bash
tc-mcp mcp         # run the stdio MCP server (what your MCP client invokes)
tc-mcp login       # interactive browser sign-in, stores tokens securely
tc-mcp logout      # remove stored tokens
tc-mcp install claude-code|claude-desktop
```

## License

MIT. Part of [tenantcloud-client-ts](https://github.com/ericmanyc/tenantcloud-client-ts).
