// CSV export of the receipts currently shown on the Receipts tab.
import { isoDay, statusOf } from "./stats";

const HEADER = ["Date", "Store", "Category", "Total", "Currency", "Status", "Products", "Receipt ID"];

// Excel in many countries (for example Russian or German settings) expects ";" between columns and
// "," in numbers; elsewhere it expects "," and ".". Follow the browser's locale so the file opens correctly.
const decimalSeparator = () =>
  new Intl.NumberFormat().formatToParts(1.1).find((part) => part.type === "decimal")?.value || ".";

/** Text from a receipt photo is untrusted: a store called "=HYPERLINK(...)" must not run as a formula. */
const safeText = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

export function receiptsToCsv(receipts) {
  const decimal = decimalSeparator();
  const delimiter = decimal === "," ? ";" : ",";
  const quote = (text) =>
    /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;

  const rows = receipts.map((r) => [
    safeText(r.date || (r.createdAt || "").slice(0, 10)),
    safeText(r.store),
    safeText(r.category),
    typeof r.total === "number" ? String(r.total).replace(".", decimal) : "",
    safeText(r.currency),
    statusOf(r),
    String((r.items || []).length),
    safeText(r.receiptId),
  ]);
  return [HEADER, ...rows].map((row) => row.map(quote).join(delimiter)).join("\r\n");
}

export function downloadCsv(csv, name = `receipts-${isoDay(new Date())}.csv`) {
  // The BOM makes Excel read the file as UTF-8 (Cyrillic store names stay readable).
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
