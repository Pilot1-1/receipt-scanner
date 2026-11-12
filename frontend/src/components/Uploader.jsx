import { useRef, useState } from "react";
import { uploadReceipt } from "../lib/api";

/** Always visible above the tabs: take a photo, or choose a photo or a PDF, from any screen. */
export default function Uploader({ onUploaded }) {
  const input = useRef(null);
  const camera = useRef(null);
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

  const pick = (event) => {
    handleFiles(event.target.files);
    event.target.value = ""; // the same file can be chosen again
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
        <p className="muted">Take a photo, or choose a photo or a PDF receipt (for example from Kaspi). Make sure the total is readable.</p>
        {status.error && <p className="error" role="alert">{status.error}</p>}
      </div>

      {/* capture="environment" opens the back camera straight away on a phone;
          on a computer it falls back to the normal file dialog. */}
      <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={pick} />
      <input
        ref={input} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={pick}
      />

      <div className="form-actions">
        <button className="primary" disabled={status.busy} onClick={() => camera.current.click()}>
          {status.busy ? status.text : "Take a photo"}
        </button>
        <button className="ghost" disabled={status.busy} onClick={() => input.current.click()}>
          Choose files
        </button>
      </div>
    </section>
  );
}
