import { describe, expect, it } from "vitest";
import {
  labelPropertyKeyType,
  maintenancePriorityCode,
  maintenanceStatusCode,
  parseLeaseStatus,
  parseMaintenancePriority,
  parseMaintenanceStatus,
  parseTcDate,
  parseTcDateOrNull,
  parseTransactionCategory,
  parseTransactionStatus,
  toNumber,
  toNumberOrNull,
} from "../src/json.js";
import {
  parseContact,
  parseLease,
  parseTransaction,
  validEmails,
  validPhones,
} from "../src/models.js";

describe("toNumber (JsonAutoLongConverter port)", () => {
  it("reads a number", () => {
    expect(toNumber(42)).toBe(42);
  });

  it("reads a numeric string", () => {
    expect(toNumber("123")).toBe(123);
  });

  it("rejects garbage", () => {
    expect(() => toNumber("abc")).toThrow();
  });

  it("nullable variant reads null", () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
    expect(toNumberOrNull("7")).toBe(7);
  });
});

describe("parseTcDate (DateFormats port)", () => {
  it("reads M/d/yyyy", () => {
    const d = parseTcDate("1/15/2024");
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  it("reads MM/dd/yyyy", () => {
    const d = parseTcDate("02/05/2025");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(5);
  });

  it("reads yyyy-MM-dd as a local date", () => {
    const d = parseTcDate("2026-02-01");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(1);
  });

  it("reads ISO 8601 datetimes", () => {
    const d = parseTcDate("2026-02-01T23:00:49.000000Z");
    expect(d.toISOString()).toBe("2026-02-01T23:00:49.000Z");
  });

  it("nullable variant reads null", () => {
    expect(parseTcDateOrNull(null)).toBeNull();
  });

  it("rejects unknown formats", () => {
    expect(() => parseTcDate("not a date")).toThrow();
  });
});

describe("transaction status converter port", () => {
  it("reads numeric codes", () => {
    expect(parseTransactionStatus(1)).toBe("paid");
    expect(parseTransactionStatus(0)).toBe("due");
    expect(parseTransactionStatus(9)).toBe("void");
  });

  it("reads string names case-insensitively", () => {
    expect(parseTransactionStatus("Paid")).toBe("paid");
    expect(parseTransactionStatus("with_balance")).toBe("with_balance");
    expect(parseTransactionStatus("WithBalance")).toBe("with_balance");
  });

  it("rejects unknown values", () => {
    expect(() => parseTransactionStatus("bogus")).toThrow();
  });
});

describe("lease status converter port", () => {
  it("reads numeric codes", () => {
    expect(parseLeaseStatus(0)).toBe("active");
    expect(parseLeaseStatus(11)).toBe("archived");
    expect(parseLeaseStatus(13)).toBe("expires_in");
  });

  it("reads string names", () => {
    expect(parseLeaseStatus("active")).toBe("active");
    expect(parseLeaseStatus("insurance_pending")).toBe("insurance_pending");
    expect(parseLeaseStatus("InsurancePending")).toBe("insurance_pending");
  });
});

describe("maintenance status normalizer (lenient)", () => {
  it("maps numeric codes and numeric strings to names", () => {
    expect(parseMaintenanceStatus(1)).toBe("new");
    expect(parseMaintenanceStatus(2)).toBe("in_progress");
    expect(parseMaintenanceStatus(5)).toBe("archived");
    expect(parseMaintenanceStatus(6)).toBe("canceled");
    expect(parseMaintenanceStatus(7)).toBe("in_review");
    expect(parseMaintenanceStatus("3")).toBe("resolved");
  });

  it("canonicalizes names case-insensitively and from CamelCase/spaces", () => {
    expect(parseMaintenanceStatus("New")).toBe("new");
    expect(parseMaintenanceStatus("In Progress")).toBe("in_progress");
    expect(parseMaintenanceStatus("InReview")).toBe("in_review");
  });

  it("passes unknown values through instead of throwing, and blanks to null", () => {
    expect(parseMaintenanceStatus("waiting_on_parts")).toBe("waiting_on_parts");
    expect(parseMaintenanceStatus(99)).toBe("99");
    expect(parseMaintenanceStatus(null)).toBeNull();
    expect(parseMaintenanceStatus("")).toBeNull();
  });
});

describe("maintenance priority normalizer (lenient)", () => {
  it("maps codes and names", () => {
    expect(parseMaintenancePriority(1)).toBe("low");
    expect(parseMaintenancePriority(4)).toBe("critical");
    expect(parseMaintenancePriority("High")).toBe("high");
    expect(parseMaintenancePriority("2")).toBe("normal");
  });
});

describe("maintenance filter codes (name/code -> numeric code)", () => {
  it("resolves names and numeric strings to codes, null when unknown", () => {
    expect(maintenanceStatusCode("resolved")).toBe(3);
    expect(maintenanceStatusCode("In Progress")).toBe(2);
    expect(maintenanceStatusCode(5)).toBe(5);
    expect(maintenanceStatusCode("5")).toBe(5);
    expect(maintenanceStatusCode("bogus")).toBeNull();
    expect(maintenancePriorityCode("critical")).toBe(4);
  });
});

describe("property key type labels", () => {
  it("labels known codes and returns null for unknown/absent", () => {
    expect(labelPropertyKeyType(1)).toBe("Main door");
    expect(labelPropertyKeyType(12)).toBe("Garage");
    expect(labelPropertyKeyType(13)).toBe("Other");
    expect(labelPropertyKeyType(99)).toBeNull();
    expect(labelPropertyKeyType(null)).toBeNull();
  });
});

describe("transaction category", () => {
  it("reads strings", () => {
    expect(parseTransactionCategory("income")).toBe("income");
    expect(parseTransactionCategory("Expense")).toBe("expense");
  });
});

describe("parseTransaction", () => {
  it("parses a full transaction with string ids and slash date", () => {
    const tx = parseTransaction({
      id: 1,
      unit_id: "55",
      property_id: 66,
      user_payer_id: null,
      detail: "Rent",
      is_recurring: true,
      created_at: "2026-02-01T23:00:49.000000Z",
      date: "1/15/2024",
      amount: 99.5,
      paid: 0,
      balance: 99.5,
      currency: "USD",
      paid_at: null,
      category: "income",
      status: 1,
    });

    expect(tx.unitId).toBe(55);
    expect(tx.propertyId).toBe(66);
    expect(tx.payerId).toBeNull();
    expect(tx.dueDate.getMonth()).toBe(0);
    expect(tx.dueDate.getDate()).toBe(15);
    expect(tx.amount).toBe(99.5);
    expect(tx.paidAt).toBeNull();
    expect(tx.status).toBe("paid");
    expect(tx.category).toBe("income");
  });
});

describe("parseLease", () => {
  it("parses dates and nullable tenant id", () => {
    const lease = parseLease({
      id: 9,
      name: "Lease A",
      created_at: "2024-01-01T00:00:00Z",
      rent_from: "2024-02-01",
      rent_to: null,
      move_out_date: null,
      unit_id: 11,
      user_client_id: "321",
      lease_status: "active",
    });

    expect(lease.tenantId).toBe(321);
    expect(lease.endDate).toBeNull();
    expect(lease.status).toBe("active");
    expect(lease.startDate.getMonth()).toBe(1);
    expect(lease.previousLeaseId).toBeNull();
    expect(lease.rent).toBeNull();
  });

  it("captures previous_lease_id and prefers temp_transactions rent over a zero top-level amount", () => {
    const lease = parseLease({
      id: 1608126,
      created_at: "2026-06-22T17:21:13Z",
      rent_from: "2026-07-01",
      rent_to: "2027-06-30",
      unit_id: 1308432,
      user_client_id: 3009598,
      lease_status: 1,
      previous_lease_id: 1601718,
      amount: 0,
      temp_transactions: { rent: { amount: 1600 } },
    });

    expect(lease.status).toBe("future");
    expect(lease.previousLeaseId).toBe(1601718);
    expect(lease.rent).toBe(1600);
  });

  it("falls back to a positive top-level amount when no rent recurring item exists", () => {
    const lease = parseLease({
      id: 7,
      created_at: "2026-01-01T00:00:00Z",
      rent_from: "2026-01-01",
      unit_id: 5,
      user_client_id: 9,
      lease_status: "active",
      amount: 1000,
    });

    expect(lease.rent).toBe(1000);
  });
});

describe("contact email/phone validation", () => {
  it("extracts valid emails and skips invalid ones", () => {
    const contact = parseContact({
      id: 1,
      email: "john@example.com",
      email_2: "not-an-email",
      email_3: "  jane@foo.org  ",
      phone: "555-123-4567",
      phone_2: "n/a",
      phone_3: null,
      first_name: "John",
      last_name: "Smith",
      name: "John Smith",
    });

    expect(validEmails(contact)).toEqual(["john@example.com", "jane@foo.org"]);
    expect(validPhones(contact)).toEqual(["5551234567"]);
  });
});
