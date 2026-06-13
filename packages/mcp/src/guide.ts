export const GUIDE = `# TenantCloud Tool Usage Guide

## Output Presentation - CRITICAL

You MUST present **human-readable names** to the user, never raw numeric IDs.

Tool responses that contain foreign-key IDs (\`propertyId\`, \`unitId\`, \`tenantId\`,
\`payerId\`) automatically include a \`references\` section at the end of the JSON with
resolved names:

\`\`\`json
{
  "data": [ ... ],
  "count": 5,
  "references": {
    "properties": { "6587": "742 Evergreen Terrace" },
    "units": { "11899": "Chambre 3 (742 Evergreen Terrace)" },
    "contacts": { "3099201": "John Smith" }
  }
}
\`\`\`

Use the \`references\` table to replace IDs with names when presenting results to the user.
For detailed entity information, read the MCP resources:
- \`tc://property/{id}\` - full property details
- \`tc://unit/{id}\` - full unit details (includes parent property name)
- \`tc://contact/{id}\` - full contact details

When a reference is missing (entity not found in cache), resolve it by calling
the corresponding list tool (\`list_properties\`, \`list_units\`, \`list_contacts\`).

## Authentication

If any tool fails with HTTP 401 or "No auth token available", the user is not signed in
to TenantCloud. Do NOT keep retrying. Instead:

1. Tell the user they are not signed in and that a browser sign-in window can be opened.
2. Once they agree, call \`tc_login\` - it opens a browser window and waits (up to several
   minutes) while they sign in, then reports who is signed in.
3. Retry the original request.

If \`tc_login\` is unavailable or fails (no Chromium found, window closed, timeout), ask the
user to run \`tc-mcp login\` in a terminal, then retry.

## Entities

### UserInfo
Current signed-in user profile.
- \`id\` (number) - User ID
- \`email\` (string) - Email address
- \`firstName\`, \`lastName\` (string) - Name
- \`company\` (string) - Company name
- \`phone\` (string) - Phone number
- \`address1\`, \`address2\`, \`city\`, \`state\`, \`zip\` (string) - Address

### Contact
A tenant, professional, or other contact.
- \`id\` (number) - Contact ID
- \`name\`, \`firstName\`, \`lastName\` (string) - Name
- \`email1\`, \`email2\`, \`email3\` (string) - Up to 3 email addresses
- \`phone1\`, \`phone2\`, \`phone3\` (string) - Up to 3 phone numbers

### Property
A rental property.
- \`id\` (number) - Property ID
- \`name\` (string) - Property name
- \`address1\` (string) - Street address
- \`cityAddress\` (string) - City and state
- \`status\` (string) - Property status

### Unit
A rental unit within a property.
- \`id\` (number) - Unit ID
- \`propertyId\` (number) - Parent property ID
- \`name\` (string) - Unit name
- \`description\` (string?) - Description
- \`price\` (number) - Rent price
- \`isRented\` (boolean) - Currently occupied
- \`isPetAllowed\` (boolean) - Pets allowed
- \`isFurnished\` (boolean) - Furnished
- \`isUtilities\` (boolean) - Utilities included

### Transaction
A financial transaction (rent, expense, etc.).
- \`id\` (number) - Transaction ID
- \`unitId\` (number?) - Associated unit
- \`propertyId\` (number?) - Associated property
- \`payerId\` (number?) - Payer contact ID (see \`references.contacts\`)
- \`detail\` (string?) - Description
- \`amount\` (number) - Total amount
- \`paid\` (number) - Amount paid
- \`balance\` (number) - Remaining balance
- \`currency\` (string) - Currency code
- \`dueDate\` (date) - Due date
- \`paidAt\` (date?) - Payment date
- \`category\` (string) - income, expense, refund, credits, liability
- \`status\` (string) - due, paid, partial, pending, void, with_balance, overdue, waive
- \`isRecurring\` (boolean) - Recurring transaction

### Lease
A lease agreement.
- \`id\` (number) - Lease ID
- \`name\` (string?) - Lease name
- \`unitId\` (number) - Associated unit
- \`tenantId\` (number?) - Tenant contact ID (see \`references.contacts\`)
- \`startDate\` (date) - Start date
- \`endDate\` (date?) - End date (null = month-to-month)
- \`moveOutDate\` (date?) - Actual move-out date (null if still active)
- \`status\` (string) - active, archived, ended, expired, future, pending, etc.

## Tool Filters - CRITICAL

You MUST use server-side filters whenever the user's question targets a specific
property, unit, tenant, or status. **NEVER fetch all data and filter client-side**
when a filter parameter exists for the criterion. Server-side filtering is faster,
returns less data, and avoids hitting pagination limits.

For example, if the user asks about a specific unit:
1. Resolve the unit ID (see ID Resolution below)
2. Pass \`unitId\` to \`list_leases\` and \`list_transactions\` - do NOT call these
   tools without filters and then search through the results yourself.

### list_contacts
- \`role\` (string?) - Filter by role: \`tenant\`, \`professional\`, \`moved_in\`, \`archived\`
- \`maxResults\` (number?) - Max results to return (default 100)

### list_properties
- \`maxResults\` (number?) - Max results to return (default 100)

### list_units
- \`propertyId\` (number?) - Filter by property ID
- \`occupancy\` (string?) - Filter by occupancy: \`occupied\`, \`vacant\`
- \`maxResults\` (number?) - Max results to return (default 100)

### list_transactions
- \`tenantId\` (number?) - Filter by tenant/contact ID
- \`propertyId\` (number?) - Filter by property ID
- \`unitId\` (number?) - Filter by unit ID
- \`status\` (string?) - Filter by status: \`due\`, \`paid\`, \`partial\`, \`pending\`, \`void\`, \`with_balance\`, \`overdue\`, \`waive\`
- \`category\` (string?) - Filter by category: \`income\`, \`expense\`, \`refund\`, \`credits\`, \`liability\`
- \`maxResults\` (number?) - Max results to return (default 100)

### list_leases
- \`propertyId\` (number?) - Filter by property ID
- \`unitId\` (number?) - Filter by unit ID
- \`status\` (string?) - Filter by status: \`active\`
- \`maxResults\` (number?) - Max results to return (default 100)

## ID Resolution - IMPORTANT

Users refer to entities by **name**, not by ID. All filter parameters that accept an ID
(propertyId, unitId, tenantId) require a numeric ID. You must resolve names to IDs first.

### Resolution patterns

**Property by name/address** -> call \`list_properties\`, then match by \`name\` or \`address1\` fields.
**Unit by name** -> call \`list_units\` (optionally filtered by propertyId), then match by \`name\`.
**Tenant by name** -> call \`list_contacts\` with role=tenant, then match by \`name\`, \`firstName\`, or \`lastName\`.

### Multi-step example

User asks: "List active leases for my property on Evergreen Terrace"
1. Call \`list_properties\` -> find the property where \`address1\` or \`name\` contains "Evergreen Terrace" -> get its \`id\`
2. Call \`list_leases\` with \`propertyId=<resolved id>\` and \`status=active\`

User asks: "Show transactions for John Smith"
1. Call \`list_contacts\` with \`role=tenant\` -> find contact where \`name\` contains "John Smith" -> get its \`id\`
2. Call \`list_transactions\` with \`tenantId=<resolved id>\`

User asks: "Which tenants are in unit 3B at Maple Heights?"
1. Call \`list_properties\` -> find "Maple Heights" -> get its \`id\`
2. Call \`list_units\` with \`propertyId=<property id>\` -> find "3B" -> get its \`id\`
3. Call \`list_leases\` with \`unitId=<unit id>\` and \`status=active\` -> get tenant info from lease names

Always resolve in order: property -> unit -> tenant/lease/transaction.
When the match is ambiguous, present the candidates and ask the user to clarify.

## Typical Questions

Always resolve names to IDs first, then use the appropriate filters.

- "Who are my tenants?" -> \`list_contacts\` with \`role=tenant\`
- "What properties do I have?" -> \`list_properties\`
- "Which units are vacant?" -> \`list_units\` with \`occupancy=vacant\`
- "Which units are vacant at [property]?" -> resolve property -> \`list_units\` with \`propertyId\` + \`occupancy=vacant\`
- "What is the rent balance for property X?" -> resolve property -> \`list_transactions\` with \`propertyId\` + \`status=with_balance\`
- "Show me active leases for [address]" -> resolve property -> \`list_leases\` with \`propertyId\` + \`status=active\`
- "Show transactions for [tenant name]" -> resolve contact -> \`list_transactions\` with \`tenantId\`
- "Show overdue rent for unit 3B at [property]" -> resolve property -> resolve unit -> \`list_transactions\` with \`unitId\` + \`status=overdue\` + \`category=income\`
- "What leases are on unit [name]?" -> resolve unit -> \`list_leases\` with \`unitId\`
- "Show all expenses for [property]" -> resolve property -> \`list_transactions\` with \`propertyId\` + \`category=expense\`
- "Who am I logged in as?" -> \`get_user_info\`

## Messaging, Maintenance, Financials, Leasing

Beyond the read tools above, these write-capable tools cover the core workflows.
Resolve names to IDs first (same patterns as above) before calling them.

### Messaging (Messenger)
- \`find_threads\` (\`query\`, \`channel\`?) - locate threads by participant name/email across channels
- \`list_message_channels\` - channels and unread flags
- \`list_threads\` (\`channel\`: tenant, owner, professional, client, leads, maintenance_requests, ...) - conversations
- \`list_messages\` (\`threadId\`) - messages in a thread
- \`send_message\` (\`threadId\`, \`body\`) - **delivers to the other participant; confirm intent first**
- \`message_lead\` (\`leadId\`, \`body\`) - message a lead, creating their thread if none exists yet
- \`mark_thread_read\` (\`threadId\`)

**Messaging a person by name** -> call \`find_threads\` with their name -> use the matched
thread's \`id\` with \`send_message\`. Do NOT page through \`list_threads\` manually.
Team members/sub-admins are not in \`list_contacts\`; their threads are in the \`admins\`
channel. Prospective tenants are in the \`leads\` channel.

**Messaging a lead (first contact)** -> a lead who has never been messaged has NO thread,
so \`find_threads\` returns nothing for them. Resolve the lead via \`list_leads\` -> call
\`message_lead\` with the lead's \`id\`; it creates the thread and sends in one step.

### Maintenance
- \`list_maintenance_requests\` (filters: \`propertyId\`, \`clientId\`, \`status\`, \`priority\`, \`assigneeId\`)
- \`get_maintenance_request\` (\`id\`)
- \`create_maintenance_request\` (\`title\`, \`text\`, \`propertyId\`, \`priority\`, ...)
- \`update_maintenance_request\` (\`id\`, ...) / \`resolve_maintenance_request\` (\`id\`)
- \`add_maintenance_material\` (\`requestId\`, \`name\`, \`cost\`)
- \`list_inspections\`

### Financials
- \`get_transaction_statistics\` (filters) - income/expense/balance aggregates
- \`create_transaction\` / \`update_transaction\` / \`delete_transaction\` - charges and expenses
- \`record_payment\` (\`amount\`, \`clientId\`, \`transactionId\`) - record a payment received
- \`create_recurring_transaction\` - schedule a recurring rent charge or expense
- \`list_recurring_transactions\`, \`list_payments\` (filter by \`clientId\`/\`propertyId\`)
- \`list_reconciliation_accounts\`, \`owner_balances\`, \`list_owner_agreements\`

### Leasing
- \`get_lease\` (\`id\`) / \`update_lease\` (\`id\`, rent/dates) / \`create_lease\` (\`unitId\`, \`tenantId\`, rent)
- \`add_lease_roommate\` (\`leaseId\`, name) / \`create_lease_notice\` (\`leaseId\`, \`type\`, \`text\`)
- \`list_lease_notices\` (\`leaseId\`)
- \`list_applications\` / \`create_application\` / \`submit_application\` (\`id\`)
- \`list_screenings\` / \`create_screening\` (may incur a fee) / \`cancel_screening\`
- \`list_leads\`, \`create_lead\`

### Productivity, Documents & Contacts
- \`list_tasks\`, \`create_task\` (\`title\`, \`remindDate\` required), \`complete_task\`, \`delete_task\`
- \`list_calendar_events\` (date range); \`list_notes\` / \`create_note\` (entity-scoped: \`noteableType\` + \`noteableId\`)
- \`list_files\`, \`get_file\` (returns a download URL)
- \`create_contact\` / \`update_contact\` / \`invite_contact\` (sends a portal invite - confirm first)
- \`list_contact_insurances\`

### Portfolio (Keys & Locks, Equipment)
- \`list_property_keys\` (\`propertyId\`) - the actual door/lockbox codes usually live in each key's \`comment\` field
- \`create_property_key\` (\`propertyId\`, \`keyname\`; optional \`comment\`, \`type\`), \`update_property_key\`, \`delete_property_key\`
- \`list_equipment\` (\`propertyId\` / \`unitId\` / \`categoryId\`) - appliances, HVAC, water heaters, meters
- \`create_equipment\` (\`propertyId\`; optional \`unitId\`, \`make\`, \`modelNumber\`, \`vinNumber\`, \`price\`, install/warranty dates), \`update_equipment\`, \`delete_equipment\`

### Anything else: \`tc_request\`
For any endpoint without a dedicated tool, use \`tc_request\` (\`method\`, \`path\`, \`query\`, \`body\`).
Read the \`tc://catalog\` resource for the full list of endpoint paths and JSON:API resource
types. Most resources are JSON:API: create with \`POST\` and body
\`{ "data": { "type": "<type>", "attributes": { ... } } }\`; update with \`PATCH /<endpoint>/<id>\`.
`;
