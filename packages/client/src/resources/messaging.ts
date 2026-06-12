/**
 * Messaging (the in-app "Messenger"). Unlike most TenantCloud resources this
 * area is NOT JSON:API - it uses a Laravel paginator envelope
 * (`{ data: [...], pagination: {...} }`) and plain request bodies.
 *
 * Endpoints (base `/messenger`):
 *   GET    /channels                              channel flags by type
 *   POST   /channels/{id}/read                    mark a channel read
 *   GET    /threads?channel=<type>                list conversations
 *   POST   /threads                               start a conversation
 *   GET    /threads/{id}                          one conversation
 *   PATCH  /threads/{id}                          update a conversation
 *   DELETE /threads/{id}                          delete a conversation
 *   POST   /threads/{id}/read                     mark a conversation read
 *   GET    /threads/{id}/export                   export transcript
 *   GET    /threads/{id}/messages                 list messages
 *   POST   /threads/{id}/messages                 send a message
 *   PATCH  /threads/{id}/messages/{mid}           edit a message
 *   DELETE /threads/{id}/messages/{mid}           delete (for me)
 *   DELETE /threads/{id}/messages/{mid}/everyone  delete (for everyone)
 *   POST   /messages/{id}/unread                  mark a message unread
 */
import { parseTcDateOrNull, pick, toBoolean, toNumber, toNumberOrNull } from "../json.js";
import { parseLaravelList, withQuery, type PageInfo, type TcHttp } from "./jsonApi.js";

export const MESSENGER_CHANNELS = [
  "tenant_chat",
  "admins",
  "tenant",
  "owner",
  "professional",
  "client",
  "archive_client",
  "maintenance_requests",
  "leads",
] as const;

export type MessengerChannel = (typeof MESSENGER_CHANNELS)[number];

export interface TcMessage {
  id: number;
  threadId: number;
  body: string | null;
  senderName: string | null;
  systemType: string | null;
  isRead: boolean;
  firstSeenAt: Date | null;
  createdAt: Date | null;
  /** Attachments, raw from the API. */
  files: unknown[];
  /** Sender object, raw from the API. */
  sender: unknown;
}

export function parseMessage(raw: Record<string, unknown>): TcMessage {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    threadId: toNumber(pick(raw, "thread_id") ?? 0),
    body: (pick(raw, "body") as string | null) ?? null,
    senderName: (pick(raw, "sender_name") as string | null) ?? null,
    systemType: (pick(raw, "system_type") as string | null) ?? null,
    isRead: toBoolean(pick(raw, "is_read")),
    firstSeenAt: parseTcDateOrNull(pick(raw, "first_seen_at")),
    createdAt: parseTcDateOrNull(pick(raw, "created_at")),
    files: (pick(raw, "files") as unknown[] | null) ?? [],
    sender: pick(raw, "sender") ?? null,
  };
}

export interface TcThread {
  id: number;
  type: string | null;
  lastMessageId: number | null;
  lastMessage: TcMessage | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** Participants, raw from the API. */
  participants: unknown[];
  /** The associated client/contact object, raw from the API. */
  client: unknown;
  meta: unknown;
}

export function parseThread(raw: Record<string, unknown>): TcThread {
  const last = pick(raw, "last_message");
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    type: (pick(raw, "type") as string | null) ?? null,
    lastMessageId: toNumberOrNull(pick(raw, "last_message_id")),
    lastMessage:
      last && typeof last === "object" ? parseMessage(last as Record<string, unknown>) : null,
    createdAt: parseTcDateOrNull(pick(raw, "created_at")),
    updatedAt: parseTcDateOrNull(pick(raw, "updated_at")),
    participants: (pick(raw, "participants") as unknown[] | null) ?? [],
    client: pick(raw, "client") ?? null,
    meta: pick(raw, "meta") ?? null,
  };
}

export interface TcPage<T> {
  items: T[];
  pagination: PageInfo;
}

export class MessengerClient {
  constructor(private readonly http: TcHttp) {}

  /** Channel availability/unread flags keyed by channel type. */
  channels(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.http.request("GET", "/messenger/channels", { signal });
  }

  async threads(
    channel: MessengerChannel,
    options: {
      page?: number | undefined;
      query?: Record<string, string | number> | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<TcPage<TcThread>> {
    const path = withQuery("/messenger/threads", {
      channel,
      page: options.page,
      ...options.query,
    });
    const payload = await this.http.request("GET", path, { signal: options.signal });
    const { items, pagination } = parseLaravelList<Record<string, unknown>>(payload);
    return { items: items.map(parseThread), pagination };
  }

  async thread(
    id: number,
    channel?: MessengerChannel,
    signal?: AbortSignal,
  ): Promise<TcThread | null> {
    const path = withQuery(`/messenger/threads/${id}`, { channel });
    const payload = await this.http.request<{ data?: Record<string, unknown> }>("GET", path, {
      signal,
    });
    const data = payload?.data;
    return data ? parseThread(data) : null;
  }

  async messages(
    threadId: number,
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<TcPage<TcMessage>> {
    const path = withQuery(`/messenger/threads/${threadId}/messages`, { page: options.page });
    const payload = await this.http.request("GET", path, { signal: options.signal });
    const { items, pagination } = parseLaravelList<Record<string, unknown>>(payload);
    return { items: items.map(parseMessage), pagination };
  }

  /** Send a message to a conversation. `files` are pre-uploaded file IDs/refs. */
  async sendMessage(
    threadId: number,
    body: string,
    options: { files?: unknown[] | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<TcMessage | null> {
    const payload = await this.http.request<{ data?: Record<string, unknown> } | Record<string, unknown>>(
      "POST",
      `/messenger/threads/${threadId}/messages`,
      { body: { body, ...(options.files ? { files: options.files } : {}) }, signal: options.signal },
    );
    const data = (payload as { data?: Record<string, unknown> })?.data ?? payload;
    return data && typeof data === "object" ? parseMessage(data as Record<string, unknown>) : null;
  }

  async editMessage(
    threadId: number,
    messageId: number,
    body: string,
    signal?: AbortSignal,
  ): Promise<TcMessage | null> {
    const payload = await this.http.request<{ data?: Record<string, unknown> }>(
      "PATCH",
      `/messenger/threads/${threadId}/messages/${messageId}`,
      { body: { body }, signal },
    );
    const data = payload?.data ?? (payload as unknown as Record<string, unknown>);
    return data && typeof data === "object" ? parseMessage(data) : null;
  }

  async deleteMessage(
    threadId: number,
    messageId: number,
    options: { everyone?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    const suffix = options.everyone ? "/everyone" : "";
    await this.http.request("DELETE", `/messenger/threads/${threadId}/messages/${messageId}${suffix}`, {
      signal: options.signal,
    });
  }

  async markMessageUnread(messageId: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("POST", `/messenger/messages/${messageId}/unread`, { signal });
  }

  async markThreadRead(threadId: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("POST", `/messenger/threads/${threadId}/read`, { signal });
  }

  async markChannelRead(channelId: number | string, signal?: AbortSignal): Promise<void> {
    await this.http.request("POST", `/messenger/channels/${channelId}/read`, { signal });
  }

  /** Create a new conversation. `attributes` shape depends on the channel. */
  async createThread(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcThread | null> {
    const payload = await this.http.request<{ data?: Record<string, unknown> }>(
      "POST",
      "/messenger/threads",
      { body: attributes, signal },
    );
    const data = payload?.data ?? (payload as unknown as Record<string, unknown>);
    return data && typeof data === "object" ? parseThread(data) : null;
  }

  exportThread(threadId: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("GET", `/messenger/threads/${threadId}/export`, { signal });
  }
}
