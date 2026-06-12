import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TcClient } from "tenantcloud-client";
import type { EntityCache } from "../entityCache.js";
import { enrich } from "../entityEnricher.js";
import { compact, pageParam, toolError, toolSuccess } from "./helpers.js";

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
      description: "List leads (prospective tenants who inquired about listings).",
      inputSchema: { status: z.string().optional(), page: pageParam },
    },
    async ({ status, page }) => {
      try {
        const filters: Record<string, string | number> = {};
        if (status !== undefined) filters.status = status;
        const { items, total } = await client.leasing.listLeads({ filters, page });
        return toolSuccess({ data: items, count: items.length, total });
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
}
