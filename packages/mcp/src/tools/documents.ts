import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TcClient } from "tenantcloud-client";
import { pageParam, toolError, toolSuccess } from "./helpers.js";

export function registerDocumentTools(server: McpServer, client: TcClient): void {
  server.registerTool(
    "list_files",
    {
      description: "List stored files (uploads, attachments, generated documents).",
      inputSchema: { page: pageParam },
    },
    async ({ page }) => {
      try {
        const { items, pagination } = await client.files.list({ page });
        return toolSuccess({ data: items, count: items.length, pagination });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_file",
    {
      description: "Get a file's metadata (including its download URL) by ID.",
      inputSchema: { id: z.number().int().describe("File ID") },
    },
    async ({ id }) => {
      try {
        const file = await client.files.get(id);
        return file ? toolSuccess(file) : toolError(`file ${id} not found`);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
