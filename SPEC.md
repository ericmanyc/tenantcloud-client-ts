# tenantcloud-client-ts

TypeScript port of [yllibed/TenantCloudClient](https://github.com/yllibed/TenantCloudClient) (C#/.NET), an unofficial toolkit for TenantCloud (rental property management). TenantCloud has no public API; this works against their internal endpoints using tokens borrowed from a browser session.

Intended for further development beyond parity.

## Decisions (made 2026-06-12)

- Monorepo with npm workspaces, two packages:
  - `packages/client` - `tenantcloud-client`: API client, token stores, CDP auth (subpath export `tenantcloud-client/cdp` conceptually; all in one package)
  - `packages/mcp` - `tc-mcp`: MCP server + CLI (`mcp`, `login`, `logout`, `install`)
- Ecosystem libraries for platform parts: `chrome-remote-interface` (CDP), `@napi-rs/keyring` (OS credential store)
- Full parity with the C# version first; new features after
- Local git repo only; GitHub remote later.
- Node >= 20, ESM, TypeScript strict, vitest for tests, tsc for build (no bundler)
- TS-native types: `number` ids, `Date` dates, string-union statuses (the C# numeric enum codes are normalized to strings during parsing)

## Ground truth: TenantCloud internal API (from the C# source)

- Base URL: `https://api.tenantcloud.com/`
- Auth: `Authorization: Bearer <jwt access_token>`. On 401: notify provider (refresh), retry once with new token; fail if token unchanged.
- `GET auth/user` returns `{ user: {...} }` (PascalCase-insensitive parsing required)
- Entity list endpoints (JSON:API-ish): `GET {contacts|properties|units|transactions|leases}?page=N` + filters
  - Response: `{ data: [{ type, id, attributes }], meta: { pagination: { total, count, per_page, current_page, total_pages } } }`
  - `id` may be number or string; attributes get `id` injected from the wrapper
- Filters (query string):
  - contacts: `filter[roles][]=tenant`, `filter[roles][]=professional`, `filter[tenant_contact_type]=moved_in`, `filter[status]=archived`
  - units: `filter[is_rented]=true|false`, `filter[property_id][]=N`
  - leases: `filter[lease_status][]=active`, `filter[property_id][]=N`, `filter[unit_id]=N`
  - transactions: `filter[client_id]=N` (tenant), `filter[property_id][]=N`, `filter[unit_id]=N`, `filter[status]=<str>`, `filter[category][]=<str>`, `sort=-date,-id`
- Token refresh: `POST {api}/auth/token` with `Authorization: Bearer <old access_token>`, `X-Requested-With: XMLHttpRequest`, JSON body `{ grant_type: "refresh_token", fingerprint, refresh_token }` -> `{ access_token, refresh_token, ... }` (fingerprint is kept from before)
- Browser token extraction (CDP on `app.tenantcloud.com` tab):
  - `access_token`, `fingerprint`: `JSON.parse(localStorage.getItem('...'))` via Runtime.evaluate
  - refresh token: cookie `tc_refresh_token` via Network.getCookies for api+app URLs
- Interactive login: launch Chromium `--remote-debugging-port=<random 10000-60000> --app=https://app.tenantcloud.com/login --user-data-dir=<temp> --no-first-run --disable-extensions`; poll every 1.5s (5 min timeout) until `window.location.href` no longer contains `/login` or `/two_factor`, then extract tokens; kill browser + delete temp profile
- JWT expiry: decode payload `exp` claim without verification; treat as expired if < now + 60s
- Data quirks: ids sometimes strings; `date`/`paid_at` are `M/d/yyyy` or `yyyy-MM-dd` or ISO datetime; lease/transaction status may be numeric code or string name
  - Lease status codes: active=0, future=1, expired=2, ended=4, pending=9, not_active=10, archived=11, insurance_pending=12, expires_in=13
  - Transaction status codes: due=0, paid=1, partial=2, pending=3, void=9, with_balance=10, overdue=11, waive=12
  - Transaction categories: income, expense, refund, credits, liability

## Architecture (TS)

### packages/client
- `json.ts` - parse helpers: toNumber (number|string), parseTcDate, status/category code+string normalizers
- `models.ts` - TcUserInfo, TcContact (validEmails/validPhones helpers), TcProperty (address), TcUnit, TcTransaction, TcLease (isActive/isFuture/isPast helpers), per-entity `parseX(raw)` normalizers
- `paginatedSource.ts` - `PaginatedSource<T>`: `getPage(page)`, `getAll(maxResults=300)` (fetch pages until total reached or count > maxResults; mirrors C# semantics), `withExtraUrl()` projection; filter builders per entity (e.g. `client.contacts.onlyTenants().getAll()`)
- `tcClient.ts` - fetch-based client, 401-retry-once logic, TcClientError with httpStatus
- `auth.ts` - TcTokenSet, TokenProvider/TokenStore interfaces, StaticTokenProvider
- `store/fileTokenStore.ts` - JSON file, atomic write (tmp+rename)
- `store/secureTokenStore.ts` - @napi-rs/keyring; service "Yllibed.TenantCloudClient"-equivalent default: service `tenantcloud-client`, account `default`
- `cdp/` - jwt.ts (expiry), refresher.ts (auth/token), browser.ts (target discovery via CDP /json + chromiumFinder), cdpTokenProvider.ts (cache -> store(+refresh) -> CDP extract -> interactive login)

### packages/mcp
- CLI: `tc-mcp mcp|login|logout|install claude-desktop|install claude-code`
- MCP server (stdio, @modelcontextprotocol/sdk): tools get_user_info, list_contacts, list_properties, list_units, list_transactions, list_leases; resources tc://guide, tc://property/{id}, tc://unit/{id}, tc://contact/{id}
- entityCache.ts (5-min TTL id->entity maps incl. signed-in user as contact), entityEnricher.ts (appends `references` section mapping property/unit/contact ids to names)
- Logs to stderr only (stdout reserved for JSON-RPC)

## Testing

- Unit tests (vitest): JSON parsing quirks (ported from Given_JsonConverters + extended), paginated source against a mocked fetch, 401-retry logic, enricher
- Integration tests: gated on `TC_AUTH_TOKEN` env var (skip otherwise), mirror Given_TcClient

## Full API surface (discovered 2026-06-12 from the SPA bundle)

The app is an esbuild ESM SPA: `https://cdn.tenantcloud.net/builds/v<ver>/web/main.js` +
~1800 `chunk-*.js` modules. Crawling the import graph and extracting endpoint string
constants (`ENDPOINT="..."`, named constants like `THREADS=`, and template paths) yields the
full catalog: **~1100 endpoint paths, 108 JSON:API resource types**. Saved to
`docs/api-catalog.txt`; a curated grouped version is embedded as `packages/mcp/src/catalog.ts`
and exposed as the `tc://catalog` MCP resource. Re-run discovery with `/tmp/tc-discovery`
(`crawl.mjs` downloads chunks, `extract.mjs` builds the catalog).

Two response envelopes:
- **JSON:API** (most resources): `{ data: [{ type, id, attributes }], meta: { pagination } }`;
  single: `{ data: { ... } }`; writes: `POST {endpoint}` / `PATCH {endpoint}/{id}` with body
  `{ data: { type, id?, attributes } }`; `DELETE {endpoint}/{id}` -> 204.
- **Laravel paginator** (`/messenger/*`): `{ data: [...plain...], pagination: { current_page,
  last_page, per_page, total, ... } }`; plain request bodies (send message = `{ body }`).

Write auth verified live: `POST /tasks` 201, `PATCH` 200, `DELETE` 204 with `Authorization:
Bearer` + `X-Requested-With: XMLHttpRequest`.

### Critical areas (endpoint -> client/tool)
- **Messaging** `/messenger/{channels,threads,threads/{id}/messages,...}` -> `client.messaging`
  (MessengerClient); tools find_threads/list_threads/list_messages/send_message/message_lead/
  mark_thread_read. A lead has no thread until first contact: `GET /leads/{id}/thread` 404s,
  `POST /leads/{id}/thread` creates it and answers with a bare (non-JSON:API) thread object
  (verified live 2026-06-12). `client.leasing.openLeadThread()` wraps this (POST, GET fallback);
  the message_lead tool composes it with sendMessage for one-step first contact.
  The MCP layer slims thread/message payloads (participants deduped to id/name/email/role,
  lastMessage HTML-stripped + truncated): raw API threads are ~2.6k chars each, which blew the
  tool-result token limit at 50/page. Team members/sub-admins are not contacts; their threads
  live in the `admins` channel (find_threads sweeps channels by participant name/email).
- **Financials** `/transactions(+/{id},/statistics,/recurrings,/payments,/accounts)`,
  `/reconciliation/*`, `/reports/transactions/*`, `/owner/statistics/balances` ->
  `client.financials`; tools create/update/delete_transaction, get_transaction_statistics, etc.
- **Maintenance** `/maintenance_requests(+/{id},/resolve,/materials,/recurring)`,
  `/inspections/*` -> `client.maintenance`; tools list/get/create/update/resolve.
- **Leasing** `/leases(+/{id},/roommates,/{id}/notices)`, `/applications`, `/screenings`,
  `/leads`, `/renter_profiles/*` -> `client.leasing`; tools get_lease/update_lease/list_*.

### Architecture additions (packages/client/src/resources/)
- `jsonApi.ts` - HttpMethod/RequestOptions/TcHttp, normalize + parse helpers for both
  envelopes, `jsonApiBody()`, `withQuery()`, generic `JsonApiResourceClient` (list/get/CRUD).
- `messaging.ts`, `maintenance.ts`, `financials.ts`, `leasing.ts` - typed sub-clients + parsers.
- `tcClient.ts` - refactored: public `request(method, path, opts)` with all verbs + 401 retry,
  `resource(endpoint, type)` generic accessor, sub-clients on `client.{messaging,maintenance,
  financials,leasing}`. 204/empty bodies handled.
- mcp `tools/` modules + `tc_request` escape hatch + `tc://catalog` resource.

## Status

- [x] Repo scaffold; json helpers + models; paginated source + TcClient
- [x] client: token stores + static provider; CDP auth
- [x] mcp: server + CLI login/logout/install; cache/enricher
- [x] **Discovery: full API catalog (docs/api-catalog.txt, 1100 paths / 108 types)**
- [x] **client: all HTTP verbs + generic JSON:API CRUD + Messaging/Maintenance/Financials/Leasing**
- [x] **mcp: 59 tools across all areas + tc_request + tc://catalog**
- [x] **messaging: find_threads, message_lead (thread-create+send), thread/participant slimming**
- [x] **breadth: tasks/calendar/notes (client.productivity), files (client.files),
      contact writes type=`userClient` (client.crm), owner agreements (financials)**
- [x] **exposed existing writes as tools: create_lease, record_payment, create/submit_application,
      create/cancel_screening, add_lease_roommate, create_lease_notice, add_maintenance_material**
- [x] tests green (63), build green; write path verified live (tasks 201/200/204)
- [x] adversarial multi-agent correctness review of the new surface
- [ ] live end-to-end MCP run against real session for the new tools
- [ ] notes/documents are entity-scoped (need parent filters); reachable via tc_request
- [ ] remaining breadth: listings (user-owned), payments/stripe-connect, inspections records,
      renter-profile tools, property sub-resources (keys/equipment/specs)
- [ ] npm publish (later, when user decides)

### Resource-type cheatsheet (confirmed live, for JSON:API writes)
contacts=`userClient` (camelCase attrs), leases=`leases`, transaction=`transaction`,
transaction_payment=`transaction_payment`, transactions_recurring=`transactions_recurring`,
maintenance_request=`maintenance_request`, task=`task`, note=`note`, calendar_event=`calendar_event`,
file=`file`, contact_insurance=`contact_insurance`, lease_roommate=`lease_roommate`, notice=`notice`,
application=`application`, screening=`screening`, lead=`lead`, owner_agreement=`owner_agreement`.
