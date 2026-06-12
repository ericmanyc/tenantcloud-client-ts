import {
  parseLeaseStatus,
  parseTcDate,
  parseTcDateOrNull,
  parseTransactionCategory,
  parseTransactionStatus,
  pick,
  toBoolean,
  toNumber,
  toNumberOrNull,
  toStringOrNull,
  type TcLeaseStatus,
  type TcTransactionCategory,
  type TcTransactionStatus,
} from "./json.js";

export interface TcUserInfo {
  id: number;
  subDomain: string;
  email: string;
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  isCompany: boolean;
  company: string;
  phone: string;
  fax: string;
  lang: string;
}

export function parseUserInfo(raw: Record<string, unknown>): TcUserInfo {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    subDomain: String(pick(raw, "subDomain", "sub_domain") ?? ""),
    email: String(pick(raw, "email") ?? ""),
    firstName: String(pick(raw, "firstName", "first_name") ?? ""),
    lastName: String(pick(raw, "lastName", "last_name") ?? ""),
    address1: String(pick(raw, "address1") ?? ""),
    address2: String(pick(raw, "address2") ?? ""),
    city: String(pick(raw, "city") ?? ""),
    state: String(pick(raw, "state") ?? ""),
    zip: String(pick(raw, "zip") ?? ""),
    isCompany: toBoolean(pick(raw, "isCompany", "is_company")),
    company: String(pick(raw, "company") ?? ""),
    phone: String(pick(raw, "phone") ?? ""),
    fax: String(pick(raw, "fax") ?? ""),
    lang: String(pick(raw, "lang") ?? ""),
  };
}

export interface TcContact {
  id: number;
  email1: string;
  email2: string | null;
  email3: string | null;
  phone1: string;
  phone2: string | null;
  phone3: string | null;
  firstName: string;
  lastName: string;
  name: string;
}

export function parseContact(raw: Record<string, unknown>): TcContact {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    email1: String(pick(raw, "email") ?? ""),
    email2: toStringOrNull(pick(raw, "email_2")),
    email3: toStringOrNull(pick(raw, "email_3")),
    phone1: String(pick(raw, "phone") ?? ""),
    phone2: toStringOrNull(pick(raw, "phone_2")),
    phone3: toStringOrNull(pick(raw, "phone_3")),
    firstName: String(pick(raw, "firstName", "first_name") ?? ""),
    lastName: String(pick(raw, "lastName", "last_name") ?? ""),
    name: String(pick(raw, "name") ?? ""),
  };
}

// Pragmatic RFC-5322-ish matcher, same intent as the C# EmailRegex
const EMAIL_REGEX =
  /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/i;

const PHONE_REGEX = /(?:\+)?(?:\d[-\s()]?){8,15}/;

/** Extracts the valid email addresses among a contact's three email fields. */
export function validEmails(contact: TcContact): string[] {
  const result: string[] = [];
  for (const candidate of [contact.email1, contact.email2, contact.email3]) {
    if (!candidate || !candidate.trim()) {
      continue;
    }
    const match = EMAIL_REGEX.exec(candidate);
    if (match) {
      result.push(match[0]);
    }
  }
  return result;
}

/** Extracts valid phone numbers (digits only) among a contact's three phone fields. */
export function validPhones(contact: TcContact): string[] {
  const result: string[] = [];
  for (const candidate of [contact.phone1, contact.phone2, contact.phone3]) {
    if (!candidate || !candidate.trim()) {
      continue;
    }
    if (PHONE_REGEX.test(candidate)) {
      result.push(candidate.replace(/\D/g, ""));
    }
  }
  return result;
}

export interface TcProperty {
  id: number;
  name: string | null;
  address1: string | null;
  cityAddress: string | null;
  status: string | null;
}

export function parseProperty(raw: Record<string, unknown>): TcProperty {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    name: toStringOrNull(pick(raw, "name")),
    address1: toStringOrNull(pick(raw, "address1")),
    cityAddress: toStringOrNull(pick(raw, "cityAddress")),
    status: toStringOrNull(pick(raw, "property_status")),
  };
}

export function propertyAddress(property: TcProperty): string {
  return `${property.address1} ${property.cityAddress}`;
}

export interface TcUnit {
  id: number;
  propertyId: number;
  name: string;
  description: string | null;
  price: number;
  isRented: boolean;
  isPetAllowed: boolean;
  isFurnished: boolean;
  isUtilities: boolean;
}

export function parseUnit(raw: Record<string, unknown>): TcUnit {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    propertyId: toNumber(pick(raw, "property_id") ?? 0),
    name: String(pick(raw, "name") ?? ""),
    description: toStringOrNull(pick(raw, "description")),
    price: toNumber(pick(raw, "price") ?? 0),
    isRented: toBoolean(pick(raw, "is_rented")),
    isPetAllowed: toBoolean(pick(raw, "pets_allowed")),
    isFurnished: toBoolean(pick(raw, "is_furnished")),
    isUtilities: toBoolean(pick(raw, "is_utilities")),
  };
}

export interface TcTransaction {
  id: number;
  unitId: number | null;
  propertyId: number | null;
  payerId: number | null;
  detail: string | null;
  isRecurring: boolean;
  createdAt: Date;
  dueDate: Date;
  amount: number;
  paid: number;
  balance: number;
  currency: string;
  paidAt: Date | null;
  category: TcTransactionCategory;
  status: TcTransactionStatus;
}

export function parseTransaction(raw: Record<string, unknown>): TcTransaction {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    unitId: toNumberOrNull(pick(raw, "unit_id")),
    propertyId: toNumberOrNull(pick(raw, "property_id")),
    payerId: toNumberOrNull(pick(raw, "user_payer_id")),
    detail: toStringOrNull(pick(raw, "detail")),
    isRecurring: toBoolean(pick(raw, "is_recurring")),
    createdAt: parseTcDate(pick(raw, "created_at")),
    dueDate: parseTcDate(pick(raw, "date")),
    amount: toNumber(pick(raw, "amount") ?? 0),
    paid: toNumber(pick(raw, "paid") ?? 0),
    balance: toNumber(pick(raw, "balance") ?? 0),
    currency: String(pick(raw, "currency") ?? ""),
    paidAt: parseTcDateOrNull(pick(raw, "paid_at")),
    category: parseTransactionCategory(pick(raw, "category")),
    status: parseTransactionStatus(pick(raw, "status")),
  };
}

export interface TcLease {
  id: number;
  name: string | null;
  creationDate: Date;
  startDate: Date;
  endDate: Date | null;
  moveOutDate: Date | null;
  unitId: number;
  tenantId: number | null;
  status: TcLeaseStatus;
}

export function parseLease(raw: Record<string, unknown>): TcLease {
  return {
    id: toNumber(pick(raw, "id") ?? 0),
    name: toStringOrNull(pick(raw, "name")),
    creationDate: parseTcDate(pick(raw, "created_at")),
    startDate: parseTcDate(pick(raw, "rent_from")),
    endDate: parseTcDateOrNull(pick(raw, "rent_to")),
    moveOutDate: parseTcDateOrNull(pick(raw, "move_out_date")),
    unitId: toNumber(pick(raw, "unit_id") ?? 0),
    tenantId: toNumberOrNull(pick(raw, "user_client_id")),
    status: parseLeaseStatus(pick(raw, "lease_status")),
  };
}

export function leaseIsPending(lease: TcLease): boolean {
  return lease.status === "insurance_pending" || lease.status === "pending";
}

export function leaseIsArchived(lease: TcLease): boolean {
  return lease.status === "archived";
}

export function leaseIsFuture(lease: TcLease, referenceDate: Date = new Date()): boolean {
  if (leaseIsArchived(lease)) {
    return false;
  }
  return lease.startDate.getTime() > referenceDate.getTime();
}

export function leaseIsPast(lease: TcLease, referenceDate: Date = new Date()): boolean {
  if (lease.status === "expired" || lease.status === "archived" || lease.status === "ended") {
    return true;
  }
  return (
    lease.startDate.getTime() < referenceDate.getTime() &&
    lease.endDate !== null &&
    lease.endDate.getTime() < referenceDate.getTime()
  );
}

export function leaseIsActive(lease: TcLease, referenceDate: Date = new Date()): boolean {
  if (leaseIsArchived(lease) || lease.status === "not_active") {
    return false;
  }
  return (
    lease.status === "active" &&
    !leaseIsFuture(lease, referenceDate) &&
    !leaseIsPast(lease, referenceDate)
  );
}
