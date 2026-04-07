"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import BatchUploadModal from "../../components/BatchUploadModal";

// ─── useDebounce hook ─────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

// ─── CSS animations (injected once) ───────────────────────────────────────────

const ANIM_STYLES = `
  @keyframes fadeIn   { from { opacity:0 } to { opacity:1 } }
  @keyframes slideUp  { from { opacity:0; transform:translateY(18px) scale(.97) } to { opacity:1; transform:translateY(0) scale(1) } }
  @keyframes shimmer  { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
  @keyframes pulse2   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(.95)} }
  @keyframes toastIn  { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  @keyframes toastOut { from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(12px)} }
  @keyframes spinArc  { to{transform:rotate(360deg)} }
  .card-hover { transition: box-shadow .18s, transform .18s, border-color .18s; }
  .card-hover:hover { box-shadow:0 6px 24px rgba(0,0,0,.09); transform:translateY(-2px); border-color:#4ade80 !important; }
  .btn-green { transition: background-color .15s, transform .1s, box-shadow .15s; }
  .btn-green:hover { background-color:#15643c !important; box-shadow:0 3px 10px rgba(26,122,74,.35); }
  .btn-green:active { transform:scale(.97); }
  .overlay-fade { animation: fadeIn .18s ease; }
  .modal-slide { animation: slideUp .22s cubic-bezier(.22,.61,.36,1) both; }
  .skeleton { background: linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%); background-size:400px 100%; animation:shimmer 1.4s infinite linear; border-radius:6px; }
  .active-pulse { animation: pulse2 2s ease-in-out infinite; }
  .filter-pill { display:inline-flex; align-items:center; gap:4px; padding:2px 8px 2px 10px; border-radius:9999px; font-size:11px; font-weight:600; background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; transition:all .15s; }
  .filter-pill:hover { background:#dcfce7; border-color:#86efac; }
  .filter-pill button { display:flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:transparent; transition:background .12s; }
  .filter-pill button:hover { background:rgba(22,101,52,.12); }
  .priority-bar { position:absolute; left:0; top:0; bottom:0; width:3px; border-radius:3px 0 0 3px; }
  .table-row { transition: background .12s; }
  .table-row:hover { background:#f9fafb; }
`;

// ─── types ─────────────────────────────────────────────────────────────────────

interface WorkOrder {
  id: string; building: string; equipmentCode: string; equipmentType: string;
  status: string; maintenanceType: string; technicianName: string;
  arrivalDateTime: string; findings: string | null; workPerformed: string | null;
  partsUsed: Array<{ name: string; quantity: number }> | null;
  priority: string; submittedAt: string; createdAt: string;
}

interface WorkOrderDetail extends WorkOrder {
  buildingId: string; equipmentId: string;
  checklistResults: { equipmentType: string | null; checkedCount: number; totalCount: number;
    categories: Array<{ category: string; items: Array<{ label: string; checked: boolean }> }> } | null;
  remarks: string | null;
  internalNotes: Array<{ id: string; at: string; author: string; kind: string; text: string }> | null;
  assignedTo: string | null; updatedAt: string;
}

interface Stats { myQueue: number; projectsThisMonth: number; activeJobs: number; avgResponseTimeMin: number; avgWorkDurationHrs: number; }
interface BuildingItem { id: string; name: string; }
interface EquipmentItem { id: string; equipmentCode: string; equipmentType: string; location: string | null; }

// ─── status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot?: string }> = {
  scheduled:      { label: "SCHEDULED",         bg: "#f3f4f6", text: "#374151", dot: "#9ca3af" },
  received:       { label: "CBS RECEIVED",       bg: "#fef9c3", text: "#713f12", dot: "#ca8a04" },
  active:         { label: "ACTIVE",             bg: "#fde8e8", text: "#9b1c1c", dot: "#ef4444" },
  submitted:      { label: "SUBMITTED",          bg: "#fff3cd", text: "#856404", dot: "#d97706" },
  "pc-review":    { label: "PC REVIEW",          bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  "comm-review":  { label: "COMMERCIAL REVIEW",  bg: "#ede9fe", text: "#5b21b6", dot: "#8b5cf6" },
  "invoice-ready":{ label: "INVOICE READY",      bg: "#cffafe", text: "#155e75", dot: "#06b6d4" },
  closed:         { label: "CLOSED",             bg: "#d1fae5", text: "#065f46", dot: "#10b981" },
  // legacy aliases kept for existing DB records
  pending:        { label: "SUBMITTED",          bg: "#fff3cd", text: "#856404", dot: "#d97706" },
  "in-progress":  { label: "ACTIVE",             bg: "#fde8e8", text: "#9b1c1c", dot: "#ef4444" },
  completed:      { label: "PC REVIEW",          bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  "commercial-review": { label: "COMMERCIAL REVIEW", bg: "#ede9fe", text: "#5b21b6", dot: "#8b5cf6" },
  cancelled:      { label: "CANCELLED",          bg: "#fee2e2", text: "#991b1b", dot: "#ef4444" },
};
function getStatusCfg(s: string) { return STATUS_CONFIG[s] ?? { label: s.toUpperCase(), bg: "#f3f4f6", text: "#374151", dot: "#9ca3af" }; }

function fmtDate(iso: string) { if (!iso) return "-"; const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }
function fmtTime(iso: string) { if (!iso) return "-"; const d = new Date(iso); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

// ─── Toast ─────────────────────────────────────────────────────────────────────

interface ToastMsg { id: number; text: string; kind: "success" | "error"; }

function Toast({ msg, onDone }: { msg: ToastMsg; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 2800);
    const t2 = setTimeout(() => onDone(), 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);
  return (
    <div
      style={{
        animation: leaving ? "toastOut .35s ease forwards" : "toastIn .25s ease",
        backgroundColor: msg.kind === "success" ? "#15803d" : "#dc2626",
      }}
      className="flex items-center gap-2 text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg min-w-[220px]"
    >
      <span>{msg.kind === "success" ? "✓" : "✕"}</span>
      <span>{msg.text}</span>
    </div>
  );
}

function ToastContainer({ toasts, remove }: { toasts: ToastMsg[]; remove: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end">
      {toasts.map(m => <Toast key={m.id} msg={m} onDone={() => remove(m.id)} />)}
    </div>
  );
}

// ─── AnimatedNumber ────────────────────────────────────────────────────────────

function AnimatedNumber({ target }: { target: number }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number>(0);
  const start = useRef<number | null>(null);
  const from = useRef(0);
  const dur = 600;

  useEffect(() => {
    from.current = display;
    start.current = null;
    const step = (ts: number) => {
      if (!start.current) start.current = ts;
      const p = Math.min((ts - start.current) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from.current + (target - from.current) * ease));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return <>{display}</>;
}

// ─── Stat Icons (SVG) ─────────────────────────────────────────────────────────

const STAT_ICONS: Record<string, { svg: ReactNode; bg: string; iconBg: string; iconColor: string }> = {
  queue: {
    bg: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
    iconBg: "#bbf7d0", iconColor: "#166534",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  },
  projects: {
    bg: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
    iconBg: "#bfdbfe", iconColor: "#1e40af",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M2 7h16M6 2v4M14 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  },
  active: {
    bg: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
    iconBg: "#fecaca", iconColor: "#991b1b",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 10h3l2-5 4 10 2-5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  response: {
    bg: "linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)",
    iconBg: "#fde68a", iconColor: "#92400e",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 5.5v5l3.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  },
  duration: {
    bg: "linear-gradient(135deg, #fdf4ff 0%, #f3e8ff 100%)",
    iconBg: "#e9d5ff", iconColor: "#6b21a8",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 6v4.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M15 3l2 2M5 3L3 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  },
};

// ─── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ iconKey, label, value, unit, ok, active, onClick }: { iconKey: string; label: string; value: string | number; unit?: string; ok?: boolean; active?: boolean; onClick?: () => void; }) {
  const isNum = typeof value === "number";
  const cfg = STAT_ICONS[iconKey] ?? STAT_ICONS.queue;
  return (
    <div
      className={`flex-1 rounded-xl px-5 py-4 border min-w-0 card-hover ${onClick ? "cursor-pointer" : ""}`}
      style={{
        animation: "slideUp .3s ease both",
        background: active ? "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)" : cfg.bg,
        borderColor: active ? "#16a34a" : "rgba(0,0,0,.06)",
        boxShadow: active ? "0 0 0 2px rgba(22,163,74,.25)" : "0 1px 3px rgba(0,0,0,.04)",
      }}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: active ? "#bbf7d0" : cfg.iconBg, color: active ? "#166534" : cfg.iconColor }}>
          {cfg.svg}
        </div>
        <span className={`text-xs font-semibold uppercase tracking-wide ${active ? "text-green-700" : "text-gray-500"}`}>{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-3xl font-bold ${active ? "text-green-700" : "text-gray-800"}`}>
          {isNum ? <AnimatedNumber target={value as number} /> : value}
        </span>
        {unit && <span className="text-sm font-semibold text-gray-400 uppercase ml-1">{unit}</span>}
        {ok !== undefined && (
          <span className="ml-auto">
            {ok
              ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">OK</span>
              : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">WARN</span>
            }
          </span>
        )}
      </div>
    </div>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = getStatusCfg(status);
  const isActive = status === "active" || status === "in-progress";
  return (
    <span
      className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap flex items-center gap-1.5 ${isActive ? "active-pulse" : ""}`}
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {cfg.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: cfg.dot, display: "inline-block", flexShrink: 0 }} />}
      {cfg.label}
    </span>
  );
}

// ─── SkeletonCard ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-100 p-4 space-y-3">
      <div className="flex justify-between items-center">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-5 w-24 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {[1,2,3,4].map(i => <div key={i} className="skeleton h-3 w-full" />)}
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <div className="skeleton h-3 w-4/5" />
        <div className="skeleton h-3 w-4/5" />
      </div>
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-3/4" />
      <div className="skeleton h-7 w-24 rounded mt-1" />
    </div>
  );
}

// ─── WorkOrderCard ─────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, { bar: string; bg: string; text: string }> = {
  Urgent: { bar: "#dc2626", bg: "#fef2f2", text: "#991b1b" },
  High:   { bar: "#f97316", bg: "#fff7ed", text: "#9a3412" },
  Medium: { bar: "#eab308", bg: "#fefce8", text: "#854d0e" },
  Low:    { bar: "#6b7280", bg: "#f9fafb", text: "#374151" },
};

function WorkOrderCard({ order, onClick, index }: { order: WorkOrder; onClick: () => void; index: number; }) {
  const prio = PRIORITY_COLORS[order.priority] ?? PRIORITY_COLORS.Medium;
  const isHighPrio = order.priority === "High" || order.priority === "Urgent";
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-4 card-hover cursor-pointer group relative overflow-hidden"
      style={{ animation: `slideUp .25s ${index * 0.04}s ease both` }}
    >
      {/* Priority color bar */}
      <div className="priority-bar" style={{ backgroundColor: prio.bar }} />

      {/* Header: code + status */}
      <div className="flex items-center justify-between mb-3 gap-2 pl-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-bold text-gray-800 font-mono tracking-tight truncate">{order.id ?? "—"}</span>
          <span className="hidden sm:inline text-[10px] text-gray-400 font-medium px-1.5 py-0.5 bg-gray-100 rounded">{order.equipmentType}</span>
        </div>
        <div className="flex items-center gap-2">
          {isHighPrio && (
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: prio.bg, color: prio.text }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.5 3.2L11 4.8 8.5 7.2l.6 3.8L6 9.2 2.9 11l.6-3.8L1 4.8l3.5-.6z" fill="currentColor"/></svg>
              {order.priority}
            </span>
          )}
          <StatusBadge status={order.status} />
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3 pl-1">
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-gray-400 shrink-0"><path d="M2 2h8v8H2z" stroke="currentColor" strokeWidth="1.1"/><path d="M4 1v2M8 1v2M2 5h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
          <span className="text-gray-700 font-medium">{order.building}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-gray-400 shrink-0"><rect x="3" y="1" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/><path d="M5 8h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
          <span className="text-gray-700 font-medium">{order.equipmentCode}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-gray-400 shrink-0"><circle cx="6" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.1"/><path d="M1.5 11c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="currentColor" strokeWidth="1.1"/></svg>
          <span className="text-gray-700 font-medium">{order.technicianName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-gray-400 shrink-0"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.1"/><path d="M6 3v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
          <span className="text-gray-700 font-medium">{fmtDate(order.arrivalDateTime)} {fmtTime(order.arrivalDateTime)}</span>
        </div>
      </div>

      {/* Maintenance type tag */}
      <div className="flex items-center gap-2 mb-3 pl-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{order.maintenanceType}</span>
      </div>

      {/* Findings preview */}
      {order.findings && (
        <p className="text-xs text-gray-500 mb-3 line-clamp-2 leading-relaxed border-l-2 border-gray-200 pl-2.5">{order.findings}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100 pl-1">
        <span className="text-[10px] text-gray-400">{order.submittedAt ? `Submitted ${fmtDate(order.submittedAt)}` : ""}</span>
        <span className="text-xs text-green-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          View details
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2L7 5l-3.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
      </div>
    </div>
  );
}

// ─── AddProjectModal ───────────────────────────────────────────────────────────

function AddProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (msg: string) => void }) {
  const [buildings, setBuildings] = useState<BuildingItem[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [buildingId, setBuildingId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [calledPerson, setCalledPerson] = useState("");
  const [calledTime, setCalledTime] = useState("");
  const [issue, setIssue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/equipment/buildings`).then(r => r.json()).then(res => setBuildings(res?.data ?? res)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!buildingId) { setEquipment([]); setEquipmentId(""); return; }
    fetch(`${API_BASE}/equipment/by-building?buildingId=${buildingId}`).then(r => r.json()).then(res => { setEquipment(res?.data ?? res); setEquipmentId(""); }).catch(console.error);
  }, [buildingId]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError("");
    if (!buildingId || !equipmentId || !calledPerson || !calledTime || !issue) { setError("Please fill in all required fields."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/maintenance-reports/admin/cbs-call`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId, equipmentId, calledPerson, calledTime, issue }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.message ?? "Failed to create CBS Call"); }
      const data = await res.json();
      onCreated(`CBS Call created: ${data.reportCode}`);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none transition-all focus:border-green-600 focus:ring-2 focus:ring-green-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overlay-fade" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-slide bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-bold uppercase tracking-wide text-gray-800">Add New CBS Call</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded hover:bg-gray-100">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Building Name <span className="text-red-500">*</span></label>
            <select value={buildingId} onChange={e => setBuildingId(e.target.value)} className={inputCls} style={{ borderColor: buildingId ? "#16a34a" : undefined }}>
              <option value="">Select building...</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Lift No. <span className="text-red-500">*</span></label>
            <select value={equipmentId} onChange={e => setEquipmentId(e.target.value)} disabled={!buildingId} className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`}>
              <option value="">Select lift...</option>
              {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.equipmentCode}{eq.location ? ` — ${eq.location}` : ""}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Called Person <span className="text-red-500">*</span></label>
            <input type="text" name="calledPerson" value={calledPerson} onChange={e => setCalledPerson(e.target.value)} placeholder="e.g., U Tin Maung" className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Called Time <span className="text-red-500">*</span></label>
            <input type="datetime-local" name="calledTime" value={calledTime} onChange={e => setCalledTime(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Issue Description <span className="text-red-500">*</span></label>
            <textarea name="issue" value={issue} onChange={e => setIssue(e.target.value)} placeholder="Describe the issue reported..." rows={3} className={`${inputCls} resize-none`} />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span>⚠</span><span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={submitting} className="btn-green flex-1 py-3 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60 shadow-sm active:scale-[.97] transition-all" style={{ backgroundColor: "#1a7a4a" }}>
              {submitting
                ? <><svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: "spinArc .7s linear infinite" }}><circle cx="7" cy="7" r="5" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="2"/><path d="M7 2A5 5 0 0 1 12 7" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/></svg>Creating...</>
                : <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5l3.5 3.5L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>Create CBS Call</>
              }
            </button>
            <button type="button" onClick={onClose} className="px-5 py-3 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 active:scale-[.97] transition-all">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Section / InfoRow ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
        <span className="flex-1 border-t border-gray-100" />
        {title}
        <span className="flex-1 border-t border-gray-100" />
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm py-1 border-b border-gray-50 last:border-0">
      <span className="text-gray-400 uppercase text-xs font-semibold tracking-wide">{label}</span>
      <span className="text-gray-800 font-medium">{value || "—"}</span>
    </div>
  );
}

// ─── NoteForm ─────────────────────────────────────────────────────────────────

function NoteForm({ code, onAdded }: { code: string; onAdded: (note: { id: string; at: string; author: string; kind: string; text: string }) => void }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("dispatch");
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await fetch(`${API_BASE}/maintenance-reports/admin/${code}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), kind, author: "ADMIN" }),
      });
      const newNote = { id: crypto.randomUUID(), at: new Date().toISOString(), author: "ADMIN", kind, text: text.trim() };
      onAdded(newNote);
      setText("");
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <textarea
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none resize-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition-all"
        rows={2}
        placeholder="Add a note..."
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); handleSubmit(); } }}
      />
      <div className="flex items-center gap-2 mt-2">
        <select value={kind} onChange={e => setKind(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-green-500">
          <option value="dispatch">Dispatch</option>
          <option value="review">Review</option>
          <option value="finance">Finance</option>
        </select>
        <button
          onClick={handleSubmit}
          disabled={sending || !text.trim()}
          className="ml-auto text-xs font-semibold px-4 py-1.5 rounded-lg text-white disabled:opacity-50 transition-all active:scale-95"
          style={{ backgroundColor: "#1a7a4a" }}
        >
          {sending ? "Sending..." : "Add Note"}
        </button>
      </div>
    </div>
  );
}

// ─── DetailModal ───────────────────────────────────────────────────────────────

function DetailModal({ code, onClose, onStatusChange, onToast, onDetailUpdated }: {
  code: string; onClose: () => void;
  onStatusChange: (code: string, status: string) => void;
  onToast: (msg: string, kind: "success" | "error") => void;
  onDetailUpdated?: () => void;
}) {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [tab, setTab] = useState<"info" | "notes">("info");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  const [editEquipmentId, setEditEquipmentId] = useState("");

  const editableStatuses = ["submitted", "pc-review", "comm-review", "pending", "completed", "commercial-review"];
  const isEditable = detail ? editableStatuses.includes(detail.status) : false;

  useEffect(() => {
    setDetail(null);
    setEditing(false);
    fetch(`${API_BASE}/maintenance-reports/admin/${code}`).then(r => r.json()).then(setDetail).catch(console.error);
  }, [code]);

  function startEditing() {
    if (!detail) return;
    setEditEquipmentId(detail.equipmentId);
    // Load equipment list for this building
    fetch(`${API_BASE}/equipment/by-building?buildingId=${detail.buildingId}`)
      .then(r => r.json())
      .then(res => { const list = res?.data ?? res; setEquipmentList(Array.isArray(list) ? list : []); })
      .catch(() => setEquipmentList([]));
    setEditing(true);
  }

  const selectedEquipment = equipmentList.find(e => e.id === editEquipmentId);
  const hasChanges = detail && editEquipmentId !== detail.equipmentId;

  async function handleSaveEdit() {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/maintenance-reports/admin/${code}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipmentId: editEquipmentId }),
      });
      if (!res.ok) throw new Error("Failed to save");
      // Refresh detail from server
      const updated = await fetch(`${API_BASE}/maintenance-reports/admin/${code}`).then(r => r.json());
      setDetail(updated);
      setEditing(false);
      onToast("Equipment updated successfully", "success");
      onDetailUpdated?.();
    } catch {
      onToast("Failed to update details", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: string) {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/maintenance-reports/admin/${code}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      onStatusChange(code, status);
      if (detail) setDetail({ ...detail, status });
      setEditing(false);
      onToast(`Status updated to ${getStatusCfg(status).label}`, "success");
    } catch {
      onToast("Failed to update status", "error");
    } finally {
      setSaving(false);
    }
  }

  const editInputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none transition-all focus:border-green-600 focus:ring-2 focus:ring-green-100 resize-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overlay-fade" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-slide bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div style={{ backgroundColor: "#1a3a2a" }} className="px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-white font-bold text-base tracking-wide font-mono">{code}</h2>
          <div className="flex items-center gap-3">
            {detail && (
              <select value={detail.status} onChange={e => handleStatusChange(e.target.value)} disabled={saving}
                className="text-xs rounded px-2 py-1 bg-white text-gray-800 border-0 outline-none cursor-pointer transition-opacity"
                style={{ opacity: saving ? 0.6 : 1 }}>
                <option value="scheduled">Scheduled</option>
                <option value="received">CBS Received</option>
                <option value="active">Active</option>
                <option value="submitted">Submitted</option>
                <option value="pc-review">PC Review</option>
                <option value="comm-review">Commercial Review</option>
                <option value="invoice-ready">Invoice Ready</option>
                <option value="closed">Closed</option>
              </select>
            )}
            <button onClick={onClose} className="text-white hover:text-gray-300 ml-1 p-1 rounded hover:bg-white/10 transition-colors">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        <div className="flex border-b border-gray-200 flex-shrink-0">
          {(["info", "notes"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-6 py-3 text-sm font-medium transition-all relative flex items-center gap-2 ${tab === t ? "text-green-700" : "text-gray-500 hover:text-gray-700"}`}>
              {t === "info" ? (
                <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/><path d="M7 5v1M7 7.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>Details</>
              ) : (
                <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3h10v7H5l-3 2V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M5 6h4M5 8h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>Activity
                {detail && detail.internalNotes && detail.internalNotes.length > 0 && (
                  <span className="text-[10px] font-bold bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{detail.internalNotes.length}</span>
                )}
                </>
              )}
              {tab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-700 rounded-t" style={{ animation: "fadeIn .15s ease" }} />}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          {!detail ? (
            <div className="space-y-3 py-2">
              {[1,2,3,4,5].map(i => <div key={i} className="skeleton h-4 w-full" style={{ width: `${70 + i * 5}%` }} />)}
            </div>
          ) : tab === "info" ? (
            <div className="space-y-5" style={{ animation: "fadeIn .2s ease" }}>
              {/* Status timeline */}
              <div className="flex items-center gap-0 overflow-x-auto pb-2 -mx-1">
                {(["received", "active", "submitted", "pc-review", "comm-review", "invoice-ready", "closed"] as const).map((s, i, arr) => {
                  const cfg = getStatusCfg(s);
                  const statusOrder = ["scheduled", "received", "active", "submitted", "pc-review", "comm-review", "invoice-ready", "closed"];
                  const currentIdx = statusOrder.indexOf(detail.status);
                  const thisIdx = statusOrder.indexOf(s);
                  const isPast = thisIdx < currentIdx;
                  const isCurrent = thisIdx === currentIdx;
                  return (
                    <div key={s} className="flex items-center flex-shrink-0">
                      <div className="flex flex-col items-center gap-1 px-1">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold transition-all"
                          style={{
                            backgroundColor: isCurrent ? cfg.bg : isPast ? "#d1fae5" : "#f3f4f6",
                            color: isCurrent ? cfg.text : isPast ? "#065f46" : "#9ca3af",
                            border: isCurrent ? `2px solid ${cfg.dot}` : "2px solid transparent",
                            boxShadow: isCurrent ? `0 0 0 3px ${cfg.bg}` : "none",
                          }}
                        >
                          {isPast ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> : (i + 1)}
                        </div>
                        <span className={`text-[8px] font-semibold uppercase tracking-wide whitespace-nowrap ${isCurrent ? "text-gray-800" : isPast ? "text-green-700" : "text-gray-400"}`}>
                          {cfg.label.length > 10 ? cfg.label.slice(0, 8) + "…" : cfg.label}
                        </span>
                      </div>
                      {i < arr.length - 1 && (
                        <div className="w-4 h-0.5 flex-shrink-0 rounded-full" style={{ backgroundColor: isPast ? "#86efac" : "#e5e7eb" }} />
                      )}
                    </div>
                  );
                })}
              </div>

              <Section title="Information">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  <InfoRow label="Report Code" value={detail.id ?? "—"} />
                  <InfoRow label="Status" value={getStatusCfg(detail.status).label} />
                  <InfoRow label="Building Name" value={detail.building} />
                  <InfoRow label="Lift No." value={detail.equipmentCode} />
                  <InfoRow label="Equipment Type" value={detail.equipmentType} />
                  <InfoRow label="Maintenance Type" value={detail.maintenanceType} />
                  <InfoRow label="Technician" value={detail.technicianName} />
                  <InfoRow label="Assigned To" value={detail.assignedTo ?? "—"} />
                  <InfoRow label="Arrival Date" value={fmtDate(detail.arrivalDateTime)} />
                  <InfoRow label="Arrival Time" value={fmtTime(detail.arrivalDateTime)} />
                  <InfoRow label="Priority" value={detail.priority} />
                </div>
              </Section>
              <Section title="SLA Performance">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600 mb-1">Response Time</p>
                    <p className="text-lg font-bold text-green-800">45 <span className="text-xs font-semibold text-green-600">min</span></p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 mb-1">Work Duration</p>
                    <p className="text-lg font-bold text-blue-800">2.3 <span className="text-xs font-semibold text-blue-600">hrs</span></p>
                  </div>
                </div>
              </Section>

              {editing && (
                <>
                  <Section title="Edit Equipment">
                    <div className="space-y-3">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Original</p>
                        <p className="text-sm text-gray-700">{detail.equipmentType} — {detail.equipmentCode}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">New Equipment (Lift No.) <span className="text-red-500">*</span></label>
                        {equipmentList.length === 0 ? (
                          <div className="skeleton h-10 w-full" />
                        ) : (
                          <select value={editEquipmentId} onChange={e => setEditEquipmentId(e.target.value)} className={editInputCls + " bg-white"}>
                            {equipmentList.map(eq => (
                              <option key={eq.id} value={eq.id}>{eq.equipmentType} — {eq.equipmentCode}{eq.location ? ` (${eq.location})` : ""}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      {selectedEquipment && hasChanges && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                          <p className="text-xs font-semibold text-amber-600 uppercase mb-1">Changed to</p>
                          <p className="text-sm text-amber-800">{selectedEquipment.equipmentType} — {selectedEquipment.equipmentCode}</p>
                        </div>
                      )}
                    </div>
                  </Section>
                  <div className="flex gap-3 pt-2">
                    <button onClick={handleSaveEdit} disabled={saving || !hasChanges} className="btn-green px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "#1a7a4a" }}>
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button onClick={() => setEditing(false)} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">Cancel</button>
                  </div>
                </>
              )}

              {detail.findings && <Section title="Issue Description"><p className="text-sm text-gray-700 leading-relaxed">{detail.findings}</p></Section>}
              {detail.workPerformed && <Section title="Action Taken"><p className="text-sm text-gray-700 leading-relaxed">{detail.workPerformed}</p></Section>}
              {detail.remarks && <Section title="Remarks"><p className="text-sm text-gray-700 leading-relaxed">{detail.remarks}</p></Section>}
              {!editing && isEditable && (
                <button onClick={startEditing} className="btn-green px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5" style={{ backgroundColor: "#1a7a4a" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 8.5V10h1.5L9.2 4.3 7.7 2.8 2 8.5zM10.3 3.2l-1.5-1.5.7-.7 1.5 1.5-.7.7z" fill="currentColor"/></svg>
                  Edit Equipment
                </button>
              )}

              {detail.partsUsed && detail.partsUsed.length > 0 && (
                <Section title="Parts Replaced">
                  <ul className="space-y-1">{detail.partsUsed.map((p,i) => <li key={i} className="text-sm text-gray-700">{p.name} &times; {p.quantity}</li>)}</ul>
                </Section>
              )}
              {detail.checklistResults && (
                <Section title="Checklist Results">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm text-gray-600">{detail.checklistResults.checkedCount} / {detail.checklistResults.totalCount} items checked</span>
                    <span className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <span className="h-full bg-green-500 rounded-full block" style={{ width: `${Math.round(detail.checklistResults.checkedCount / Math.max(detail.checklistResults.totalCount, 1) * 100)}%`, transition: "width .4s ease" }} />
                    </span>
                  </div>
                  {detail.checklistResults.categories.map((cat, ci) => (
                    <div key={ci} className="mb-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{cat.category}</p>
                      <ul className="space-y-0.5">{cat.items.map((item, ii) => (
                        <li key={ii} className="flex items-center gap-2 text-xs text-gray-700">
                          <span>{item.checked ? "✅" : "⬜"}</span><span>{item.label}</span>
                        </li>
                      ))}</ul>
                    </div>
                  ))}
                </Section>
              )}
            </div>
          ) : (
            <div style={{ animation: "fadeIn .2s ease" }}>
              {/* Notes timeline */}
              <div className="space-y-0">
                {!detail.internalNotes || detail.internalNotes.length === 0
                  ? (
                    <div className="text-center py-12">
                      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-gray-400"><path d="M4 4h12v12H4z" stroke="currentColor" strokeWidth="1.3"/><path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      </div>
                      <p className="text-sm text-gray-400">No activity yet.</p>
                    </div>
                  )
                  : [...detail.internalNotes].sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime()).map((note, i, arr) => (
                    <div key={note.id} className="flex gap-3 group">
                      {/* Timeline line */}
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: note.kind === "system" ? "#86efac" : note.kind === "dispatch" ? "#93c5fd" : note.kind === "review" ? "#c4b5fd" : "#fcd34d" }} />
                        {i < arr.length - 1 && <div className="w-0.5 flex-1 bg-gray-100 my-1" />}
                      </div>
                      {/* Content */}
                      <div className="pb-4 flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-700">{note.author}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{
                            backgroundColor: note.kind === "system" ? "#f0fdf4" : note.kind === "dispatch" ? "#eff6ff" : note.kind === "review" ? "#f5f3ff" : "#fffbeb",
                            color: note.kind === "system" ? "#166534" : note.kind === "dispatch" ? "#1e40af" : note.kind === "review" ? "#5b21b6" : "#92400e",
                          }}>{note.kind}</span>
                          <span className="text-[10px] text-gray-400 ml-auto">{fmtDate(note.at)} {fmtTime(note.at)}</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">{note.text}</p>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>

        {/* Sticky note form at bottom — only on activity tab */}
        {tab === "notes" && detail && (
          <div className="border-t border-gray-200 bg-white p-4 rounded-b-2xl">
            <NoteForm code={code} onAdded={(note) => {
              setDetail(prev => prev ? { ...prev, internalNotes: [...(prev.internalNotes ?? []), note] } : prev);
              onToast("Note added", "success");
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  return (
    <Suspense>
      <AdminDashboardInner />
    </Suspense>
  );
}

function AdminDashboardInner() {
  const urlSearchParams = useSearchParams();
  const initialSearch = urlSearchParams.get("search") ?? "";

  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showBatchUpload, setShowBatchUpload] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const toastId = useRef(0);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [projectNameFilter, setProjectNameFilter] = useState("");
  const [partsFilter, setPartsFilter] = useState("");
  const [statsFilter, setStatsFilter] = useState<"myQueue" | "projectsThisMonth" | "activeJobs" | null>(null);
  const [viewMode, setViewMode] = useState<"card" | "table">("card");

  // Debounced search values
  const debouncedSearch = useDebounce(searchQuery, 300);
  const debouncedBuilding = useDebounce(buildingFilter, 300);
  const debouncedProject = useDebounce(projectNameFilter, 300);
  const debouncedParts = useDebounce(partsFilter, 300);

  function addToast(text: string, kind: "success" | "error" = "success") {
    const id = ++toastId.current;
    setToasts(p => [...p, { id, text, kind }]);
  }
  function removeToast(id: number) { setToasts(p => p.filter(t => t.id !== id)); }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      const [ordersRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/maintenance-reports/admin/list?${params}`),
        fetch(`${API_BASE}/maintenance-reports/admin/stats?${params}`),
      ]);
      setOrders(await ordersRes.json());
      setStats(await statsRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, statusFilter]);

  useEffect(() => { setCurrentPage(1); setStatsFilter(null); void fetchData(); }, [fetchData]);

  const uniqueBuildings = useMemo(() => [...new Set(orders.map(o => o.building).filter(Boolean))].sort(), [orders]);
  const uniqueProjectNames = useMemo(() => [...new Set(orders.map(o => o.maintenanceType).filter(Boolean))].sort(), [orders]);
  const uniqueParts = useMemo(() => {
    const names = new Set<string>();
    orders.forEach(o => o.partsUsed?.forEach(p => { if (p.name.trim()) names.add(p.name.trim()); }));
    return [...names].sort();
  }, [orders]);
  const uniqueReportCodes = useMemo(() => orders.map(o => o.id).filter(Boolean).sort(), [orders]);

  const sortedOrders = useMemo(() => {
    let filtered = orders;

    if (debouncedSearch) filtered = filtered.filter(o => o.id?.toLowerCase().includes(debouncedSearch.toLowerCase()));
    if (debouncedBuilding && debouncedBuilding !== "all") {
      const q = debouncedBuilding.toLowerCase();
      filtered = filtered.filter(o => o.building?.toLowerCase().includes(q));
    }
    if (debouncedProject) {
      const q = debouncedProject.toLowerCase();
      filtered = filtered.filter(o => o.maintenanceType?.toLowerCase().includes(q) || o.id?.toLowerCase().includes(q));
    }
    if (debouncedParts) {
      const q = debouncedParts.toLowerCase();
      filtered = filtered.filter(o => o.partsUsed?.some(p => p.name.toLowerCase().includes(q)));
    }

    if (statsFilter) {
      filtered = filtered.filter((o) => {
        if (statsFilter === "myQueue") return o.status !== "invoice-ready" && o.status !== "closed" && o.status !== "cancelled";
        if (statsFilter === "activeJobs") return o.status === "active" || o.status === "in-progress";
        if (statsFilter === "projectsThisMonth") {
          const now = new Date();
          const d = new Date(o.arrivalDateTime);
          return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
        }
        return true;
      });
    }

    return [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, debouncedSearch, debouncedBuilding, debouncedProject, debouncedParts, statsFilter]);

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / pageSize));
  const paginatedOrders = sortedOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function handleStatusChange(code: string, status: string) {
    setOrders(p => p.map(o => o.id === code ? { ...o, status } : o));
  }

  const inputCls = "border border-gray-300 rounded px-2 py-1 text-sm outline-none transition-all focus:border-green-600 focus:ring-2 focus:ring-green-100";

  return (
    <>
      <style>{ANIM_STYLES}</style>

      {/* Sticky filter bar */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4 sticky top-3 z-10 shadow-sm overflow-hidden">
        {/* Row 1: Date range + Status + Actions */}
        <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-gray-400"><rect x="1" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M1 5.5h12M4 1v3M10 1v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={`${inputCls} w-[130px]`} />
            <span className="text-gray-300">—</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={`${inputCls} w-[130px]`} />
          </div>
          <div className="h-5 w-px bg-gray-200 hidden sm:block" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} bg-white`}>
            <option value="all">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="received">CBS Received</option>
            <option value="active">Active</option>
            <option value="submitted">Submitted</option>
            <option value="pc-review">PC Review</option>
            <option value="comm-review">Commercial Review</option>
            <option value="invoice-ready">Invoice Ready</option>
            <option value="closed">Closed</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            <button
              disabled={orders.length === 0}
              onClick={() => {
                const rows = orders.map((o) => ({
                  "Report Code": o.id ?? "",
                  "Building": o.building ?? "",
                  "Equipment Code": o.equipmentCode ?? "",
                  "Equipment Type": o.equipmentType ?? "",
                  "Status": getStatusCfg(o.status).label,
                  "Maintenance Type": o.maintenanceType ?? "",
                  "Technician": o.technicianName ?? "",
                  "Arrival Date": o.arrivalDateTime ? fmtDate(o.arrivalDateTime) : "",
                  "Arrival Time": o.arrivalDateTime ? fmtTime(o.arrivalDateTime) : "",
                  "Priority": o.priority ?? "",
                  "Findings": o.findings ?? "",
                  "Work Performed": o.workPerformed ?? "",
                  "Parts Used": o.partsUsed?.map((p: { name: string; quantity: number }) => `${p.name} x${p.quantity}`).join(", ") ?? "",
                  "Submitted At": o.submittedAt ? fmtDate(o.submittedAt) : "",
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Work Orders");
                ws["!cols"] = Object.keys(rows[0] ?? {}).map(() => ({ wch: 20 }));
                XLSX.writeFile(wb, `Finance_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-all active:scale-95"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3.5 6.5L6.5 9l3-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 10.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Export
            </button>
            <button onClick={() => setShowBatchUpload(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all active:scale-95">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 10V2M4 5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Batch Upload
            </button>
            <button onClick={() => setShowAddProject(true)} className="btn-green text-xs font-semibold px-4 py-2 rounded-lg text-white flex items-center gap-1.5 shadow-sm active:scale-95 transition-all" style={{ backgroundColor: "#1a7a4a" }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              Add Project
            </button>
          </div>
        </div>

        {/* Row 2: Search filters */}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3 bg-gray-50/60">
          <div className="flex items-center gap-1.5 text-sm">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="text-gray-400"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/><path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            <input type="text" list="report-code-list" placeholder="Report code" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }} className={`${inputCls} w-28 sm:w-32`} />
            <datalist id="report-code-list">{uniqueReportCodes.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="h-4 w-px bg-gray-200 hidden sm:block" />
          <input type="text" list="building-list" placeholder="Building" value={buildingFilter === "all" ? "" : buildingFilter} onChange={e => { setBuildingFilter(e.target.value || "all"); setCurrentPage(1); }} className={`${inputCls} w-28 sm:w-40`} />
          <datalist id="building-list">{uniqueBuildings.map(b => <option key={b} value={b} />)}</datalist>
          <input type="text" list="project-name-list" placeholder="Project name" value={projectNameFilter} onChange={e => { setProjectNameFilter(e.target.value); setCurrentPage(1); }} className={`${inputCls} w-28 sm:w-36`} />
          <datalist id="project-name-list">{uniqueProjectNames.map(n => <option key={n} value={n} />)}</datalist>
          <input type="text" list="parts-list" placeholder="Item / Parts" value={partsFilter} onChange={e => { setPartsFilter(e.target.value); setCurrentPage(1); }} className={`${inputCls} w-28 sm:w-32`} />
          <datalist id="parts-list">{uniqueParts.map(p => <option key={p} value={p} />)}</datalist>
        </div>

        {/* Row 3: Active filter pills */}
        {(searchQuery || (buildingFilter && buildingFilter !== "all") || projectNameFilter || partsFilter || fromDate || toDate || statusFilter !== "all" || statsFilter) && (
          <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-t border-gray-100 bg-white">
            <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mr-1">Filters:</span>
            {fromDate && (
              <span className="filter-pill">From: {fromDate}<button onClick={() => setFromDate("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {toDate && (
              <span className="filter-pill">To: {toDate}<button onClick={() => setToDate("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {statusFilter !== "all" && (
              <span className="filter-pill">Status: {getStatusCfg(statusFilter).label}<button onClick={() => setStatusFilter("all")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {searchQuery && (
              <span className="filter-pill">Code: {searchQuery}<button onClick={() => setSearchQuery("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {buildingFilter && buildingFilter !== "all" && (
              <span className="filter-pill">Building: {buildingFilter}<button onClick={() => setBuildingFilter("all")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {projectNameFilter && (
              <span className="filter-pill">Project: {projectNameFilter}<button onClick={() => setProjectNameFilter("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {partsFilter && (
              <span className="filter-pill">Parts: {partsFilter}<button onClick={() => setPartsFilter("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {statsFilter && (
              <span className="filter-pill">Stat: {statsFilter === "myQueue" ? "My Queue" : statsFilter === "projectsThisMonth" ? "This Month" : "Active"}<button onClick={() => setStatsFilter(null)}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            <button
              onClick={() => { setSearchQuery(""); setBuildingFilter("all"); setProjectNameFilter(""); setPartsFilter(""); setFromDate(""); setToDate(""); setStatusFilter("all"); setStatsFilter(null); setCurrentPage(1); }}
              className="text-[10px] text-red-500 hover:text-red-700 font-semibold transition-colors ml-auto flex items-center gap-1"
            >
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <StatCard iconKey="queue" label="My Queue" value={stats?.myQueue ?? 0} active={statsFilter === "myQueue"} onClick={() => { setStatsFilter(f => f === "myQueue" ? null : "myQueue"); setCurrentPage(1); }} />
        <StatCard iconKey="projects" label="Projects This Month" value={stats?.projectsThisMonth ?? 0} active={statsFilter === "projectsThisMonth"} onClick={() => { setStatsFilter(f => f === "projectsThisMonth" ? null : "projectsThisMonth"); setCurrentPage(1); }} />
        <StatCard iconKey="active" label="Active Jobs" value={stats?.activeJobs ?? 0} active={statsFilter === "activeJobs"} onClick={() => { setStatsFilter(f => f === "activeJobs" ? null : "activeJobs"); setCurrentPage(1); }} />
        <StatCard iconKey="response" label="Avg Response" value={stats?.avgResponseTimeMin ?? 45} unit="MIN" ok={true} />
        <StatCard iconKey="duration" label="Avg Duration" value={stats?.avgWorkDurationHrs ?? 2.3} unit="HRS" ok={true} />
      </div>

      {/* Work orders header */}
      <div className="rounded-t-xl px-5 py-3 flex items-center justify-between" style={{ backgroundColor: "#1a3a2a" }}>
        <div className="flex items-center gap-3">
          <h2 className="text-white font-bold text-sm uppercase tracking-widest">
            {statsFilter === "myQueue" ? "My Queue" : statsFilter === "projectsThisMonth" ? "Projects This Month" : statsFilter === "activeJobs" ? "Active Jobs" : "Work Orders"}
          </h2>
          {!loading && (
            <span className="text-green-400/80 text-xs font-medium bg-white/10 px-2 py-0.5 rounded-full">
              {sortedOrders.length}{sortedOrders.length !== orders.length ? ` / ${orders.length}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5">
            <button onClick={() => setViewMode("card")} className={`p-1.5 rounded transition-all ${viewMode === "card" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80"}`} title="Card view">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
            <button onClick={() => setViewMode("table")} className={`p-1.5 rounded transition-all ${viewMode === "table" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80"}`} title="Table view">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 3h12M1 7h12M1 11h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </button>
          </div>
          {statsFilter && (
            <button onClick={() => { setStatsFilter(null); setCurrentPage(1); }} className="text-xs text-green-300 hover:text-white transition-colors flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Clear stat filter
            </button>
          )}
        </div>
      </div>

      {/* Work orders list */}
      {loading ? (
        <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      ) : sortedOrders.length === 0 ? (
        <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 p-16 text-center" style={{ animation: "fadeIn .3s ease" }}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-gray-400"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M8 8h8M8 12h8M8 16h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </div>
          <p className="text-gray-500 font-medium">{orders.length === 0 ? "No work orders found" : "No results match your filters"}</p>
          <p className="text-gray-400 text-sm mt-1">{orders.length === 0 ? "Create a new CBS Call to get started." : "Try adjusting or clearing your filters."}</p>
          {orders.length === 0 && (
            <button onClick={() => setShowAddProject(true)} className="btn-green mt-4 text-sm font-semibold px-5 py-2.5 rounded-lg text-white inline-flex items-center gap-2 shadow-sm active:scale-95 transition-all" style={{ backgroundColor: "#1a7a4a" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              Add Project
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 p-4">
          {viewMode === "card" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {paginatedOrders.map((order, i) => (
                <WorkOrderCard key={order.id ?? order.createdAt} order={order} index={i} onClick={() => order.id && setSelectedCode(order.id)} />
              ))}
            </div>
          ) : (
            /* Table view */
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Code</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Building</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5 hidden md:table-cell">Equipment</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5 hidden lg:table-cell">Technician</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Type</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Priority</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Date</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders.map((order, i) => {
                    const prio = PRIORITY_COLORS[order.priority] ?? PRIORITY_COLORS.Medium;
                    return (
                      <tr key={order.id ?? order.createdAt} onClick={() => order.id && setSelectedCode(order.id)}
                        className="table-row cursor-pointer border-b border-gray-50 last:border-0"
                        style={{ animation: `fadeIn .2s ${i * 0.02}s ease both` }}>
                        <td className="px-3 py-2.5 font-mono font-bold text-gray-800 text-xs whitespace-nowrap">{order.id ?? "—"}</td>
                        <td className="px-3 py-2.5 text-gray-700 font-medium text-xs">{order.building}</td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs hidden md:table-cell">{order.equipmentCode}</td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs hidden lg:table-cell">{order.technicianName}</td>
                        <td className="px-3 py-2.5"><span className="text-[10px] font-semibold uppercase text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{order.maintenanceType}</span></td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ backgroundColor: prio.bg, color: prio.text }}>{order.priority}</span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">{fmtDate(order.arrivalDateTime)}</td>
                        <td className="px-3 py-2.5"><StatusBadge status={order.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination + page size */}
          {(totalPages > 1 || sortedOrders.length > 10) && (
            <div className="flex flex-wrap items-center justify-between mt-4 pt-4 border-t border-gray-100 gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sortedOrders.length)} of {sortedOrders.length}
                </span>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span>Show</span>
                  {[10, 25, 50].map(size => (
                    <button key={size} onClick={() => { setPageSize(size); setCurrentPage(1); }}
                      className={`min-w-[32px] py-1 rounded border text-xs transition-all ${pageSize === size ? "bg-green-700 text-white border-green-700 font-bold" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                    ‹ Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .reduce<(number | "ellipsis")[]>((acc, p, idx, arr) => {
                      if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("ellipsis");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === "ellipsis" ? (
                        <span key={`e${idx}`} className="px-1.5 text-xs text-gray-400">…</span>
                      ) : (
                        <button key={item} onClick={() => setCurrentPage(item)}
                          className={`min-w-[30px] py-1.5 text-xs rounded border transition-all ${currentPage === item ? "bg-green-700 text-white border-green-700 font-bold" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                          {item}
                        </button>
                      )
                    )}
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                    Next ›
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {selectedCode && (
        <DetailModal
          code={selectedCode}
          onClose={() => setSelectedCode(null)}
          onStatusChange={handleStatusChange}
          onToast={addToast}
          onDetailUpdated={fetchData}
        />
      )}

      {/* Add Project modal */}
      {showAddProject && (
        <AddProjectModal
          onClose={() => setShowAddProject(false)}
          onCreated={(msg) => { void fetchData(); addToast(msg, "success"); }}
        />
      )}

      {/* Batch Upload modal */}
      {showBatchUpload && (
        <BatchUploadModal
          onClose={() => setShowBatchUpload(false)}
          onDone={() => { void fetchData(); addToast("Batch upload completed", "success"); }}
          buildings={uniqueBuildings}
        />
      )}

      {/* Toast container */}
      <ToastContainer toasts={toasts} remove={removeToast} />
    </>
  );
}
