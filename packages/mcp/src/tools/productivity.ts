import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TcClient } from "tenantcloud-client";
import { compact, pageParam, toolError, toolSuccess } from "./helpers.js";

export function registerProductivityTools(server: McpServer, client: TcClient): void {
  server.registerTool(
    "list_tasks",
    {
      description: "List to-do tasks / reminders.",
      inputSchema: {
        resolved: z.boolean().optional().describe("Filter by completion: true=done, false=open"),
        page: pageParam,
      },
    },
    async ({ resolved, page }) => {
      try {
        const filters: Record<string, string | number> = {};
        if (resolved !== undefined) filters.is_resolved = resolved ? 1 : 0;
        const { items, total } = await client.productivity.listTasks({ filters, page });
        return toolSuccess({ data: items, count: items.length, total });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a to-do task / reminder. remindDate is required.",
      inputSchema: {
        title: z.string().describe("Task title"),
        remindDate: z.string().describe("Reminder date (YYYY-MM-DD), required"),
        text: z.string().optional().describe("Task details"),
        isFullDay: z.boolean().optional().describe("All-day task (default true)"),
      },
    },
    async ({ title, remindDate, text, isFullDay }) => {
      try {
        const task = await client.productivity.createTask(
          compact({ title, remind_date: remindDate, text, is_full_day: isFullDay ?? true }),
        );
        return toolSuccess({ created: true, task });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "complete_task",
    {
      description: "Mark a task as resolved/done.",
      inputSchema: { id: z.number().int().describe("Task ID") },
    },
    async ({ id }) => {
      try {
        const task = await client.productivity.updateTask(id, { is_resolved: true });
        return toolSuccess({ completed: true, task });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "delete_task",
    {
      description: "Delete a task by ID.",
      inputSchema: { id: z.number().int().describe("Task ID") },
    },
    async ({ id }) => {
      try {
        await client.productivity.deleteTask(id);
        return toolSuccess({ deleted: true, id });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_calendar_events",
    {
      description: "List calendar events. Optionally pass a date range via from/to (YYYY-MM-DD).",
      inputSchema: {
        from: z.string().optional().describe("Range start (YYYY-MM-DD)"),
        to: z.string().optional().describe("Range end (YYYY-MM-DD)"),
      },
    },
    async ({ from, to }) => {
      try {
        const query: Record<string, string> = {};
        if (from !== undefined) query["filter[from]"] = from;
        if (to !== undefined) query["filter[to]"] = to;
        return toolSuccess(await client.productivity.listCalendarEvents({ query }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_notes",
    {
      description:
        "List notes attached to an entity. Provide the entity type and id (notes are entity-scoped).",
      inputSchema: {
        noteableType: z.string().describe("Entity type the notes attach to (e.g. lease, property, userClient)"),
        noteableId: z.number().int().describe("Entity ID"),
        page: pageParam,
      },
    },
    async ({ noteableType, noteableId, page }) => {
      try {
        const { items, pagination } = await client.productivity.listNotes(
          { noteable_type: noteableType, noteable_id: noteableId },
          { page },
        );
        return toolSuccess({ data: items, count: items.length, pagination });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_note",
    {
      description: "Create a note attached to an entity (lease, property, contact, etc.).",
      inputSchema: {
        text: z.string().describe("Note text"),
        noteableType: z.string().describe("Entity type (e.g. lease, property, userClient)"),
        noteableId: z.number().int().describe("Entity ID"),
      },
    },
    async ({ text, noteableType, noteableId }) => {
      try {
        const note = await client.productivity.createNote(
          compact({ text, noteable_type: noteableType, noteable_id: noteableId }),
        );
        return toolSuccess({ created: true, note });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
