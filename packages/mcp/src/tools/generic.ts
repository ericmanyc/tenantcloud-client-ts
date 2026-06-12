import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HttpMethod, TcClient } from "tenantcloud-client";
import { toolError, toolSuccess } from "./helpers.js";

/**
 * Escape hatch covering every endpoint in the TenantCloud API catalog that has
 * no dedicated tool. Most resources are JSON:API: list/get with GET, and write
 * with a `{ "data": { "type": "...", "attributes": {...} } }` body.
 */
export function registerGenericTools(server: McpServer, client: TcClient): void {
  server.registerTool(
    "tc_request",
    {
      description:
        "Low-level authenticated request to any TenantCloud API endpoint (escape hatch for resources without a dedicated tool). " +
        "Paths are relative to https://api.tenantcloud.com/ (e.g. '/tasks', '/documents', '/property/123/financials'). " +
        "Most resources are JSON:API: to create, POST with body {\"data\":{\"type\":\"<type>\",\"attributes\":{...}}}; " +
        "to update, PATCH '/<endpoint>/<id>' with the same body including \"id\". See the tc://guide and tc://catalog resources for the endpoint/type list.",
      inputSchema: {
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .describe("HTTP method"),
        path: z.string().describe("Endpoint path, e.g. '/tasks' or '/maintenance_requests/123'"),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Optional query parameters, e.g. { \"filter[property_id]\": 123, \"page\": 1 }"),
        body: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Request body for POST/PUT/PATCH (usually the full JSON:API { data: { ... } } envelope)"),
      },
    },
    async ({ method, path, query, body }) => {
      try {
        const result = await client.request(method as HttpMethod, path, {
          query: query as Record<string, string | number | boolean> | undefined,
          body,
        });
        return toolSuccess(result ?? { ok: true });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
