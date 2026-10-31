import { useRef, useState } from "react";
import { uploadReceipt } from "../lib/api";

/** Always visible above the tabs: a photo can be added from any screen. */
export default function Uploader({ onUploaded }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState({ busy: false, text: "", error: "" });

  async function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const errors = [];
    for (const [index, file] of files.entries()) {
      setStatus({ busy: true, text: `Uploading ${index + 1} of ${files.length}…`, error: "" });
      try {
        await uploadReceipt(file);
        await onUploaded(); // the new receipt shows up as "Reading…" right away
      } catch (error) {
        errors.push(error.message);
      }
    }
    setStatus({ busy: false, text: "", error: errors.join(" ") });
  }

  const drop = (event) => {
    event.preventDefault();
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  return (
    <section
      className={`panel upload upload-bar${dragging ? " is-dragging" : ""}`}
      aria-labelledby="add-receipt"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <div className="upload-text">
        <h2 id="add-receipt">Add a receipt</h2>
        <p className="muted">Take a photo or drop one here. Make sure the total is in frame and readable.</p>
        {status.error && <p className="error" role="alert">{status.error}</p>}
      </div>

      <input
        ref={input} type="file" hidden multiple accept="image/jpeg,image/png,image/webp"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />
      <button className="primary" disabled={status.busy} onClick={() => input.current.click()}>
        {status.busy ? status.text : "Choose photos"}
      </button>
    </section>
  );
}
