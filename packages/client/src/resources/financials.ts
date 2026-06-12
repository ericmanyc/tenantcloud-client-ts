/**
 * Financials: transaction writes, recurring transactions, payments, accounts,
 * statistics, reconciliation and reports. All JSON:API.
 *
 * Reads for the transaction list itself stay on `client.transactions`
 * (PaginatedSource); this client adds the create/update/delete and the
 * surrounding financial resources.
 *
 * Endpoints:
 *   POST/GET   /transactions, /transactions/{id} (+ /print)
 *   GET        /transactions/statistics
 *   GET        /transactions/accounts
 *   GET/POST   /transactions/recurrings (+ /{id}, /{id}/next_invoice)
 *   GET        /transactions/payments (+ /{id}, /statistics, /liability)
 *   POST       /transactions/bulk_payments, /transactions/deposit, /transactions/credits
 *   GET        /reconciliation/bank_accounts, /reconciliation/reconciliations
 *   GET        /reconciliation/statement_records (+ match/{id}, skip/{id})
 *   GET        /reports/transactions/{operating_statement|owner_statement|tax_preparation}
 *   GET        /owner/statistics/balances, /owner/reports, /invoices
 */
import { parseTransaction, type TcTransaction } from "../models.js";
import {
  jsonApiBody,
  parseJsonApiList,
  parseJsonApiOne,
  withQuery,
  type JsonApiList,
  type JsonApiRecord,
  type TcHttp,
} from "./jsonApi.js";

export class FinancialsClient {
  constructor(private readonly http: TcHttp) {}

  // --- Transactions (writes; reads via client.transactions) ---

  async getTransaction(id: number, signal?: AbortSignal): Promise<TcTransaction | null> {
    const payload = await this.http.request("GET", `/transactions/${id}`, { signal });
    const one = parseJsonApiOne(payload);
    return one ? parseTransaction(one) : null;
  }

  async createTransaction(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcTransaction | null> {
    const payload = await this.http.request("POST", "/transactions", {
      body: jsonApiBody("transaction", attributes),
      signal,
    });
    const one = parseJsonApiOne(payload);
    return one ? parseTransaction(one) : null;
  }

  async updateTransaction(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TcTransaction | null> {
    const payload = await this.http.request("PATCH", `/transactions/${id}`, {
      body: jsonApiBody("transaction", attributes, id),
      signal,
    });
    const one = parseJsonApiOne(payload);
    return one ? parseTransaction(one) : null;
  }

  async deleteTransaction(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/transactions/${id}`, { signal });
  }

  printTransaction(id: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("GET", `/transactions/${id}/print`, { signal });
  }

  /**
   * Aggregate income/expense/balance statistics. Accepts the same filters as
   * the transactions list (property_id, unit_id, client_id, date, status...).
   */
  statistics(
    filters: Record<string, string | number> = {},
    signal?: AbortSignal,
  ): Promise<JsonApiRecord[]> {
    const query: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/transactions/statistics", query), { signal })
      .then((p) => parseJsonApiList(p).items);
  }

  /** Bank/cash accounts that transactions post against. */
  accounts(signal?: AbortSignal): Promise<JsonApiList> {
    return this.http.request("GET", "/transactions/accounts", { signal }).then(parseJsonApiList);
  }

  // --- Recurring transactions ---

  listRecurring(options: { page?: number | undefined; signal?: AbortSignal | undefined } = {}): Promise<JsonApiList> {
    const path = withQuery("/transactions/recurrings", { page: options.page });
    return this.http.request("GET", path, { signal: options.signal }).then(parseJsonApiList);
  }

  getRecurring(id: number, signal?: AbortSignal): Promise<JsonApiRecord | null> {
    return this.http.request("GET", `/transactions/recurrings/${id}`, { signal }).then(parseJsonApiOne);
  }

  async createRecurring(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", "/transactions/recurrings", {
      body: jsonApiBody("transactions_recurring", attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  async updateRecurring(
    id: number,
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("PATCH", `/transactions/recurrings/${id}`, {
      body: jsonApiBody("transactions_recurring", attributes, id),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  async deleteRecurring(id: number, signal?: AbortSignal): Promise<void> {
    await this.http.request("DELETE", `/transactions/recurrings/${id}`, { signal });
  }

  nextInvoice(recurringId: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("GET", `/transactions/recurrings/${recurringId}/next_invoice`, { signal });
  }

  // --- Payments ---

  listPayments(
    filters: Record<string, string | number> = {},
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<JsonApiList> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/transactions/payments", query), { signal: options.signal })
      .then(parseJsonApiList);
  }

  getPayment(id: number, signal?: AbortSignal): Promise<JsonApiRecord | null> {
    return this.http
      .request("GET", `/transactions/payments/${id}`, { signal })
      .then(parseJsonApiOne);
  }

  paymentStatistics(
    filters: Record<string, string | number> = {},
    signal?: AbortSignal,
  ): Promise<JsonApiRecord[]> {
    const query: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/transactions/payments/statistics", query), { signal })
      .then((p) => parseJsonApiList(p).items);
  }

  /** Record a manual payment against one or more invoices. */
  async recordPayment(
    attributes: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonApiRecord | null> {
    const payload = await this.http.request("POST", "/transactions/payments", {
      body: jsonApiBody("transaction_payment", attributes),
      signal,
    });
    return parseJsonApiOne(payload);
  }

  bulkPayments(attributes: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", "/transactions/bulk_payments", {
      body: jsonApiBody("transaction_payment", attributes),
      signal,
    });
  }

  // --- Reconciliation ---

  reconciliationBankAccounts(signal?: AbortSignal): Promise<JsonApiList> {
    return this.http
      .request("GET", "/reconciliation/bank_accounts", { signal })
      .then(parseJsonApiList);
  }

  reconciliations(options: { page?: number | undefined; signal?: AbortSignal | undefined } = {}): Promise<JsonApiList> {
    const path = withQuery("/reconciliation/reconciliations", { page: options.page });
    return this.http.request("GET", path, { signal: options.signal }).then(parseJsonApiList);
  }

  statementRecords(
    filters: Record<string, string | number> = {},
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<JsonApiList> {
    const query: Record<string, string | number | undefined> = { page: options.page };
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http
      .request("GET", withQuery("/reconciliation/statement_records", query), { signal: options.signal })
      .then(parseJsonApiList);
  }

  matchStatementRecord(id: number, attributes: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", `/reconciliation/statement_records/match/${id}`, {
      body: jsonApiBody("statement_records", attributes, id),
      signal,
    });
  }

  skipStatementRecord(id: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", `/reconciliation/statement_records/skip/${id}`, { signal });
  }

  // --- Reports & owner financials ---

  ownerBalances(signal?: AbortSignal): Promise<unknown> {
    return this.http.request("GET", "/owner/statistics/balances", { signal });
  }

  /** Owner management agreements (between property owners and the manager). */
  ownerAgreements(
    options: { page?: number | undefined; signal?: AbortSignal | undefined } = {},
  ): Promise<JsonApiList> {
    const path = withQuery("/owner_agreements", { page: options.page });
    return this.http.request("GET", path, { signal: options.signal }).then(parseJsonApiList);
  }

  getOwnerAgreement(id: number, signal?: AbortSignal): Promise<JsonApiRecord | null> {
    return this.http.request("GET", `/owner/agreements/${id}`, { signal }).then(parseJsonApiOne);
  }

  signOwnerAgreement(id: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.request("POST", `/owner/agreements/${id}/sign`, { signal });
  }

  /** Available owner report definitions. */
  ownerReports(signal?: AbortSignal): Promise<unknown> {
    return this.http.request("GET", "/owner/reports", { signal });
  }

  invoices(options: { page?: number | undefined; signal?: AbortSignal | undefined } = {}): Promise<JsonApiList> {
    const path = withQuery("/invoices", { page: options.page });
    return this.http.request("GET", path, { signal: options.signal }).then(parseJsonApiList);
  }

  /** Generate a transactions report. `kind` is the report slug. */
  report(
    kind: "operating_statement" | "owner_statement" | "tax_preparation" | "summary/owner_statement",
    filters: Record<string, string | number> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const query: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(filters)) query[`filter[${k}]`] = v;
    return this.http.request("GET", withQuery(`/reports/transactions/${kind}`, query), { signal });
  }
}
