import { useState } from "react";

/**
 * "Delete" for a row that cannot be opened, such as a receipt that could not be read: it asks once, then deletes.
 * `onDelete` returns a promise; when it succeeds the row disappears, so nothing is updated afterwards.
 */
export default function RowDelete({ onDelete, label = "Delete" }) {
  const [state, setState] = useState("idle"); // "idle" | "confirm" | "busy"
  const [error, setError] = useState("");

  async function confirm() {
    setState("busy");
    setError("");
    try {
      await onDelete();
    } catch (failure) {
      setError(failure.message);
      setState("confirm");
    }
  }

  if (state === "idle") {
    return <button type="button" className="link row-delete" aria-label={label} onClick={() => setState("confirm")}>Delete</button>;
  }
  return (
    <span className="row-delete-confirm" role="group" aria-label="Confirm delete">
      <button type="button" className="link danger-link" disabled={state === "busy"} onClick={confirm}>
        {state === "busy" ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" className="link" disabled={state === "busy"} onClick={() => { setState("idle"); setError(""); }}>Keep</button>
      {error && <span className="error" role="alert">{error}</span>}
    </span>
  );
}
