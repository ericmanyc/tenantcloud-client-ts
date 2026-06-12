import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TcClient } from "tenantcloud-client";
import type { EntityCache } from "../entityCache.js";
import { enrich } from "../entityEnricher.js";
import { compact, pageParam, toolError, toolSuccess } from "./helpers.js";

function filterRecord(
  o: Record<string, number | string | undefined>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function registerFinancialsTools(server: McpServer, client: TcClient, cache: EntityCache): void {
  server.registerTool(
    "get_transaction_statistics",
    {
      description:
        "Get aggregate income/expense/balance statistics. Filter by property, unit, tenant, status, or category.",
      inputSchema: {
        propertyId: z.number().int().optional().describe("Filter by property ID"),
        unitId: z.number().int().optional().describe("Filter by unit ID"),
        clientId: z.number().int().optional().describe("Filter by tenant/contact ID"),
        status: z.string().optional(),
        category: z.string().optional(),
      },
    },
    async ({ propertyId, unitId, clientId, status, category }) => {
      try {
        const stats = await client.financials.statistics(
          filterRecord({
            property_id: propertyId,
            unit_id: unitId,
            client_id: clientId,
            status,
            category,
          }),
        );
        return toolSuccess({ data: stats });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_transaction",
    {
      description:
        "Create a financial transaction (a charge/invoice or expense). Amount is in dollars. category is income or expense.",
      inputSchema: {
        amount: z.number().describe("Amount (dollars)"),
        category: z.string().describe("income, expense, refund, credits, or liability"),
        date: z.string().describe("Transaction date (YYYY-MM-DD)"),
        name: z.string().optional().describe("Line-item name / detail"),
        details: z.string().optional().describe("Description"),
        propertyId: z.number().int().optional(),
        unitId: z.number().int().optional(),
        clientId: z.number().int().optional().describe("Tenant/contact ID (the payer)"),
        accountId: z.number().int().optional().describe("Account ID to post against"),
      },
    },
    async ({ amount, category, date, name, details, propertyId, unitId, clientId, accountId }) => {
      try {
        const created = await client.financials.createTransaction(
          compact({
            amount,
            category,
            date,
            name,
            details,
            property_id: propertyId,
            unit_id: unitId,
            client_id: clientId,
            account_id: accountId,
          }),
        );
        return toolSuccess({ created: true, transaction: created });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_transaction",
    {
      description: "Update fields on an existing transaction.",
      inputSchema: {
        id: z.number().int().describe("Transaction ID"),
        amount: z.number().optional(),
        name: z.string().optional(),
        details: z.string().optional(),
        date: z.string().optional().describe("YYYY-MM-DD"),
        status: z.string().optional(),
      },
    },
    async ({ id, amount, name, details, date, status }) => {
      try {
        const updated = await client.financials.updateTransaction(
          id,
          compact({ amount, name, details, date, status }),
        );
        return toolSuccess({ updated: true, transaction: updated });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "delete_transaction",
    {
      description: "Delete a transaction by ID.",
      inputSchema: { id: z.number().int().describe("Transaction ID") },
    },
    async ({ id }) => {
      try {
        await client.financials.deleteTransaction(id);
        return toolSuccess({ deleted: true, id });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_recurring_transactions",
    {
      description: "List recurring transactions (scheduled rent charges, recurring expenses).",
      inputSchema: { page: pageParam },
    },
    async ({ page }) => {
      try {
        const { items, pagination } = await client.financials.listRecurring({ page });
        const result = await enrich({ data: items, count: items.length }, cache);
        return toolSuccess({ ...result, pagination });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_payments",
    {
      description: "List recorded payments. Filter by tenant (client) or property.",
      inputSchema: {
        clientId: z.number().int().optional().describe("Filter by tenant/contact ID"),
        propertyId: z.number().int().optional().describe("Filter by property ID"),
        page: pageParam,
      },
    },
    async ({ clientId, propertyId, page }) => {
      try {
        const { items, pagination } = await client.financials.listPayments(
          filterRecord({ client_id: clientId, property_id: propertyId }),
          { page },
        );
        const result = await enrich({ data: items, count: items.length }, cache);
        return toolSuccess({ ...result, pagination });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_reconciliation_accounts",
    {
      description: "List bank accounts available for reconciliation.",
      inputSchema: {},
    },
    async () => {
      try {
        const { items } = await client.financials.reconciliationBankAccounts();
        return toolSuccess({ data: items, count: items.length });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "owner_balances",
    {
      description: "Get owner balance statistics (amounts owed to/by property owners).",
      inputSchema: {},
    },
    async () => {
      try {
        return toolSuccess(await client.financials.ownerBalances());
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
