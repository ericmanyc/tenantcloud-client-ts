import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TcClient } from "tenantcloud-client";
import type { EntityCache } from "../entityCache.js";
import { enrich } from "../entityEnricher.js";
import { compact, maxResultsParam, toolError, toolSuccess } from "./helpers.js";

/**
 * Portfolio tools: Keys & Locks and Equipment, both shown under a property in
 * TenantCloud. Keys hold door/lockbox codes; equipment tracks appliances, HVAC,
 * meters, etc. against a property or unit.
 */
export function registerPortfolioTools(server: McpServer, client: TcClient, cache: EntityCache): void {
  // --- Keys & Locks ---

  server.registerTool(
    "list_property_keys",
    {
      description:
        "List Keys & Locks for a property (door codes, lockbox codes, physical keys). The actual codes are usually in the 'comment' field. Each key has a numeric 'type' plus a human-readable 'typeLabel' (e.g. Main door, Mailbox, Garage). Filter by property.",
      inputSchema: {
        propertyId: z.number().int().optional().describe("Filter by property ID"),
        maxResults: maxResultsParam,
      },
    },
    async ({ propertyId, maxResults }) => {
      try {
        const items = await client.portfolio.keys.listAll(maxResults ?? 100, { propertyId });
        return toolSuccess({ data: items, count: items.length });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_property_key",
    {
      description: "Add a Keys & Locks entry to a property (e.g. a door code or lockbox).",
      inputSchema: {
        propertyId: z.number().int().describe("Property ID the key belongs to"),
        keyname: z.string().describe("Label for the key/lock, e.g. 'Front Gate'"),
        comment: z.string().optional().describe("Notes/details - this is where the lockbox/door code typically goes"),
        type: z
          .number()
          .int()
          .optional()
          .describe(
            "Key type: 1=Main door, 2=Security door, 3=Mailbox, 4=Trash area, 5=Laundry room, 6=Inside door, 7=Roof, 8=Basement, 9=Boiler room, 10=Storage, 11=Common area, 12=Garage, 13=Other (defaults to 1)",
          ),
      },
    },
    async ({ propertyId, keyname, comment, type }) => {
      try {
        const created = await client.portfolio.keys.create(
          compact({ property_id: propertyId, keyname, comment, type }),
        );
        return toolSuccess({ created: true, key: created });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_property_key",
    {
      description: "Update an existing Keys & Locks entry.",
      inputSchema: {
        id: z.number().int().describe("Key ID"),
        keyname: z.string().optional(),
        comment: z.string().optional().describe("Notes/details (where the code lives)"),
        type: z
          .number()
          .int()
          .optional()
          .describe(
            "Key type: 1=Main door, 2=Security door, 3=Mailbox, 4=Trash area, 5=Laundry room, 6=Inside door, 7=Roof, 8=Basement, 9=Boiler room, 10=Storage, 11=Common area, 12=Garage, 13=Other",
          ),
      },
    },
    async ({ id, keyname, comment, type }) => {
      try {
        const updated = await client.portfolio.keys.update(id, compact({ keyname, comment, type }));
        return toolSuccess({ updated: true, key: updated });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "delete_property_key",
    {
      description: "Delete a Keys & Locks entry by ID.",
      inputSchema: { id: z.number().int().describe("Key ID") },
    },
    async ({ id }) => {
      try {
        await client.portfolio.keys.delete(id);
        return toolSuccess({ deleted: true, id });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // --- Equipment ---

  server.registerTool(
    "list_equipment",
    {
      description:
        "List equipment/appliances tracked against properties (HVAC, water heaters, meters, etc.). Filter by property or unit.",
      inputSchema: {
        propertyId: z.number().int().optional().describe("Filter by property ID"),
        unitId: z.number().int().optional().describe("Filter by unit ID"),
        categoryId: z.number().int().optional().describe("Filter by equipment category ID"),
        maxResults: maxResultsParam,
      },
    },
    async ({ propertyId, unitId, categoryId, maxResults }) => {
      try {
        const items = await client.portfolio.equipment.listAll(maxResults ?? 100, {
          propertyId,
          unitId,
          categoryId,
        });
        const result = await enrich(
          { data: items as unknown as Array<Record<string, unknown>>, count: items.length },
          cache,
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_equipment",
    {
      description: "Add an equipment record to a property or unit.",
      inputSchema: {
        propertyId: z.number().int().describe("Property ID the equipment belongs to"),
        unitId: z.number().int().optional().describe("Unit ID, if unit-specific"),
        categoryId: z.number().int().optional().describe("Equipment category ID"),
        make: z.string().optional().describe("Manufacturer/brand"),
        modelNumber: z.string().optional(),
        vinNumber: z.string().optional().describe("Serial/VIN identifier"),
        price: z.number().optional(),
        installDate: z.string().optional().describe("Install date (YYYY-MM-DD)"),
        warrantyExpirationDate: z.string().optional().describe("Warranty expiration (YYYY-MM-DD)"),
        lifeTimeWarranty: z.boolean().optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const created = await client.portfolio.equipment.create(
          compact({
            property_id: args.propertyId,
            unit_id: args.unitId,
            category_id: args.categoryId,
            make: args.make,
            model_number: args.modelNumber,
            vin_number: args.vinNumber,
            price: args.price,
            install_date: args.installDate,
            warranty_expiration_date: args.warrantyExpirationDate,
            life_time_warranty: args.lifeTimeWarranty,
            notes: args.notes,
          }),
        );
        return toolSuccess({ created: true, equipment: created });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_equipment",
    {
      description: "Update fields on an existing equipment record.",
      inputSchema: {
        id: z.number().int().describe("Equipment ID"),
        unitId: z.number().int().optional(),
        categoryId: z.number().int().optional(),
        make: z.string().optional(),
        modelNumber: z.string().optional(),
        vinNumber: z.string().optional(),
        price: z.number().optional(),
        installDate: z.string().optional().describe("Install date (YYYY-MM-DD)"),
        warrantyExpirationDate: z.string().optional().describe("Warranty expiration (YYYY-MM-DD)"),
        lifeTimeWarranty: z.boolean().optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const updated = await client.portfolio.equipment.update(
          args.id,
          compact({
            unit_id: args.unitId,
            category_id: args.categoryId,
            make: args.make,
            model_number: args.modelNumber,
            vin_number: args.vinNumber,
            price: args.price,
            install_date: args.installDate,
            warranty_expiration_date: args.warrantyExpirationDate,
            life_time_warranty: args.lifeTimeWarranty,
            notes: args.notes,
          }),
        );
        return toolSuccess({ updated: true, equipment: updated });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "delete_equipment",
    {
      description: "Delete an equipment record by ID.",
      inputSchema: { id: z.number().int().describe("Equipment ID") },
    },
    async ({ id }) => {
      try {
        await client.portfolio.equipment.delete(id);
        return toolSuccess({ deleted: true, id });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
