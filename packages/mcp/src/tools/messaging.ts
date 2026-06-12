import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MESSENGER_CHANNELS,
  type MessengerChannel,
  type TcClient,
  type TcMessage,
  type TcThread,
} from "tenantcloud-client";
import { pageParam, toolError, toolSuccess } from "./helpers.js";

const channelParam = z
  .enum(MESSENGER_CHANNELS)
  .describe(
    "Conversation channel: tenant, owner, professional, client, leads, maintenance_requests, admins, tenant_chat, archive_client",
  );

/** Longest lastMessage preview included in thread listings. */
const PREVIEW_LENGTH = 200;

/** Page cap per channel when sweeping for find_threads. */
const MAX_FIND_PAGES = 10;

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SlimParticipant {
  id: number | null;
  name: string | null;
  email: string | null;
  role: string | null;
}

/**
 * The raw API duplicates a full user object under both `owner` and `contact`
 * on every participant (email, phone, timezone, fraud_status, avatar, ...).
 * Keep only what an agent needs to identify the person.
 */
export function slimParticipant(raw: unknown): SlimParticipant | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const wrapper = raw as Record<string, unknown>;
  const person = (wrapper["owner"] ?? wrapper["contact"] ?? wrapper) as unknown;
  if (!person || typeof person !== "object") {
    return null;
  }
  const p = person as Record<string, unknown>;
  const meta = (p["meta"] ?? {}) as Record<string, unknown>;
  const typeName = typeof meta["type_name"] === "string" ? meta["type_name"] : null;
  const role =
    typeof p["role"] === "string" ? p["role"] : typeName ? typeName.toLowerCase() : null;
  return {
    id: typeof p["id"] === "number" ? p["id"] : null,
    name: typeof p["name"] === "string" ? p["name"] : null,
    email: typeof p["email"] === "string" ? p["email"] : null,
    role,
  };
}

function previewBody(body: string | null): string | null {
  if (body === null) {
    return null;
  }
  const text = stripHtml(body);
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}...` : text;
}

export function slimMessage(message: TcMessage) {
  return {
    id: message.id,
    threadId: message.threadId,
    body: message.body,
    senderName: message.senderName,
    systemType: message.systemType,
    isRead: message.isRead,
    createdAt: message.createdAt,
    files: message.files,
    sender: slimParticipant(message.sender),
  };
}

export function slimThread(thread: TcThread) {
  const meta = (thread.meta ?? {}) as Record<string, unknown>;
  const unread = meta["unread_messages_count"];
  return {
    id: thread.id,
    type: thread.type,
    updatedAt: thread.updatedAt,
    unreadCount: typeof unread === "number" ? unread : 0,
    participants: thread.participants
      .map(slimParticipant)
      .filter((p): p is SlimParticipant => p !== null),
    lastMessage: thread.lastMessage
      ? {
          id: thread.lastMessage.id,
          body: previewBody(thread.lastMessage.body),
          senderName: thread.lastMessage.senderName,
          systemType: thread.lastMessage.systemType,
          isRead: thread.lastMessage.isRead,
          createdAt: thread.lastMessage.createdAt,
        }
      : null,
  };
}

function matchesParticipant(thread: ReturnType<typeof slimThread>, needle: string): boolean {
  return thread.participants.some(
    (p) =>
      (p.name !== null && p.name.toLowerCase().includes(needle)) ||
      (p.email !== null && p.email.toLowerCase().includes(needle)),
  );
}

export function registerMessagingTools(server: McpServer, client: TcClient): void {
  server.registerTool(
    "list_message_channels",
    {
      description:
        "List messaging channels and their unread/availability flags (tenant, owner, professional, client, leads, etc.).",
      inputSchema: {},
    },
    async () => {
      try {
        return toolSuccess(await client.messaging.channels());
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_threads",
    {
      description:
        "List message conversations (threads) in a channel. Returns thread id, participants (id/name/email/role), and a preview of the last message. To locate a specific person's thread, prefer find_threads.",
      inputSchema: { channel: channelParam, page: pageParam },
    },
    async ({ channel, page }) => {
      try {
        const { items, pagination } = await client.messaging.threads(channel, { page });
        const data = items.map(slimThread);
        return toolSuccess({ data, count: data.length, pagination });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "find_threads",
    {
      description:
        "Find conversation threads by participant name or email (case-insensitive substring match). Searches every channel unless one is given. Use this to resolve a person to a threadId before send_message. Note: team members/sub-admins live in the 'admins' channel, prospective tenants in 'leads'. A lead who has never been messaged has NO thread yet - if a lead is not found here, use message_lead instead.",
      inputSchema: {
        query: z.string().min(1).describe("Participant name or email to search for"),
        channel: channelParam.optional().describe("Limit the search to one channel"),
      },
    },
    async ({ query, channel }) => {
      try {
        const channels: readonly MessengerChannel[] = channel ? [channel] : MESSENGER_CHANNELS;
        const needle = query.toLowerCase();
        const matches: Array<{ channel: MessengerChannel } & ReturnType<typeof slimThread>> = [];
        const unavailableChannels: MessengerChannel[] = [];
        const cappedChannels: MessengerChannel[] = [];

        for (const ch of channels) {
          try {
            let page = 1;
            let totalPages = 1;
            while (page <= totalPages) {
              if (page > MAX_FIND_PAGES) {
                cappedChannels.push(ch);
                break;
              }
              const { items, pagination } = await client.messaging.threads(ch, { page });
              totalPages = pagination.totalPages;
              for (const thread of items) {
                const slim = slimThread(thread);
                if (matchesParticipant(slim, needle)) {
                  matches.push({ channel: ch, ...slim });
                }
              }
              page += 1;
            }
          } catch {
            // Some channels are unavailable for some account types; skip them.
            unavailableChannels.push(ch);
          }
        }

        return toolSuccess({
          data: matches,
          count: matches.length,
          ...(unavailableChannels.length > 0 ? { unavailableChannels } : {}),
          ...(cappedChannels.length > 0
            ? { cappedChannels, note: `search stopped after ${MAX_FIND_PAGES} pages per channel` }
            : {}),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_messages",
    {
      description: "List messages in a conversation thread (most recent first).",
      inputSchema: {
        threadId: z.number().int().describe("Thread ID (from list_threads)"),
        page: pageParam,
      },
    },
    async ({ threadId, page }) => {
      try {
        const { items, pagination } = await client.messaging.messages(threadId, { page });
        const data = items.map(slimMessage);
        return toolSuccess({ data, count: data.length, pagination });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "send_message",
    {
      description:
        "Send a message to a conversation thread. This is delivered to the other participant(s) - confirm intent before sending. To message a lead with no existing thread, use message_lead instead.",
      inputSchema: {
        threadId: z.number().int().describe("Thread ID to send to (from list_threads)"),
        body: z.string().min(1).describe("Message text"),
      },
    },
    async ({ threadId, body }) => {
      try {
        const message = await client.messaging.sendMessage(threadId, body);
        return toolSuccess({ sent: true, message: message ? slimMessage(message) : null });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "message_lead",
    {
      description:
        "Send a message to a lead (prospective tenant) by lead ID, creating the conversation thread if the lead has none yet. Use for first contact with a lead from list_leads; for an existing conversation, find_threads + send_message also works. This is delivered to the lead - confirm intent before sending.",
      inputSchema: {
        leadId: z.number().int().describe("Lead ID (from list_leads)"),
        body: z.string().min(1).describe("Message text"),
      },
    },
    async ({ leadId, body }) => {
      try {
        const thread = await client.leasing.openLeadThread(leadId);
        if (!thread) {
          return toolError(`could not open a message thread for lead ${leadId}`);
        }
        const message = await client.messaging.sendMessage(thread.id, body);
        return toolSuccess({
          sent: true,
          threadId: thread.id,
          message: message ? slimMessage(message) : null,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "mark_thread_read",
    {
      description: "Mark all messages in a conversation thread as read.",
      inputSchema: { threadId: z.number().int().describe("Thread ID") },
    },
    async ({ threadId }) => {
      try {
        await client.messaging.markThreadRead(threadId);
        return toolSuccess({ ok: true });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
