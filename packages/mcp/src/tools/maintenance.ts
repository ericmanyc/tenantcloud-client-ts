import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TcClient } from "tenantcloud-client";
import type { EntityCache } from "../entityCache.js";
import { enrich } from "../entityEnricher.js";
import { compact, maxResultsParam, pageParam, toolError, toolSuccess } from "./helpers.js";

export function registerMaintenanceTools(server: McpServer, client: TcClient, cache: EntityCache): void {
  server.registerTool(
    "list_maintenance_requests",
    {
      description:
        "List maintenance requests / work orders. Filter by property, tenant (client), status, priority, or assignee.",
      inputSchema: {
        propertyId: z.number().int().optional().describe("Filter by property ID"),
        clientId: z.number().int().optional().describe("Filter by tenant/contact ID"),
        status: z.string().optional().describe("Filter by status (e.g. new, in_progress, resolved)"),
        priority: z.string().optional().describe("Filter by priority (e.g. low, medium, high, urgent)"),
        assigneeId: z.number().int().optional().describe("Filter by assignee ID"),
        maxResults: maxResultsParam,
      },
    },
    async ({ propertyId, clientId, status, priority, assigneeId, maxResults }) => {
      try {
        const items = await client.maintenance.listAll(maxResults ?? 100, {
          propertyId,
          clientId,
          status,
          priority,
          assigneeId,
        });
        const result = await enrich(
          { data: items as unknown as Array<Record<string, unknown>>, count: items.length },
          cache,
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_maintenance_request",
    {
      description: "Get a single maintenance request by ID, including its full detail.",
      inputSchema: { id: z.number().int().describe("Maintenance request ID") },
    },
    async ({ id }) => {
      try {
        const item = await client.maintenance.get(id);
        return item ? toolSuccess(item) : toolError(`maintenance request ${id} not found`);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_maintenance_request",
    {
      description: "Create a new maintenance request / work order.",
      inputSchema: {
        title: z.string().describe("Short title of the issue"),
        text: z.string().optional().describe("Detailed description"),
        propertyId: z.number().int().optional().describe("Property ID the request is for"),
        clientId: z.number().int().optional().describe("Tenant/contact ID who reported it"),
        categoryId: z.number().int().optional().describe("Category ID"),
        priority: z.string().optional().describe("Priority: low, medium, high, urgent"),
        assigneeId: z.number().int().optional().describe("Assignee (professional/team member) ID"),
        due: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      },
    },
    async ({ title, text, propertyId, clientId, categoryId, priority, assigneeId, due }) => {
      try {
        const created = await client.maintenance.create(
          compact({
            title,
            text,
            property_id: propertyId,
            client_id: clientId,
            category_id: categoryId,
            priority,
            assignee_id: assigneeId,
            due,
          }),
        );
        return toolSuccess({ created: true, request: created });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_maintenance_request",
    {
      description: "Update fields on an existing maintenance request.",
      inputSchema: {
        id: z.number().int().describe("Maintenance request ID"),
        title: z.string().optional(),
        text: z.string().optional(),
        status: z.string().optional().describe("New status"),
        priority: z.string().optional(),
        assigneeId: z.number().int().optional(),
        due: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      },
    },
    async ({ id, title, text, status, priority, assigneeId, due }) => {
      try {
        const updated = await client.maintenance.update(
          id,
          compact({ title, text, status, priority, assignee_id: assigneeId, due }),
        );
        return toolSuccess({ updated: true, request: updated });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "resolve_maintenance_request",
    {
      description: "Mark a maintenance request as resolved.",
      inputSchema: {
        id: z.number().int().describe("Maintenance request ID"),
        laborTimeHours: z.number().int().optional().describe("Labor time, hours"),
        laborTimeMinutes: z.number().int().optional().describe("Labor time, minutes"),
      },
    },
    async ({ id, laborTimeHours, laborTimeMinutes }) => {
      try {
        const resolved = await client.maintenance.resolve(
          id,
          compact({ labor_time_hours: laborTimeHours, labor_time_minutes: laborTimeMinutes }),
        );
        return toolSuccess({ resolved: true, request: resolved });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_inspections",
    {
      description: "List inspection templates/items.",
      inputSchema: { page: pageParam },
    },
    async ({ page }) => {
      try {
        const { items, pagination } = await client.maintenance.listInspectionItems({ page });
        return toolSuccess({ data: items, count: items.length, pagination });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
