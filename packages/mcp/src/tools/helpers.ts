import { z } from "zod";
import { TcClientError } from "tenantcloud-client";

export function toolSuccess(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

export function toolError(error: unknown) {
  if (error instanceof TcClientError && error.httpStatus === 401) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `${error.message} (HTTP 401). The user is not signed in to TenantCloud. ` +
            "Tell them, then offer to open a browser sign-in window via the tc_login tool. " +
            'Alternatively they can run "tc-mcp login" in a terminal and retry.',
        },
      ],
      isError: true,
    };
  }
  const message =
    error instanceof TcClientError
      ? `${error.message} (HTTP ${error.httpStatus})`
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export const maxResultsParam = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Maximum number of results to return (default 100)");

export const pageParam = z.number().int().positive().optional().describe("Page number (default 1)");

/** Drop undefined values so we only send fields the caller actually set. */
export function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}
