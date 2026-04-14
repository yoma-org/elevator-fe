"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

type Row = Record<string, any>;

interface ImportBatch {
  id: string;
  imported_at: string;
  imported_by: string | null;
  imported_by_email: string | null;
  file_name: string | null;
  source: string;
  stats: { buildings?: number; equipment_types?: number; equipment?: number; errors?: number };
  notes: string | null;
}

interface PreviewResult {
  buildings: { new: number; existing: number };
  equipmentTypes: { new: number; existing: number };
  equipment: { new: number; conflicts: Array<{ buildingName: string; code: string; reason: string }> };
}

interface SheetData {
  name: string;
  headers: string[];
  rows: Row[];
}

function excelSerialToDate(v: number): Date | null {
  const ms = Math.round((v - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

function excelDateToISO(v: any): string {
  if (typeof v !== "number") return String(v ?? "");
  const d = excelSerialToDate(v);
  if (!d) return String(v);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return `${day} ${mon} ${d.getFullYear()}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatCell(v: any, colName: string): string {
  if (v === null || v === undefined || v === "") return "";
  // "Day" column: derive weekday name from Excel serial
  if (/^day$/i.test(colName.trim()) && typeof v === "number" && v > 20000 && v < 60000) {
    const d = excelSerialToDate(v);
    return d ? DAY_NAMES[d.getDay()] : String(v);
  }
  if (typeof v === "number") {
    if (/date|time|installed|finished|overhaul|maintenance|test|grease/i.test(colName) && v > 20000 && v < 60000) {
      return excelDateToISO(v);
    }
    return String(v);
  }
  return String(v);
}

function parseSheet(ws: XLSX.WorkSheet, sheetName: string): SheetData {
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
  let headerIdx = 0;
  let maxCols = 0;
  for (let i = 0; i < Math.min(15, raw.length); i++) {
    const cnt = (raw[i] || []).filter((c) => c !== null && c !== undefined && c !== "").length;
    if (cnt > maxCols) { maxCols = cnt; headerIdx = i; }
  }
  // Build unique headers: dedupe by appending suffix _2, _3, ... for duplicates
  const rawHeaders = (raw[headerIdx] ?? []).map((h: any, i: number) => String(h ?? `col_${i}`).trim() || `col_${i}`);
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h: string) => {
    const count = (seen.get(h) ?? 0) + 1;
    seen.set(h, count);
    return count === 1 ? h : `${h} (${count})`;
  });
  const rows: Row[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i] || [];
    if (r.every((c: any) => c === null || c === undefined || c === "")) continue;
    const obj: Row = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] ?? null; });
    rows.push(obj);
  }
  return { name: sheetName, headers, rows };
}

// ─── Team color mapping ───────────────────────────────────────────────
const TEAM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: "#dcfce7", text: "#166534", border: "#86efac" },
  B: { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  C: { bg: "#ede9fe", text: "#5b21b6", border: "#c4b5fd" },
  D: { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
};

function TeamBadge({ team }: { team: string }) {
  const t = String(team ?? "").trim().toUpperCase();
  const c = TEAM_COLORS[t] ?? { bg: "#f3f4f6", text: "#374151", border: "#e5e7eb" };
  if (!t) return <span className="text-gray-300">—</span>;
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[10px] font-bold" style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {t}
    </span>
  );
}

// ─── Generic data table ───────────────────────────────────────────────
function SectionTable({
  sheet,
  initialPageSize = 10,
}: {
  sheet: SheetData;
  initialPageSize?: number;
}) {
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sheet.rows;
    return sheet.rows.filter((r) => Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(q)));
  }, [sheet, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const teamColIdx = sheet.headers.findIndex((h) => h.toLowerCase().trim() === "team");

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-3">
        <input
          type="text"
          placeholder={`Search in ${sheet.name}...`}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 min-w-[200px] max-w-[320px] text-xs border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
        />
        <span className="text-xs text-gray-400">{filtered.length} / {sheet.rows.length}</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: "#1a3a2a" }}>
              <th className="text-left text-[10px] font-bold uppercase text-white/50 px-3 py-2 whitespace-nowrap">#</th>
              {sheet.headers.map((h, idx) => (
                <th key={`${h}-${idx}`} className="text-left text-[10px] font-bold uppercase text-white px-3 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={sheet.headers.length + 1} className="px-4 py-8 text-center text-gray-400 text-sm">
                  {search ? "No matching rows" : "No data"}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-green-50/30 transition-colors" style={i % 2 === 0 ? { backgroundColor: "#f8fafc" } : {}}>
                  <td className="px-3 py-2 text-gray-400 text-[10px] font-mono">{(safePage - 1) * pageSize + i + 1}</td>
                  {sheet.headers.map((h, hi) => (
                    <td key={`${h}-${hi}`} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[260px] truncate" title={String(row[h] ?? "")}>
                      {hi === teamColIdx ? <TeamBadge team={row[h]} /> : formatCell(row[h], h)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between mt-3 gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            Showing {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span>Show</span>
            {[10, 25, 50].map((sz) => (
              <button key={sz} onClick={() => { setPageSize(sz); setPage(1); }}
                className={`min-w-[32px] py-1 rounded border text-xs transition-all ${pageSize === sz ? "bg-green-700 text-white border-green-700 font-bold" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                {sz}
              </button>
            ))}
          </div>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
              className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">Prev</button>
            <span className="text-xs text-gray-500 px-2">{safePage} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────
function getAuthToken(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("yecl-admin-session="))?.split("=")[1] ?? "";
}

function fmtDateTime(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return s; }
}

export default function RosterUploadPage() {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Import state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ batchId: string; inserted: any; errors: string[] } | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Progress tracking
  const [progressStep, setProgressStep] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [progressElapsed, setProgressElapsed] = useState(0);

  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function fetchBatches() {
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/roster-import/batches`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setBatches(await res.json());
    } catch { /* ignore */ }
  }
  useEffect(() => { fetchBatches(); }, []);

  // Build import payload from parsed sheets
  // Mapping rules:
  //   - Excel "Model" column (ELV / ESC / HL) → equipment_type
  //   - Excel "Lift No" column (PL1, FL1, ...) → equipment.code (equipment's business identifier)
  function buildImportPayload() {
    const buildingsMap = new Map<string, { name: string; address?: string | null }>();
    const typesMap = new Map<string, { name: string; code?: string | null }>();
    const equipmentMap = new Map<string, { buildingName: string; equipmentTypeName: string; code: string; model?: string | null }>();

    const MODEL_NAMES: Record<string, string> = {
      ELV: "Elevator",
      ESC: "Escalator",
      HL: "Home Lift",
      FL: "Freight Lift",
      SL: "Service Lift",
      DWT: "Dumbwaiter",
    };

    // Primary source: List-6 and Nov-Dec have (Project + Lift + Model) combinations
    const scheduleSheets = sheets.filter((s) =>
      s.name === "List-6" || s.name === "Nov-Dec Combined Schedule" || s.headers.includes("Model")
    );

    for (const sheet of scheduleSheets) {
      for (const row of sheet.rows) {
        const projectName = String(row["Project Name"] ?? "").trim();
        const liftNo = String(row["Lift No."] ?? row["Lift No"] ?? "").trim();
        const modelCode = String(row["Model"] ?? "").trim().toUpperCase();
        if (!projectName || !liftNo || !modelCode) continue;
        if (/standby|meeting|holiday/i.test(projectName)) continue;

        // Building
        if (!buildingsMap.has(projectName.toLowerCase())) {
          buildingsMap.set(projectName.toLowerCase(), { name: projectName });
        }

        // Equipment Type from Model (e.g., "ELV" → "Elevator")
        const typeName = MODEL_NAMES[modelCode] ?? modelCode;
        if (!typesMap.has(typeName.toLowerCase())) {
          typesMap.set(typeName.toLowerCase(), { name: typeName, code: modelCode });
        }

        // Equipment — dedupe by (project + lift)
        const key = `${projectName.toLowerCase()}|${liftNo.toLowerCase()}`;
        if (!equipmentMap.has(key)) {
          equipmentMap.set(key, {
            buildingName: projectName,
            equipmentTypeName: typeName,
            code: liftNo,
          });
        }
      }
    }

    // Enrich equipment from Sheet1 (add Location → address, Type → model)
    const sheet1 = sheets.find((s) => s.name === "Sheet1");
    if (sheet1) {
      for (const row of sheet1.rows) {
        const projectName = String(row["Project Name"] ?? row["Project  Name"] ?? "").trim();
        const liftNo = String(row["Lift No"] ?? row["Lift No."] ?? "").trim();
        if (!projectName || !liftNo) continue;

        // Update building with address/location
        const location = String(row["Location"] ?? "").trim();
        const existingBuilding = buildingsMap.get(projectName.toLowerCase());
        if (existingBuilding && location && !existingBuilding.address) {
          existingBuilding.address = location;
        } else if (!existingBuilding) {
          buildingsMap.set(projectName.toLowerCase(), { name: projectName, address: location || null });
        }

        // Update equipment with Type model if it exists in map
        const typeCode = String(row["Type"] ?? "").trim();
        const key = `${projectName.toLowerCase()}|${liftNo.toLowerCase()}`;
        const existingEq = equipmentMap.get(key);
        if (existingEq && typeCode) {
          existingEq.model = typeCode;
        }
      }
    }

    return {
      fileName,
      buildings: [...buildingsMap.values()],
      equipmentTypes: [...typesMap.values()],
      equipment: [...equipmentMap.values()],
    };
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreview(null);
    try {
      const token = getAuthToken();
      const payload = buildImportPayload();
      const res = await fetch(`${API_BASE}/roster-import/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Preview failed");
      setPreview(await res.json());
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (!confirm("This will insert new records into the database. Proceed?")) return;

    const payload = buildImportPayload();
    const totalRecords = payload.buildings.length + payload.equipmentTypes.length + payload.equipment.length;

    // Estimated duration (ms) — ~50ms per record on average
    const estimatedDuration = Math.max(3000, totalRecords * 50);

    // Simulated progress stages (visual only — backend is a single atomic call)
    const stages = [
      { pct: 10, label: "Preparing data...", step: 0 },
      { pct: 25, label: `Creating import batch...`, step: 1 },
      { pct: 40, label: `Importing ${payload.equipmentTypes.length} equipment types...`, step: 2 },
      { pct: 65, label: `Importing ${payload.buildings.length} buildings...`, step: 3 },
      { pct: 90, label: `Importing ${payload.equipment.length} equipment records...`, step: 4 },
      { pct: 95, label: "Finalizing...", step: 5 },
    ];

    setImporting(true);
    setProgressStep(0);
    setProgressPct(0);
    setProgressLabel(stages[0].label);
    setProgressElapsed(0);

    const startedAt = Date.now();

    // Tick timer: update elapsed + advance stages based on elapsed ratio
    const tickInterval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setProgressElapsed(elapsed);
      const ratio = Math.min(0.95, elapsed / estimatedDuration);
      const currentStage = stages.findIndex((s, i) =>
        ratio < (i + 1) / stages.length
      );
      const idx = currentStage < 0 ? stages.length - 1 : currentStage;
      setProgressStep(stages[idx].step);
      setProgressPct(stages[idx].pct);
      setProgressLabel(stages[idx].label);
    }, 120);

    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/roster-import/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error((await res.json()).message ?? "Import failed");
      const result = await res.json();

      // Jump to complete
      clearInterval(tickInterval);
      setProgressStep(5);
      setProgressPct(100);
      setProgressLabel("Import complete!");
      await new Promise((r) => setTimeout(r, 400)); // brief moment to show 100%

      setImportResult(result);
      setPreview(null);
      showToast(`Imported: ${result.inserted.buildings} buildings, ${result.inserted.equipment} equipment, ${result.inserted.equipmentTypes} types`, "success");
      fetchBatches();
    } catch (e: any) {
      clearInterval(tickInterval);
      showToast(e.message, "error");
    } finally {
      clearInterval(tickInterval);
      setImporting(false);
      setProgressStep(0);
      setProgressPct(0);
      setProgressLabel("");
      setProgressElapsed(0);
    }
  }

  async function handleUndo(batchId: string, force = false) {
    const msg = force
      ? "WARNING: Force undo will also delete maintenance reports linked to this batch. Proceed?"
      : "Undo this import? All records from this batch will be deleted.";
    if (!confirm(msg)) return;

    // Show progress modal for undo
    setImporting(true);
    setProgressStep(0);
    setProgressPct(10);
    setProgressLabel("Checking dependencies...");
    setProgressElapsed(0);
    const startedAt = Date.now();
    const tickInterval = setInterval(() => {
      setProgressElapsed(Date.now() - startedAt);
      setProgressPct((p) => Math.min(90, p + 5));
    }, 200);

    try {
      const token = getAuthToken();
      setProgressLabel("Deleting equipment records...");
      setProgressStep(2);
      const res = await fetch(`${API_BASE}/roster-import/batches/${batchId}${force ? "?force=true" : ""}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const result = await res.json();
      if (!res.ok) {
        clearInterval(tickInterval);
        setImporting(false);
        if (result.message?.includes("maintenance report") && !force) {
          if (confirm(`${result.message}\n\nForce undo (will delete dependent reports)?`)) {
            return handleUndo(batchId, true);
          }
        }
        throw new Error(result.message ?? "Undo failed");
      }

      clearInterval(tickInterval);
      setProgressStep(5);
      setProgressPct(100);
      setProgressLabel("Undo complete!");
      await new Promise((r) => setTimeout(r, 400));

      showToast(`Undone: ${result.deleted.equipment} equipment, ${result.deleted.buildings} buildings, ${result.deleted.equipment_types} types`, "success");
      fetchBatches();
      if (importResult?.batchId === batchId) setImportResult(null);
    } catch (e: any) {
      clearInterval(tickInterval);
      showToast(e.message, "error");
    } finally {
      clearInterval(tickInterval);
      setImporting(false);
      setProgressStep(0);
      setProgressPct(0);
      setProgressLabel("");
      setProgressElapsed(0);
    }
  }

  async function handleFile(file: File) {
    setLoading(true);
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const parsed = wb.SheetNames.map((n) => parseSheet(wb.Sheets[n], n));
      setSheets(parsed);
      setFileName(file.name);
    } catch (e: any) {
      setError("Failed to parse Excel file: " + (e?.message ?? "unknown error"));
    } finally {
      setLoading(false);
    }
  }

  // Map sheets by name for targeted rendering
  const byName = useMemo(() => Object.fromEntries(sheets.map((s) => [s.name, s])), [sheets]);
  const listSheet = byName["List-6"] ?? sheets[0];
  const equipmentSheet = byName["Sheet1"] ?? sheets[1];
  const novDecSheet = byName["Nov-Dec Combined Schedule"] ?? sheets.find(s => /nov|dec/i.test(s.name));
  const inspectionSheet = byName["Sheet3"] ?? sheets.find(s => s.headers.some((h) => /inspection|item/i.test(h)));
  const aliasSheet = byName["Check"] ?? sheets.find(s => s.headers.length <= 4 && s.rows.length > 100);

  // Compute stats
  const stats = useMemo(() => {
    const projects = new Set<string>();
    let totalUnits = 0;
    const teams = new Set<string>();
    const technicians: string[] = [];

    for (const s of sheets) {
      for (const r of s.rows) {
        const pn = String(r["Project Name"] ?? r["Project  Name"] ?? "").trim();
        if (pn && !/standby|meeting|holiday/i.test(pn)) projects.add(pn);
        const units = Number(r["Units"] ?? r["Total Unit"] ?? 0);
        if (s.name === "List-6" && !isNaN(units)) totalUnits += units;
        const team = String(r["Team"] ?? "").trim().toUpperCase();
        if (team && team.length <= 3) teams.add(team);
      }
    }

    // Extract technician codes from Nov-Dec header area (e.g. "KKA", "MTA")
    // Best-effort: no reliable anchor, so just list commonly seen codes if teams are populated
    if (teams.size > 0) {
      technicians.push("KKA", "MTA", "HKKT", "TSO", "NCK", "KSN");
    }

    const equipmentRows = equipmentSheet?.rows.length ?? 0;
    const safetyOk = (equipmentSheet?.rows ?? []).filter((r) =>
      String(r["SF Gear Result"] ?? "").toLowerCase().includes("ok") ||
      String(r["Finished Date"] ?? "") !== ""
    ).length;

    return {
      projects: projects.size,
      totalUnits,
      equipmentRows,
      safetyOk,
      teams: [...teams].sort(),
      technicians,
    };
  }, [sheets, equipmentSheet]);

  function reset() {
    setSheets([]);
    setFileName("");
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  // ─── Empty / Upload state ─────────────────────────────────────────
  if (sheets.length === 0) {
    return (
      <div>
        <div className="mb-5">
          <h1 className="text-xl font-bold text-gray-800">Roster — Monthly Service Schedule</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload Excel to preview planning of monthly service schedule for contracted units</p>
        </div>

        <div
          className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-green-400 transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-gray-800">Click to browse or drag Excel file here</p>
              <p className="text-sm text-gray-500 mt-1">Supports .xlsx, .xls, .xlsm</p>
            </div>
            {loading && <p className="text-sm text-green-600 font-medium mt-2">Parsing file...</p>}
            {error && <p className="text-sm text-red-600 font-medium mt-2">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ─── Loaded state ──────────────────────────────────────────────────
  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-semibold text-white max-w-md"
          style={{ backgroundColor: toast.type === "success" ? "#166534" : "#991b1b" }}>
          {toast.msg}
        </div>
      )}

      {/* Import Progress Modal */}
      {importing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" style={{ animation: "fadeIn .2s ease" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" className="animate-spin" style={{ animationDuration: "1.5s" }}>
                  <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-base font-bold text-gray-800">Importing to database</p>
                <p className="text-xs text-gray-500">Please don't close this tab</p>
              </div>
              <span className="text-xs text-gray-400 font-mono">{(progressElapsed / 1000).toFixed(1)}s</span>
            </div>

            {/* Progress bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-gray-700 font-medium">{progressLabel}</span>
                <span className="text-gray-500 font-mono">{progressPct}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-green-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Step checklist */}
            <ul className="space-y-1.5 text-xs">
              {[
                "Preparing data",
                "Creating import batch",
                "Importing equipment types",
                "Importing buildings",
                "Importing equipment records",
                "Finalizing",
              ].map((label, i) => {
                const isDone = progressStep > i || progressPct === 100;
                const isActive = progressStep === i && progressPct < 100;
                return (
                  <li key={i} className="flex items-center gap-2">
                    {isDone ? (
                      <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                    ) : isActive ? (
                      <span className="w-4 h-4 rounded-full border-2 border-green-500 border-t-transparent animate-spin flex-shrink-0" />
                    ) : (
                      <span className="w-4 h-4 rounded-full border-2 border-gray-200 flex-shrink-0" />
                    )}
                    <span className={isDone ? "text-gray-700" : isActive ? "text-gray-900 font-semibold" : "text-gray-400"}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Page header + reset */}
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Roster — Monthly Service Schedule</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Planning of Monthly Service Schedule for Contracted Units &middot; <span className="font-medium text-gray-700">{fileName}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!preview && !importResult && (
            <button onClick={handlePreview} disabled={previewing}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
              {previewing ? "Analyzing..." : "Preview Import"}
            </button>
          )}
          <button onClick={reset} className="text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 whitespace-nowrap">
            Upload another file
          </button>
        </div>
      </div>


      {/* Import Preview Panel */}
      {preview && !importResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <p className="text-sm font-bold text-blue-900 mb-2">Import Preview</p>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="text-blue-600 font-semibold">Buildings</p>
                  <p className="text-blue-900 font-bold text-lg">+{preview.buildings.new} new</p>
                  <p className="text-blue-500">{preview.buildings.existing} existing (skip)</p>
                </div>
                <div>
                  <p className="text-blue-600 font-semibold">Equipment Types</p>
                  <p className="text-blue-900 font-bold text-lg">+{preview.equipmentTypes.new} new</p>
                  <p className="text-blue-500">{preview.equipmentTypes.existing} existing (skip)</p>
                </div>
                <div>
                  <p className="text-blue-600 font-semibold">Equipment</p>
                  <p className="text-blue-900 font-bold text-lg">+{preview.equipment.new} new</p>
                  <p className={preview.equipment.conflicts.length > 0 ? "text-amber-600" : "text-blue-500"}>
                    {preview.equipment.conflicts.length} conflict(s)
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPreview(null)} className="text-xs font-semibold px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-white">
                Cancel
              </button>
              <button onClick={handleImport} disabled={importing}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-green-700 text-white hover:bg-green-800 disabled:opacity-50">
                {importing ? "Importing..." : "Confirm Import"}
              </button>
            </div>
          </div>
          {preview.equipment.conflicts.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-amber-700 font-semibold">View {preview.equipment.conflicts.length} conflicts</summary>
              <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto text-amber-800">
                {preview.equipment.conflicts.slice(0, 20).map((c, i) => (
                  <li key={i}>{c.buildingName} — {c.code}: {c.reason}</li>
                ))}
                {preview.equipment.conflicts.length > 20 && <li>...and {preview.equipment.conflicts.length - 20} more</li>}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Import Result Panel */}
      {importResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-bold text-green-800">Imported successfully!</p>
            <p className="text-xs text-green-700 mt-1">
              {importResult.inserted.buildings} buildings, {importResult.inserted.equipmentTypes} types, {importResult.inserted.equipment} equipment
              {importResult.errors.length > 0 && ` — ${importResult.errors.length} error(s)`}
            </p>
            <p className="text-[10px] text-green-600 mt-1 font-mono">Batch ID: {importResult.batchId}</p>
          </div>
          <button onClick={() => handleUndo(importResult.batchId)}
            className="text-xs font-semibold px-3 py-2 rounded-lg border border-red-300 text-red-700 bg-white hover:bg-red-50">
            Undo this import
          </button>
        </div>
      )}

      {/* Import Batches History */}
      {batches.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
          <p className="text-sm font-bold text-gray-800 mb-3">Import History ({batches.length})</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left font-semibold text-gray-500 px-2 py-2">Date</th>
                  <th className="text-left font-semibold text-gray-500 px-2 py-2">File</th>
                  <th className="text-left font-semibold text-gray-500 px-2 py-2">By</th>
                  <th className="text-center font-semibold text-gray-500 px-2 py-2">Buildings</th>
                  <th className="text-center font-semibold text-gray-500 px-2 py-2">Types</th>
                  <th className="text-center font-semibold text-gray-500 px-2 py-2">Equipment</th>
                  <th className="text-right font-semibold text-gray-500 px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{fmtDateTime(b.imported_at)}</td>
                    <td className="px-2 py-2 text-gray-700 max-w-[200px] truncate" title={b.file_name ?? ""}>{b.file_name ?? "—"}</td>
                    <td className="px-2 py-2 text-gray-600 whitespace-nowrap">{b.imported_by ?? "—"}</td>
                    <td className="px-2 py-2 text-center font-semibold text-gray-800">{b.stats?.buildings ?? 0}</td>
                    <td className="px-2 py-2 text-center font-semibold text-gray-800">{b.stats?.equipment_types ?? 0}</td>
                    <td className="px-2 py-2 text-center font-semibold text-gray-800">{b.stats?.equipment ?? 0}</td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => handleUndo(b.id)}
                        className="text-[10px] font-semibold px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50">
                        Undo
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        <StatCard label="Total Projects" value={stats.projects} unit="buildings" />
        <StatCard label="Total Units" value={stats.totalUnits || "—"} unit={stats.totalUnits ? "scheduled" : ""} />
        <StatCard label="Equipment Records" value={stats.equipmentRows} unit="lifts" />
        <StatCard label="Safety Tests OK" value={stats.safetyOk} unit={`/ ${stats.equipmentRows}`} color="#16a34a" />
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">Teams & Personnel</p>
          <div className="flex items-center gap-1.5 mb-2">
            {stats.teams.length > 0 ? stats.teams.map((t) => <TeamBadge key={t} team={t} />) : <span className="text-gray-300 text-xs">—</span>}
          </div>
          {stats.technicians.length > 0 && (
            <p className="text-[10px] text-gray-500 truncate" title={stats.technicians.join(", ")}>
              {stats.technicians.join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* Section 1: List-6 */}
      {listSheet && (
        <SectionCard
          number="1"
          title="Service Schedule"
          subtitle={`Sheet: ${listSheet.name} — ${listSheet.rows.length} rows — ${listSheet.headers.length} columns`}
        >
          <SectionTable sheet={listSheet} initialPageSize={10} />
        </SectionCard>
      )}

      {/* Section 2: Sheet1 equipment */}
      {equipmentSheet && equipmentSheet.name !== listSheet?.name && (
        <SectionCard
          number="2"
          title="Equipment Master & Tests"
          subtitle={`Sheet: ${equipmentSheet.name} — ${equipmentSheet.rows.length} units — ${equipmentSheet.headers.length} columns`}
        >
          <SectionTable sheet={equipmentSheet} initialPageSize={10} />
        </SectionCard>
      )}

      {/* Section 3: Nov-Dec */}
      {novDecSheet && novDecSheet.name !== listSheet?.name && novDecSheet.name !== equipmentSheet?.name && (
        <SectionCard
          number="3"
          title="Nov-Dec Combined Schedule"
          subtitle={`Sheet: ${novDecSheet.name} — ${novDecSheet.rows.length} rows`}
        >
          <SectionTable sheet={novDecSheet} initialPageSize={10} />
        </SectionCard>
      )}

      {/* Two-column: Inspection + Aliases */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {inspectionSheet && inspectionSheet.name !== listSheet?.name && inspectionSheet.name !== equipmentSheet?.name && inspectionSheet.name !== novDecSheet?.name && (
          <SectionCard
            number="4"
            title="Inspection Checklist"
            subtitle={`Sheet: ${inspectionSheet.name}`}
          >
            <SectionTable sheet={inspectionSheet} initialPageSize={10} />
          </SectionCard>
        )}
        {aliasSheet && aliasSheet.name !== listSheet?.name && aliasSheet.name !== equipmentSheet?.name && aliasSheet.name !== novDecSheet?.name && aliasSheet.name !== inspectionSheet?.name && (
          <SectionCard
            number="5"
            title="Project Name Lookup"
            subtitle={`Sheet: ${aliasSheet.name} — ${aliasSheet.rows.length} aliases`}
          >
            <SectionTable sheet={aliasSheet} initialPageSize={10} />
          </SectionCard>
        )}
      </div>
    </div>
  );
}

// ─── Helper components ─────────────────────────────────────────────────
function StatCard({ label, value, unit, color }: { label: string; value: string | number; unit?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold" style={{ color: color ?? "#1e293b" }}>{value}</span>
        {unit && <span className="text-xs text-gray-400 font-medium">{unit}</span>}
      </div>
    </div>
  );
}

function SectionCard({
  number, title, subtitle, children,
}: {
  number: string; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-base font-bold text-gray-800">{number}. {title}</h2>
        {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
