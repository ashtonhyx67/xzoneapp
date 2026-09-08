import React, { useRef, useState } from "react";
import { api } from "../api.js";

// Reads the file in the browser and posts its text, so importing a spreadsheet
// needs nothing but the app itself.
export default function ImportPeople({ token, onImported }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function handleFile(event) {
    const file = event.target.files?.[0];
    // Let the same file be chosen again after a failed attempt.
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError("");
    setResult(null);

    try {
      const csv = await file.text();
      const summary = await api.importPeople(token, csv);
      setResult(summary);
      onImported?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel import-panel">
      <div className="panel-row">
        <div className="panel-title">Import from a spreadsheet</div>
        <button
          className="btn btn-secondary btn-inline"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Importing…" : "Choose CSV file"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        hidden
      />

      <ol className="import-steps">
        <li>Open your Google Sheet and click the Data tab.</li>
        <li>File → Download → Comma-separated values (.csv).</li>
        <li>Choose that file above.</li>
      </ol>

      {error && <div className="error-banner panel-notice">{error}</div>}

      {result && (
        <div className="success-banner panel-notice">
          <strong>
            {result.created} added, {result.updated} updated.
          </strong>
          {result.ignored?.length > 0 && (
            <div className="import-detail">
              Columns skipped: {result.ignored.join(", ")}
            </div>
          )}
          {result.warnings?.map((warning) => (
            <div className="import-detail" key={warning}>
              {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
