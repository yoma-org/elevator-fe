"use client";

import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

type UploadMode = "buildings" | "equipment";

interface RowValidation {
  row: number;
  data: Record<string, string>;
  status: "valid" | "error" | "warning";
  message: string;
}

interface BatchResult {
  row: number;
  status: "created" | "error";
  message: string;
}

const BUILDING_COLUMNS = ["Building Name", "Building Code", "Address", "Contact Name", "Contact Phone"];
const EQUIPMENT_COLUMNS = ["Building Name", "Equipment Type", "Equipment Code", "Serial Number", "Brand", "Model", "Location"];

function downloadTemplate(mode: UploadMode) {
  const headers = mode === "buildings" ? BUILDING_COLUMNS : EQUIPMENT_COLUMNS;
  const sample = mode === "buildings"
    ? [["New Tower", "NT01", "123 Main St", "John Doe", "+95-1-234567"]]
    : [["YOMA Tower, Yangon", "Elevator", "ELV-010", "SN12345", "Mitsubishi", "NexWay", "Lobby"]];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  ws["!cols"] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, mode === "buildings" ? "Buildings" : "Equipment");
  XLSX.writeFile(wb, `${mode}_template.xlsx`);
}

function downloadErrorReport(results: BatchResult[]) {
  const errors = results.filter((r) => r.status === "error");
  if (!errors.length) return;
  const ws = XLSX.utils.json_to_sheet(errors.map((r) => ({ Row: r.row, Status: r.status, Message: r.message })));
  ws["!cols"] = [{ wch: 8 }, { wch: 10 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Errors");
  XLSX.writeFile(wb, `upload_errors_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function parseFile(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function validateRows(rows: Record<string, string>[], mode: UploadMode, buildings: string[]): RowValidation[] {
  const buildingSet = new Set(buildings.map((b) => b.toLowerCase()));

  return rows.map((data, i) => {
    const row = i + 1;

    if (mode === "buildings") {
      const name = data["Building Name"]?.trim();
      if (!name) return { row, data, status: "error", message: "Building Name is required" };
      return { row, data, status: "valid", message: "OK" };
    }

    // equipment
    const buildingName = data["Building Name"]?.trim();
    const eqType = data["Equipment Type"]?.trim();
    const eqCode = data["Equipment Code"]?.trim();

    if (!buildingName) return { row, data, status: "error", message: "Building Name is required" };
    if (!eqType) return { row, data, status: "error", message: "Equipment Type is required" };
    if (!eqCode) return { row, data, status: "error", message: "Equipment Code is required" };

    if (!buildingSet.has(buildingName.toLowerCase())) {
      return { row, data, status: "warning", message: `Building "${buildingName}" not found in system` };
    }

    return { row, data, status: "valid", message: "OK" };
  });
}

function mapRowToPayload(data: Record<string, string>, mode: UploadMode) {
  if (mode === "buildings") {
    return {
      name: data["Building Name"]?.trim() ?? "",
      code: data["Building Code"]?.trim() ?? "",
      address: data["Address"]?.trim() ?? "",
      contactName: data["Contact Name"]?.trim() ?? "",
      contactPhone: data["Contact Phone"]?.trim() ?? "",
    };
  }
  return {
    buildingName: data["Building Name"]?.trim() ?? "",
    equipmentType: data["Equipment Type"]?.trim() ?? "",
    equipmentCode: data["Equipment Code"]?.trim() ?? "",
    serialNumber: data["Serial Number"]?.trim() ?? "",
    brand: data["Brand"]?.trim() ?? "",
    model: data["Model"]?.trim() ?? "",
    location: data["Location"]?.trim() ?? "",
  };
}

interface Props {
  onClose: () => void;
  onDone: () => void;
  buildings: string[];
}

export default function BatchUploadModal({ onClose, onDone, buildings }: Props) {
  const [mode, setMode] = useState<UploadMode>("equipment");
  const [step, setStep] = useState<"upload" | "preview" | "results">("upload");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [validations, setValidations] = useState<RowValidation[]>([]);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const validCount = validations.filter((v) => v.status === "valid").length;
  const warnCount = validations.filter((v) => v.status === "warning").length;
  const errorCount = validations.filter((v) => v.status === "error").length;

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileName(file.name);
      try {
        const parsed = await parseFile(file);
        if (!parsed.length) {
          alert("File is empty or has no data rows.");
          return;
        }
        setRows(parsed);
        setValidations(validateRows(parsed, mode, buildings));
        setStep("preview");
      } catch {
        alert("Failed to parse file. Please use CSV or Excel format.");
      }
    },
    [mode, buildings],
  );

  const handleUpload = async () => {
    const validRows = validations
      .filter((v) => v.status === "valid" || v.status === "warning")
      .map((v) => mapRowToPayload(v.data, mode));

    if (!validRows.length) return;

    setUploading(true);
    try {
      const endpoint = mode === "buildings" ? "batch/buildings" : "batch/equipment";
      const res = await fetch(`${API_BASE}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: validRows }),
      });
      const json = await res.json();
      setResults(json.results ?? []);
      setStep("results");
    } catch {
      alert("Upload failed. Please check backend connection.");
    } finally {
      setUploading(false);
    }
  };

  const createdCount = results.filter((r) => r.status === "created").length;
  const failedCount = results.filter((r) => r.status === "error").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" style={{ animation: "fadeIn .18s ease" }} onClick={onClose}>
      <div
        className="relative mx-4 max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col"
        style={{ animation: "slideUp .22s cubic-bezier(.22,.61,.36,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Batch Upload Assets</h2>
            <p className="text-xs text-gray-500 mt-0.5">Upload buildings and equipment from CSV/Excel files</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === "upload" && (
            <div className="space-y-5">
              {/* Mode selector */}
              <div className="flex gap-2">
                {(["buildings", "equipment"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 rounded-lg border-2 px-4 py-3 text-sm font-semibold transition-all ${
                      mode === m
                        ? "border-green-600 bg-green-50 text-green-800"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {m === "buildings" ? "Buildings" : "Equipment"}
                  </button>
                ))}
              </div>

              {/* Template download */}
              <div className="flex items-center gap-3 rounded-lg bg-blue-50 border border-blue-200 p-3">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-blue-500 shrink-0"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v4M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                <p className="text-xs text-blue-700 flex-1">Download the template, fill in your data, then upload it here.</p>
                <button
                  onClick={() => downloadTemplate(mode)}
                  className="text-xs font-semibold text-blue-700 hover:text-blue-900 underline whitespace-nowrap"
                >
                  Download Template
                </button>
              </div>

              {/* File upload area */}
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-10 hover:border-green-400 hover:bg-green-50 transition-all">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-gray-400 mb-3"><path d="M16 20V8M11 12l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 22v4a2 2 0 002 2h20a2 2 0 002-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                <span className="text-sm font-medium text-gray-600">Click to upload CSV or Excel file</span>
                <span className="text-xs text-gray-400 mt-1">Supports .csv, .xlsx, .xls</span>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} className="hidden" />
              </label>

              {/* Expected columns */}
              <div className="text-xs text-gray-500">
                <span className="font-semibold">Expected columns: </span>
                {(mode === "buildings" ? BUILDING_COLUMNS : EQUIPMENT_COLUMNS).join(", ")}
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-gray-700">{fileName}</span>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{rows.length} rows</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">{validCount} valid</span>
                {warnCount > 0 && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{warnCount} warnings</span>}
                {errorCount > 0 && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">{errorCount} errors</span>}
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-3 py-2 font-semibold text-gray-500 w-8">#</th>
                      <th className="px-3 py-2 font-semibold text-gray-500 w-16">Status</th>
                      {(mode === "buildings" ? BUILDING_COLUMNS : EQUIPMENT_COLUMNS).map((col) => (
                        <th key={col} className="px-3 py-2 font-semibold text-gray-500 whitespace-nowrap">{col}</th>
                      ))}
                      <th className="px-3 py-2 font-semibold text-gray-500">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validations.map((v) => (
                      <tr key={v.row} className={`border-t border-gray-100 ${v.status === "error" ? "bg-red-50/50" : v.status === "warning" ? "bg-amber-50/50" : ""}`}>
                        <td className="px-3 py-2 text-gray-400">{v.row}</td>
                        <td className="px-3 py-2">
                          {v.status === "valid" && <span className="text-green-600 font-bold">OK</span>}
                          {v.status === "warning" && <span className="text-amber-600 font-bold">WARN</span>}
                          {v.status === "error" && <span className="text-red-600 font-bold">ERR</span>}
                        </td>
                        {(mode === "buildings" ? BUILDING_COLUMNS : EQUIPMENT_COLUMNS).map((col) => (
                          <td key={col} className="px-3 py-2 text-gray-700 max-w-[150px] truncate">{v.data[col] ?? ""}</td>
                        ))}
                        <td className="px-3 py-2 text-gray-500">{v.status !== "valid" ? v.message : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === "results" && (
            <div className="space-y-4">
              {/* Result summary */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex-1">
                  <span className="text-2xl font-bold text-green-700">{createdCount}</span>
                  <span className="text-sm text-green-600">created successfully</span>
                </div>
                {failedCount > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex-1">
                    <span className="text-2xl font-bold text-red-700">{failedCount}</span>
                    <span className="text-sm text-red-600">failed</span>
                  </div>
                )}
              </div>

              {/* Result rows */}
              <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-60">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 w-8">Row</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 w-16">Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.row} className={`border-t border-gray-100 ${r.status === "error" ? "bg-red-50/50" : ""}`}>
                        <td className="px-3 py-2 text-gray-400">{r.row}</td>
                        <td className="px-3 py-2">
                          {r.status === "created" ? <span className="text-green-600 font-bold">OK</span> : <span className="text-red-600 font-bold">ERR</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {failedCount > 0 && (
                <button onClick={() => downloadErrorReport(results)} className="text-xs text-red-600 hover:text-red-800 font-semibold underline">
                  Download Error Report
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
          {step === "preview" && (
            <>
              <button onClick={() => { setStep("upload"); setRows([]); setValidations([]); setFileName(""); if (fileRef.current) fileRef.current.value = ""; }} className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
                Back
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || (validCount + warnCount) === 0}
                className="px-5 py-2 text-sm font-semibold text-white rounded-lg shadow-sm disabled:opacity-50 transition-all active:scale-95"
                style={{ backgroundColor: "#1a7a4a" }}
              >
                {uploading ? "Uploading..." : `Upload ${validCount + warnCount} row${validCount + warnCount !== 1 ? "s" : ""}`}
              </button>
            </>
          )}
          {step === "results" && (
            <button
              onClick={() => { onDone(); onClose(); }}
              className="px-5 py-2 text-sm font-semibold text-white rounded-lg shadow-sm transition-all active:scale-95"
              style={{ backgroundColor: "#1a7a4a" }}
            >
              Done
            </button>
          )}
          {step === "upload" && (
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
