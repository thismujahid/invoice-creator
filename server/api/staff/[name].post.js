import { createError, defineEventHandler, getHeader, getRouterParam, readBody } from "h3";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const operations = new Set([
  "getCashierCatalog",
  "getCashierInvoices",
  "getCashierInvoice",
  "getCashierInvoiceReturns",
  "getCashierReturnJournal",
  "getCashierCustomers",
  "getCustomerCredit",
  "payCustomerCredit",
  "getCashierCashSummary",
  "getCashierDebts",
  "getCashierDebtBook",
  "getCashierPayments",
  "getCustomerHistory",
  "createStaffCustomer",
  "createStaffLoan",
  "createStaffSale",
  "payStaffDebts",
  "getStaffReturnPreview",
  "createStaffReturn",
  "createStaffSupplierReturn",
  "deleteStaffInvoice",
  "updateStaffInvoice",
  "saveInventoryProduct",
  "archiveInventoryProduct",
  "unarchiveInventoryProduct",
  "adjustInventoryBucket",
  "executeInventoryPurchase",
  "applyInventoryCostRepair",
  "factoryReset",
]);

const statuses = {
  "invalid-argument": 400,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  "failed-precondition": 409,
  "resource-exhausted": 429,
};

function serializeResult(value) {
  if (Array.isArray(value)) return value.map(serializeResult);
  if (value && typeof value === "object") {
    if (typeof value.toDate === "function" && typeof value.seconds === "number") {
      return { seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeResult(item)]));
  }
  return value;
}

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, "name");
  if (!operations.has(name)) throw createError({ statusCode: 404, statusMessage: "Operation not found." });

  const authorization = getHeader(event, "authorization") || "";
  const match = /^Bearer (\S+)$/.exec(authorization);
  if (!match) throw createError({ statusCode: 401, statusMessage: "Sign in first." });

  const data = await readBody(event);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid request." });
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw createError({ statusCode: 503, statusMessage: "The staff service is not configured." });
  }

  let runtime;
  try {
    runtime = import.meta.dev
      ? await import(pathToFileURL(resolve(process.cwd(), "functions/runtime.cjs")).href)
      : await import("../../../functions/runtime.cjs");
  } catch {
    throw createError({ statusCode: 503, statusMessage: "The staff service is unavailable." });
  }

  let auth;
  try {
    auth = await runtime.default.getAuth().verifyIdToken(match[1], true);
  } catch {
    throw createError({ statusCode: 401, statusMessage: "Authentication failed." });
  }

  try {
    let staff;
    if (import.meta.dev) {
      const require = createRequire(pathToFileURL(resolve(process.cwd(), "package.json")));
      const staffPath = require.resolve(name === "factoryReset" ? "./functions/index.cjs" : "./functions/staff.cjs");
      const actionsPath = require.resolve("./functions/staffInvoiceActions.cjs");
      delete require.cache[staffPath];
      delete require.cache[actionsPath];
      delete require.cache[require.resolve("./functions/inventoryOperations.cjs")];
      delete require.cache[require.resolve("./functions/staffMath.cjs")];
      staff = require(staffPath);
    } else {
      staff = name === "factoryReset"
        ? (await import("../../../functions/index.cjs")).default
        : (await import("../../../functions/staff.cjs")).default;
    }
    const result = await staff[name].run({ data, auth: { uid: auth.uid, token: auth } });
    return serializeResult(result);
  } catch (error) {
    const code = String(error?.code || "").replace(/^functions\//, "");
    if (code in statuses) {
      throw createError({ statusCode: statuses[code], statusMessage: "Request rejected", data: { code, userMessage: error.message } });
    }
    throw createError({ statusCode: 500, statusMessage: "The operation could not be completed." });
  }
});
