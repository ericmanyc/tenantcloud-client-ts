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

  const timelineEntityType = z
    .enum(["lease", "contact", "application", "user", "maintenance", "demo", "ticket", "lead", "documents", "disputes", "inspection", "listing"])
    .describe("Entity the notes/timeline attach to (lease = a lease, contact = a contact/tenant)");

  server.registerTool(
    "list_notes",
    {
      description:
        "List notes attached to an entity (read via the timeline feed's Notes tab; there is no standalone notes list endpoint).",
      inputSchema: {
        entityType: timelineEntityType,
        entityId: z.number().int().describe("Entity ID (e.g. lease ID for entityType=lease)"),
        page: pageParam,
      },
    },
    async ({ entityType, entityId, page }) => {
      try {
        const { items, total } = await client.productivity.listNotes(entityType, entityId, { page });
        return toolSuccess({ data: items, count: items.length, total });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_timeline",
    {
      description:
        "Activity timeline feed for an entity (lease, contact, lead, ...). filter selects the dashboard tab: all, notes, tasks, activity, files.",
      inputSchema: {
        entityType: timelineEntityType,
        entityId: z.number().int().describe("Entity ID"),
        filter: z.enum(["all", "notes", "tasks", "activity", "files"]).optional().describe("Tab filter (default all)"),
        page: pageParam,
      },
    },
    async ({ entityType, entityId, filter, page }) => {
      try {
        const { items, total } = await client.productivity.listTimeline(entityType, entityId, {
          filter,
          page,
        });
        return toolSuccess({ data: items, count: items.length, total });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_note",
    {
      description: "Create a note attached to an entity (lease, contact, lead, ...).",
      inputSchema: {
        text: z.string().describe("Note text"),
        entityType: timelineEntityType,
        entityId: z.number().int().describe("Entity ID"),
        remindDate: z.string().optional().describe("Optional reminder date (YYYY-MM-DD)"),
      },
    },
    async ({ text, entityType, entityId, remindDate }) => {
      try {
        const note = await client.productivity.createNote(
          entityType,
          entityId,
          compact({ text, remind_date: remindDate }),
        );
        return toolSuccess({ created: true, note });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
