import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TcClient } from "tenantcloud-client";
import type { EntityCache } from "../entityCache.js";
import { enrich } from "../entityEnricher.js";
import { compact, maxResultsParam, pageParam, toolError, toolSuccess } from "./helpers.js";

export function registerLeasingTools(server: McpServer, client: TcClient, cache: EntityCache): void {
  server.registerTool(
    "get_lease",
    {
      description: "Get a single lease by ID, including its full detail (rent, deposit, dates, settings).",
      inputSchema: { id: z.number().int().describe("Lease ID") },
    },
    async ({ id }) => {
      try {
        const lease = await client.leasing.getLease(id);
        return lease ? toolSuccess(lease) : toolError(`lease ${id} not found`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_lease_signing_status",
    {
      description:
        "Check whether a lease (or renewal) has been signed. Returns each roommate's signing state (signed / not_signed / not_required), who still needs to sign, and a plain-language summary. Signing lives on the lease's roommates, not the lease record, so prefer this over get_lease for 'is it signed?' questions. A future lease that still needs signatures is an unsigned renewal.",
      inputSchema: { leaseId: z.number().int().describe("Lease ID") },
    },
    async ({ leaseId }) => {
      try {
        const signing = await client.leasing.getLeaseSigning(leaseId);
        return signing ? toolSuccess(signing) : toolError(`lease ${leaseId} not found`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_lease",
    {
      description: "Update fields on an existing lease (e.g. rent amount, end date, name).",
      inputSchema: {
        id: z.number().int().describe("Lease ID"),
        name: z.string().optional(),
        amount: z.number().optional().describe("Monthly rent amount"),
        deposit: z.number().optional().describe("Security deposit"),
        rentFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        rentTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
      },
    },
    async ({ id, name, amount, deposit, rentFrom, rentTo }) => {
      try {
        const lease = await client.leasing.updateLease(
          id,
          compact({ name, amount, deposit, rent_from: rentFrom, rent_to: rentTo }),
        );
        return toolSuccess({ updated: true, lease });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_lease_notices",
    {
      description: "List notices (e.g. late rent, eviction, move-out) attached to a lease.",
      inputSchema: { leaseId: z.number().int().describe("Lease ID") },
    },
    async ({ leaseId }) => {
      try {
        const { items } = await client.leasing.listNotices(leaseId);
        return toolSuccess({ data: items, count: items.length });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_applications",
    {
      description: "List rental applications. Filter by property, unit, or status.",
      inputSchema: {
        propertyId: z.number().int().optional(),
        unitId: z.number().int().optional(),
        status: z.string().optional(),
        page: pageParam,
      },
    },
    async ({ propertyId, unitId, status, page }) => {
      try {
        const filters: Record<string, string | number> = {};
        if (propertyId !== undefined) filters.property_id = propertyId;
        if (unitId !== undefined) filters.unit_id = unitId;
        if (status !== undefined) filters.status = status;
        const { items, pagination } = await client.leasing.listApplications(filters, { page });
        const result = await enrich({ data: items, count: items.length }, cache);
        return toolSuccess({ ...result, pagination });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_screenings",
    {
      description: "List tenant screenings (background/credit checks).",
      inputSchema: { status: z.string().optional(), page: pageParam },
    },
    async ({ status, page }) => {
      try {
        const filters: Record<string, string | number> = {};
        if (status !== undefined) filters.status = status;
        const { items, pagination } = await client.leasing.listScreenings(filters, { page });
        return toolSuccess({ data: items, count: items.length, pagination });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_leads",
    {
      description:
        "List/find leads (prospective tenants who inquired about listings), most-recently-active first " +
        "so the live pipeline surfaces at the top. To find ONE specific lead, pass `search` (name or " +
        "email) - that is the reliable lookup. Filter by `type` (hot/warm/cold). `status` is filtered " +
        "client-side because the API ignores a server-side status filter. To scope leads to a UNIT or " +
        "PROPERTY, pass `unitId` and/or `propertyId` (or `listingIds` directly): a lead belongs to a " +
        "marketing listing, so the tool resolves the listing(s) for that unit/property and filters by " +
        "them - this is the only way to get 'leads for unit X'. `total` is the match count before " +
        "status filtering; `scanned` is how many rows were examined; `listingIds` echoes what was used.",
      inputSchema: {
        search: z.string().optional().describe("Find leads by name or email (substring match)"),
        type: z.string().optional().describe("Lead temperature: hot, warm, or cold"),
        status: z
          .string()
          .optional()
          .describe("Lead status, e.g. new, contacted, closed (filtered client-side)"),
        propertyId: z
          .number()
          .int()
          .optional()
          .describe("Scope to leads for this property (resolved to its listings)"),
        unitId: z
          .number()
          .int()
          .optional()
          .describe("Scope to leads for this unit (resolved to its listing(s))"),
        listingIds: z
          .array(z.number().int())
          .optional()
          .describe("Scope to leads for these marketing listing IDs directly"),
        sort: z
          .string()
          .optional()
          .describe('Sort field, default "-last_action_at" (most recent first); e.g. "last_action_at", "name"'),
        maxResults: maxResultsParam,
      },
    },
    async ({ search, type, status, propertyId, unitId, listingIds, sort, maxResults }) => {
      try {
        const ids = new Set<number>(listingIds ?? []);
        if (propertyId !== undefined || unitId !== undefined) {
          const resolved = await client.leasing.resolveListingIds({ propertyId, unitId });
          for (const id of resolved) ids.add(id);
          if (resolved.length === 0) {
            return toolSuccess({
              data: [],
              count: 0,
              total: 0,
              listingIds: [],
              note: "No marketing listings found for that property/unit, so there are no leads to scope to it.",
            });
          }
        }
        const scopeIds = [...ids];
        const { items, total, scanned } = await client.leasing.listLeadsAll(maxResults ?? 50, {
          search,
          type,
          status,
          sort,
          listingIds: scopeIds.length > 0 ? scopeIds : undefined,
        });
        return toolSuccess({
          data: items,
          count: items.length,
          scanned,
          total,
          ...(scopeIds.length > 0 ? { listingIds: scopeIds } : {}),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_lead",
    {
      description: "Create a new lead (prospective tenant).",
      inputSchema: {
        name: z.string().describe("Lead name"),
        email: z.string().optional(),
        phone: z.string().optional(),
        source: z.string().optional().describe("Where the lead came from"),
      },
    },
    async ({ name, email, phone, source }) => {
      try {
        const lead = await client.leasing.createLead(compact({ name, email, phone, source }));
        return toolSuccess({ created: true, lead });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_lead_status",
    {
      description:
        "Move a lead through its pipeline by setting its status. Known values: 'new', 'working', " +
        "'closed' (other values may exist in this account). Use the lead's id from list_leads.",
      inputSchema: {
        leadId: z.number().int().describe("Lead ID (from list_leads)"),
        status: z.string().describe("New status, e.g. new, working, closed"),
      },
    },
    async ({ leadId, status }) => {
      try {
        const lead = await client.leasing.updateLeadStatus(leadId, status);
        if (!lead) return toolError(`could not update status for lead ${leadId}`);
        return toolSuccess({ updated: true, lead });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
