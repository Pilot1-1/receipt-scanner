import { currentSession } from "./auth";
import { getConfig } from "./config";
import { prepareImage } from "./image";

export class SessionExpiredError extends Error {}

async function call(path, { method = "GET", body } = {}) {
  const session = await currentSession();
  if (!session) throw new SessionExpiredError("Your session has expired. Sign in again.");

  const response = await fetch(getConfig().apiUrl + path, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) throw new SessionExpiredError("Your session has expired. Sign in again.");

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}

export const listReceipts = async () => (await call("/receipts")).receipts;

/** Resize the photo, ask the API for a one-time upload link, then send the photo straight to S3. */
export async function uploadReceipt(file) {
  const { blob, contentType } = await prepareImage(file);
  const { uploadUrl } = await call("/upload-url", { method: "POST", body: { contentType } });

  // Content-Type must equal the one the link was signed for, or S3 rejects the upload.
  const response = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!response.ok) throw new Error(`Upload to storage failed (${response.status})`);
}

/** A temporary link (valid for a few minutes) to the original photo of one receipt. */
export const getReceiptImage = async (id) => (await call(`/receipts/${id}/image`)).url;

/** Fix what the model got wrong: any of { store, date, total, currency, category }. */
export const updateReceipt = (id, changes) => call(`/receipts/${id}`, { method: "PATCH", body: changes });

/** Removes the receipt and its photo. */
export const deleteReceipt = (id) => call(`/receipts/${id}`, { method: "DELETE" });

/** Monthly limits as { EUR: { food: 200, ... }, KZT: { ... } }. */
export const getBudgets = async () => (await call("/budgets")).budgets;

/** Sets the limits of one currency: { food: 200, bills: null } (null or 0 removes a limit). Returns all budgets. */
export const saveBudgets = async (currency, limits) =>
  (await call("/budgets", { method: "PUT", body: { currency, limits } })).budgets;
