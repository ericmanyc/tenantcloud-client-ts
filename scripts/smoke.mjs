// Read-only end-to-end smoke test of the new client methods against the LIVE
// TenantCloud API, using the project's own secure token store (auto-refresh).
// Prints only structural results (counts/types/status) - never tokens or PII.
import { TcClient, SecureTokenStore } from "tenantcloud-client";
import { CdpTokenProvider } from "tenantcloud-client/cdp";

const provider = new CdpTokenProvider({ tokenStore: new SecureTokenStore() });
const client = new TcClient(provider);

const results = [];
async function check(name, fn) {
  try {
    const v = await fn();
    let summary;
    if (v == null) summary = "null";
    else if (Array.isArray(v)) summary = `array(${v.length})`;
    else if (Array.isArray(v.items)) summary = `items(${v.items.length})${v.total !== undefined ? `/total ${v.total}` : ""}`;
    else if (Array.isArray(v.data)) summary = `data(${v.data.length})`;
    else if (typeof v === "object") summary = `object{${Object.keys(v).slice(0, 6).join(",")}}`;
    else summary = String(v);
    results.push(`OK   ${name} -> ${summary}`);
  } catch (e) {
    results.push(`FAIL ${name} -> ${e?.httpStatus ?? ""} ${String(e?.message ?? e).slice(0, 90)}`);
  }
}

const user = await client.getUserInfo().catch(() => null);
results.push(user ? `AUTH ok: ${user.firstName} ${user.lastName} <${user.email}>` : "AUTH FAILED (no token / refresh failed)");

if (user) {
  await check("productivity.listTasks", () => client.productivity.listTasks({ page: 1 }));
  await check("productivity.taskStatistics", () => client.productivity.taskStatistics());
  await check("productivity.listCalendarEvents", () => client.productivity.listCalendarEvents());
  await check("files.list", () => client.files.list({ page: 1 }));
  await check("files.statistics", () => client.files.statistics());
  await check("financials.statistics", () => client.financials.statistics({}));
  await check("financials.paymentStatistics", () => client.financials.paymentStatistics({}));
  await check("financials.listRecurring", () => client.financials.listRecurring({ page: 1 }));
  await check("financials.listPayments", () => client.financials.listPayments({}, { page: 1 }));
  await check("financials.accounts", () => client.financials.accounts());
  await check("financials.reconciliationBankAccounts", () => client.financials.reconciliationBankAccounts());
  await check("financials.ownerAgreements", () => client.financials.ownerAgreements({ page: 1 }));
  await check("financials.ownerBalances", () => client.financials.ownerBalances());
  await check("maintenance.list", () => client.maintenance.list({ page: 1 }));
  await check("maintenance.listInspectionItems", () => client.maintenance.listInspectionItems({ page: 1 }));
  await check("leasing.listApplications", () => client.leasing.listApplications({}, { page: 1 }));
  await check("leasing.listScreenings", () => client.leasing.listScreenings({}, { page: 1 }));
  await check("leasing.listLeads", () => client.leasing.listLeads({ page: 1 }));
  await check("crm.listInsurances", () => client.crm.listInsurances({ page: 1 }));
  await check("messaging.channels", () => client.messaging.channels());
  await check("messaging.threads(tenant)", () => client.messaging.threads("tenant", { page: 1 }));
}

console.log(results.join("\n"));
provider.dispose?.();
process.exit(0);
