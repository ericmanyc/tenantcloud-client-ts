import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TcClient } from "tenantcloud-client";
import { compact, toolError, toolSuccess } from "./helpers.js";

/**
 * Tools that surface write methods already implemented on the typed clients
 * (leasing, financials, maintenance) but not previously exposed via MCP.
 */
export function registerExtraWriteTools(server: McpServer, client: TcClient): void {
  // --- Leasing writes ---

  server.registerTool(
    "create_lease",
    {
      description: "Create a lease for a unit and tenant.",
      inputSchema: {
        unitId: z.number().int().describe("Unit ID"),
        tenantId: z.number().int().optional().describe("Tenant/contact ID (user_client_id)"),
        propertyId: z.number().int().optional().describe("Property ID"),
        rentFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        rentTo: z.string().optional().describe("End date (YYYY-MM-DD); omit for month-to-month"),
        amount: z.number().optional().describe("Monthly rent amount"),
        deposit: z.number().optional().describe("Security deposit"),
        name: z.string().optional().describe("Lease name"),
      },
    },
    async ({ unitId, tenantId, propertyId, rentFrom, rentTo, amount, deposit, name }) => {
      try {
        const lease = await client.leasing.createLease(
          compact({
            unit_id: unitId,
            user_client_id: tenantId,
            property_id: propertyId,
            rent_from: rentFrom,
            rent_to: rentTo,
            amount,
            deposit,
            name,
          }),
        );
        return toolSuccess({ created: true, lease });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "add_lease_roommate",
    {
      description: "Add a roommate to a lease.",
      inputSchema: {
        leaseId: z.number().int().describe("Lease ID"),
        firstName: z.string().describe("Roommate first name"),
        lastName: z.string().optional(),
        email: z.string().optional(),
      },
    },
    async ({ leaseId, firstName, lastName, email }) => {
      try {
        const roommate = await client.leasing.addRoommate(
          compact({ lease_id: leaseId, firstName, lastName, email }),
        );
        return toolSuccess({ added: true, roommate });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_lease_notice",
    {
      description:
        "Create a notice on a lease (e.g. late rent, lease violation, notice to vacate). Generates a document for the tenant.",
      inputSchema: {
        leaseId: z.number().int().describe("Lease ID"),
        type: z.string().optional().describe("Notice type"),
        text: z.string().optional().describe("Notice body / reason"),
      },
    },
    async ({ leaseId, type, text }) => {
      try {
        const notice = await client.leasing.createNotice(leaseId, compact({ type, text }));
        return toolSuccess({ created: true, notice });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_application",
    {
      description: "Create a rental application for a property/unit.",
      inputSchema: {
        propertyId: z.number().int().optional(),
        unitId: z.number().int().optional(),
        tenantId: z.number().int().optional().describe("Applicant contact ID"),
      },
    },
    async ({ propertyId, unitId, tenantId }) => {
      try {
        const application = await client.leasing.createApplication(
          compact({ property_id: propertyId, unit_id: unitId, tenant_id: tenantId }),
        );
        return toolSuccess({ created: true, application });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "submit_application",
    {
      description: "Submit a draft rental application.",
      inputSchema: { id: z.number().int().describe("Application ID") },
    },
    async ({ id }) => {
      try {
        const result = await client.leasing.submitApplication(id);
        return toolSuccess({ submitted: true, result });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_screening",
    {
      description:
        "Order a tenant screening (background/credit check) for an application. This may incur a fee.",
      inputSchema: {
        applicationId: z.number().int().describe("Application ID"),
        packageType: z.string().optional().describe("Screening package type"),
      },
    },
    async ({ applicationId, packageType }) => {
      try {
        const screening = await client.leasing.createScreening(
          compact({ application_id: applicationId, package_type: packageType }),
        );
        return toolSuccess({ created: true, screening });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "cancel_screening",
    {
      description: "Cancel a tenant screening.",
      inputSchema: { id: z.number().int().describe("Screening ID") },
    },
    async ({ id }) => {
      try {
        const result = await client.leasing.cancelScreening(id);
        return toolSuccess({ cancelled: true, result });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // --- Financials writes ---

  server.registerTool(
    "record_payment",
    {
      description: "Record a payment received against a tenant's balance or a specific invoice.",
      inputSchema: {
        amount: z.number().describe("Payment amount"),
        clientId: z.number().int().optional().describe("Tenant/contact ID who paid"),
        date: z.string().optional().describe("Payment date (YYYY-MM-DD)"),
        transactionId: z.number().int().optional().describe("Invoice/transaction ID being paid"),
        propertyId: z.number().int().optional(),
        method: z.string().optional().describe("Payment method (cash, check, etc.)"),
      },
    },
    async ({ amount, clientId, date, transactionId, propertyId, method }) => {
      try {
        const payment = await client.financials.recordPayment(
          compact({
            amount,
            client_id: clientId,
            date,
            transaction_id: transactionId,
            property_id: propertyId,
            method,
          }),
        );
        return toolSuccess({ recorded: true, payment });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_recurring_transaction",
    {
      description: "Create a recurring transaction (e.g. monthly rent charge or recurring expense).",
      inputSchema: {
        amount: z.number().describe("Amount"),
        category: z.string().describe("income, expense, refund, credits, or liability"),
        propertyId: z.number().int().optional(),
        unitId: z.number().int().optional(),
        clientId: z.number().int().optional().describe("Tenant/contact ID"),
        day: z.number().int().optional().describe("Day of month to post (1-31)"),
        startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        details: z.string().optional(),
      },
    },
    async ({ amount, category, propertyId, unitId, clientId, day, startDate, details }) => {
      try {
        const recurring = await client.financials.createRecurring(
          compact({
            amount,
            category,
            property_id: propertyId,
            unit_id: unitId,
            client_id: clientId,
            day,
            start_date: startDate,
            details,
          }),
        );
        return toolSuccess({ created: true, recurring });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // --- Maintenance writes ---

  server.registerTool(
    "add_maintenance_material",
    {
      description: "Add a material/part line item to a maintenance request.",
      inputSchema: {
        requestId: z.number().int().describe("Maintenance request ID"),
        name: z.string().describe("Material name"),
        cost: z.number().optional().describe("Unit cost"),
        quantity: z.number().optional().describe("Quantity"),
      },
    },
    async ({ requestId, name, cost, quantity }) => {
      try {
        const material = await client.maintenance.addMaterial(
          requestId,
          compact({ name, cost, quantity }),
        );
        return toolSuccess({ added: true, material });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
