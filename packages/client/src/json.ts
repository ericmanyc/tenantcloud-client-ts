/**
 * Parse helpers for TenantCloud's quirky JSON: ids that may be numbers or
 * strings, dates in several formats, statuses that may be numeric codes or
 * string names. Ported from the C# JsonConverter classes.
 */

export function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  throw new Error(`Cannot convert ${JSON.stringify(value)} to a number`);
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toNumber(value);
}

export function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

export function toBoolean(value: unknown): boolean {
  return Boolean(value);
}

const SLASH_DATE = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;
const ISO_DATE = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/;

/**
 * Parses TenantCloud date strings: "M/d/yyyy", "yyyy-MM-dd" (both treated as
 * local dates), or full ISO 8601 datetimes (e.g. "2026-02-01T23:00:49.000000Z").
 */
export function parseTcDate(value: unknown): Date {
  const result = tryParseTcDate(value);
  if (result === null) {
    throw new Error(`Unknown date format for ${JSON.stringify(value)}`);
  }
  return result;
}

export function parseTcDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  // The API serialises an absent date inconsistently: sometimes null, sometimes
  // an empty string "", sometimes an empty array [] (a PHP empty-array quirk).
  // Treat any non-string or blank value as "no date" rather than throwing.
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const result = tryParseTcDate(value);
  if (result === null) {
    throw new Error(`Unknown date format for ${JSON.stringify(value)}`);
  }
  return result;
}

function tryParseTcDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const slash = SLASH_DATE.exec(value);
  if (slash) {
    const [, m, d, y] = slash;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  const iso = ISO_DATE.exec(value);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const LEASE_STATUSES = [
  "active",
  "future",
  "expired",
  "ended",
  "pending",
  "not_active",
  "archived",
  "insurance_pending",
  "expires_in",
] as const;

export type TcLeaseStatus = (typeof LEASE_STATUSES)[number];

const LEASE_STATUS_CODES: Record<number, TcLeaseStatus> = {
  0: "active",
  1: "future",
  2: "expired",
  4: "ended",
  9: "pending",
  10: "not_active",
  11: "archived",
  12: "insurance_pending",
  13: "expires_in",
};

export function parseLeaseStatus(value: unknown): TcLeaseStatus {
  if (typeof value === "number") {
    const status = LEASE_STATUS_CODES[value];
    if (status) {
      return status;
    }
    throw new Error(`Unknown lease status code ${value}`);
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as TcLeaseStatus;
    if (LEASE_STATUSES.includes(normalized)) {
      return normalized;
    }
    // The C# version also accepts enum member names (e.g. "ExpiresIn")
    const snake = value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase() as TcLeaseStatus;
    if (LEASE_STATUSES.includes(snake)) {
      return snake;
    }
    throw new Error(`Unknown lease status ${JSON.stringify(value)}`);
  }
  throw new Error(`Unsupported lease status token ${JSON.stringify(value)}`);
}

export const TRANSACTION_STATUSES = [
  "due",
  "paid",
  "partial",
  "pending",
  "void",
  "with_balance",
  "overdue",
  "waive",
] as const;

export type TcTransactionStatus = (typeof TRANSACTION_STATUSES)[number];

const TRANSACTION_STATUS_CODES: Record<number, TcTransactionStatus> = {
  0: "due",
  1: "paid",
  2: "partial",
  3: "pending",
  9: "void",
  10: "with_balance",
  11: "overdue",
  12: "waive",
};

export function parseTransactionStatus(value: unknown): TcTransactionStatus {
  if (typeof value === "number") {
    const status = TRANSACTION_STATUS_CODES[value];
    if (status) {
      return status;
    }
    throw new Error(`Unknown transaction status code ${value}`);
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as TcTransactionStatus;
    if (TRANSACTION_STATUSES.includes(normalized)) {
      return normalized;
    }
    const snake = value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase() as TcTransactionStatus;
    if (TRANSACTION_STATUSES.includes(snake)) {
      return snake;
    }
    throw new Error(`Unknown transaction status ${JSON.stringify(value)}`);
  }
  throw new Error(`Unsupported transaction status token ${JSON.stringify(value)}`);
}

export const TRANSACTION_CATEGORIES = [
  "income",
  "expense",
  "refund",
  "credits",
  "liability",
] as const;

export type TcTransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export function parseTransactionCategory(value: unknown): TcTransactionCategory {
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as TcTransactionCategory;
    if (TRANSACTION_CATEGORIES.includes(normalized)) {
      return normalized;
    }
  }
  if (typeof value === "number") {
    const byIndex = TRANSACTION_CATEGORIES[value];
    if (byIndex) {
      return byIndex;
    }
  }
  throw new Error(`Unknown transaction category ${JSON.stringify(value)}`);
}

/** Case-insensitive property lookup, because TenantCloud mixes casings. */
export function pick(raw: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in raw) {
      return raw[name];
    }
  }
  const lower = new Map(Object.keys(raw).map((k) => [k.toLowerCase(), k]));
  for (const name of names) {
    const actual = lower.get(name.toLowerCase());
    if (actual !== undefined) {
      return raw[actual];
    }
  }
  return undefined;
}
