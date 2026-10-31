import { useEffect, useMemo, useRef, useState } from "react";
import { SessionExpiredError, deleteReceipt, getReceiptImage, updateReceipt } from "../lib/api";
import { CATEGORIES, formatMoney, shortDay, titleCase } from "../lib/stats";
import { checkLines, formatChange, lineId, perUnit, summarizeComparison } from "../lib/prices";

function Change({ line, currency }) {
  if (!line) return <span className="muted" title="Free or unreadable lines are not compared">–</span>;
  const { trend, previous, cheapest } = line;
  return (
    <span className={`change ${trend}`}>
      {trend === "up" && `↑ ${formatChange(line.change)}`}
      {trend === "down" && `↓ ${formatChange(line.change)}`}
      {trend === "same" && "≈ same"}
      {trend === "new" && "first time"}
      {previous && (
        <small>was {formatMoney(previous.unitPrice, currency)} · {previous.store} · {shortDay(previous.day)}</small>
      )}
      {cheapest && cheapest.receiptId !== previous?.receiptId && ( // not the same purchase as "was …"
        <small>
          cheaper at {cheapest.store}: {formatMoney(cheapest.unitPrice, currency)} · {shortDay(cheapest.day)}
        </small>
      )}
    </span>
  );
}

/**
 * One receipt in a window: the products on it and how each price compares with earlier purchases.
 * From here the person can look at the original photo, correct what the model got wrong, or delete the receipt.
 */
export default function ReceiptDetail({ receipt, lines, onClose, onSaved, onDeleted, onExpired }) {
  const dialog = useRef(null);
  const [mode, setMode] = useState("view"); // "view" | "edit" | "delete"
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState({ state: "closed", url: "", error: "" });

  // A native <dialog> gives focus handling and the Escape key for free.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element && element.open) element.close(); };
  }, []);

  const currency = receipt.currency || "?";
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const byId = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const summary = useMemo(() => summarizeComparison(lines), [lines]);
  const check = checkLines(receipt);
  const day = shortDay(receipt.date || (receipt.createdAt || "").slice(0, 10));

  // A failed request: an expired session sends the person back to sign-in, anything else is shown in the window.
  function fail(failure) {
    if (failure instanceof SessionExpiredError) onExpired();
    else setError(failure.message);
  }

  async function togglePhoto() {
    if (photo.state === "loading") return;
    if (photo.state !== "closed") return setPhoto({ state: "closed", url: "", error: "" });
    setPhoto({ state: "loading", url: "", error: "" });
    try {
      setPhoto({ state: "ready", url: await getReceiptImage(receipt.receiptId), error: "" });
    } catch (failure) {
      if (failure instanceof SessionExpiredError) onExpired();
      else setPhoto({ state: "error", url: "", error: failure.message });
    }
  }

  function startEdit() {
    setForm({
      store: receipt.store || "",
      date: receipt.date || "",
      total: String(receipt.total),
      currency: receipt.currency || "",
      category: CATEGORIES[receipt.category] ? receipt.category : "other",
    });
    setError("");
    setMode("edit");
  }

  async function save(event) {
    event.preventDefault();
    const total = Number(form.total.trim().replace(",", "."));
    if (form.total.trim() === "" || !Number.isFinite(total)) return setError("Enter the total as a number, for example 12.50.");
    const code = form.currency.trim().toUpperCase();
    if (code && !/^[A-Z]{3}$/.test(code)) return setError("The currency is a 3-letter code, for example EUR.");

    setBusy(true);
    setError("");
    try {
      await updateReceipt(receipt.receiptId, {
        store: form.store.trim() || null,
        date: form.date || null,
        total,
        currency: code || null,
        category: form.category,
      });
      await onSaved(); // reload the list: the new numbers flow into totals, charts and price history
      setMode("view");
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deleteReceipt(receipt.receiptId);
      onDeleted(receipt.receiptId); // the window closes with the receipt
    } catch (failure) {
      fail(failure);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="detail"
      aria-labelledby="detail-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClick={(event) => { if (event.target === dialog.current && !busy) onClose(); }} // a click on the dimmed backdrop
    >
      <div className="detail-body">
        {mode === "edit" ? (
          <form className="edit-form" onSubmit={save}>
            <h2 id="detail-title">Edit receipt</h2>
            <label className="wide">
              Store
              <input value={form.store} maxLength={100} onChange={(e) => setForm({ ...form, store: e.target.value })} />
            </label>
            <label>
              Date
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label>
              Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.keys(CATEGORIES).map((name) => <option key={name} value={name}>{titleCase(name)}</option>)}
              </select>
            </label>
            <label>
              Total
              <input inputMode="decimal" required value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
            </label>
            <label>
              Currency
              <input
                value={form.currency} maxLength={3} placeholder="EUR"
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              />
            </label>
            <p className="note wide">The product lines are kept as they were read. If they no longer add up to the total, a note will tell you.</p>
            {error && <p className="error wide" role="alert">{error}</p>}
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
              <button type="button" className="ghost" disabled={busy} onClick={() => { setMode("view"); setError(""); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <div className="detail-head">
              <div>
                <h2 id="detail-title">{receipt.store || "Unknown store"}</h2>
                <p className="muted detail-sub">
                  {day}
                  <span className="pill">
                    <i style={{ background: CATEGORIES[receipt.category] || CATEGORIES.other }} />
                    {receipt.category}
                  </span>
                  {receipt.edited && <span className="pill" title="You corrected this receipt by hand">edited</span>}
                </p>
              </div>
              <p className="amount detail-total">{formatMoney(receipt.total, currency)}</p>
              <button className="ghost" onClick={onClose}>Close</button>
            </div>

            {mode === "delete" ? (
              <div className="confirm" role="alertdialog" aria-label="Confirm delete">
                <p>Delete this receipt and its photo? This cannot be undone.</p>
                <div className="form-actions">
                  <button className="primary danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete receipt"}</button>
                  <button className="ghost" disabled={busy} onClick={() => { setMode("view"); setError(""); }}>Keep it</button>
                </div>
              </div>
            ) : (
              <div className="detail-actions">
                <button className="ghost" aria-expanded={photo.state !== "closed"} onClick={togglePhoto}>
                  {photo.state === "closed" ? "Show photo" : "Hide photo"}
                </button>
                <button className="ghost" onClick={startEdit}>Edit</button>
                <button className="ghost danger" onClick={() => { setError(""); setMode("delete"); }}>Delete</button>
              </div>
            )}
            {error && <p className="error" role="alert">{error}</p>}

            {photo.state !== "closed" && (
              <div className="photo-panel">
                {photo.state === "loading" && <p className="muted">Loading the photo…</p>}
                {photo.state === "error" && <p className="error" role="alert">{photo.error}</p>}
                {photo.state === "ready" && (
                  <>
                    <img
                      src={photo.url} alt={`Photo of the receipt from ${receipt.store || "an unknown store"}`}
                      onError={() => setPhoto({ state: "error", url: "", error: "The photo could not be loaded. Close it and try again." })}
                    />
                    <a className="link" href={photo.url} target="_blank" rel="noopener noreferrer">Open full size</a>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {items.length === 0 ? (
          <p className="empty">
            No products were saved for this receipt. Product lines are stored for receipts read after this
            feature was added, and only when they were readable on the photo.
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="lines">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Qty</th>
                    <th className="num">Unit price</th>
                    <th className="num">Total</th>
                    <th>Since last time</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={`${index}-${item.name}`}>
                      <td className="name">{item.name}</td>
                      <td className="num">{item.quantity}{item.unit ? ` ${item.unit}` : ""}</td>
                      <td className="num">{formatMoney(item.unitPrice ?? item.price, currency)}{perUnit(item.unit)}</td>
                      <td className="num">{formatMoney(item.price, currency)}</td>
                      <td><Change line={byId.get(lineId(item))} currency={currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {summary.compared > 0 ? (
              <div className="detail-summary">
                <span>Compared with the last time you bought each product:</span>
                {summary.up > 0 && <span className="chip up">↑ {summary.up} dearer</span>}
                {summary.down > 0 && <span className="chip down">↓ {summary.down} cheaper</span>}
                {summary.up === 0 && summary.down === 0 && <span className="chip">no change</span>}
                {Math.abs(summary.saved) >= 0.01 && (
                  <span>
                    {formatMoney(Math.abs(summary.saved), currency)} {summary.saved > 0 ? "less" : "more"} than at your last prices
                  </span>
                )}
              </div>
            ) : (
              <p className="note detail-summary">
                You have not bought these products before, so there is nothing to compare yet. Add more receipts
                from the same shop.
              </p>
            )}

            {check && !check.ok && (
              <p className="note">
                The lines add up to {formatMoney(check.sum, currency)}, but the receipt total is{" "}
                {formatMoney(check.total, currency)}. {receipt.edited ? "You changed the total by hand, or some" : "Some"} lines may be missing from the photo reading.
              </p>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
