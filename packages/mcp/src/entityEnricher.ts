import type { EntityCache } from "./entityCache.js";

/**
 * Appends a `references` lookup table to a tool result object, mapping
 * foreign-key IDs (propertyId, unitId, tenantId/payerId) found in `data`
 * to human-readable names.
 */
export async function enrich(
  result: { data: Array<Record<string, unknown>>; count: number },
  cache: EntityCache,
): Promise<Record<string, unknown>> {
  const propertyIds = collectIds(result.data, "propertyId");
  const unitIds = collectIds(result.data, "unitId");
  const contactIds = collectIds(result.data, "tenantId");
  for (const id of collectIds(result.data, "payerId")) {
    contactIds.add(id);
  }

  const references: Record<string, Record<string, string>> = {};

  await addReferences(references, "properties", propertyIds, (id) => cache.getPropertyName(id));
  await addReferences(references, "units", unitIds, async (id) => {
    const unit = await cache.getUnit(id);
    if (!unit) {
      return null;
    }
    const propertyName = await cache.getPropertyName(unit.propertyId);
    return propertyName ? `${unit.name} (${propertyName})` : unit.name;
  });
  await addReferences(references, "contacts", contactIds, (id) => cache.getContactName(id));

  return Object.keys(references).length > 0 ? { ...result, references } : { ...result };
}

function collectIds(data: Array<Record<string, unknown>>, field: string): Set<number> {
  const ids = new Set<number>();
  for (const item of data) {
    const value = item[field];
    if (typeof value === "number") {
      ids.add(value);
    }
  }
  return ids;
}

async function addReferences(
  references: Record<string, Record<string, string>>,
  sectionName: string,
  ids: Set<number>,
  resolver: (id: number) => Promise<string | null>,
): Promise<void> {
  if (ids.size === 0) {
    return;
  }

  const section: Record<string, string> = {};
  for (const id of ids) {
    const name = await resolver(id);
    if (name !== null) {
      section[String(id)] = name;
    }
  }

  if (Object.keys(section).length > 0) {
    references[sectionName] = section;
  }
}
