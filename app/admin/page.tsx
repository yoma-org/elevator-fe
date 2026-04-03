"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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

// ─── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, unit, ok }: { icon: string; label: string; value: string | number; unit?: string; ok?: boolean; }) {
  const isNum = typeof value === "number";
  return (
    <div className="flex-1 bg-white rounded-lg px-5 py-4 border border-gray-200 min-w-0 card-hover" style={{ animation: "slideUp .3s ease both" }}>
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
        <span>{icon}</span>
        <span className="font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold text-gray-800">
          {isNum ? <AnimatedNumber target={value as number} /> : value}
        </span>
        {unit && <span className="text-sm font-semibold text-gray-500 uppercase ml-1">{unit}</span>}
        {ok !== undefined && <span className="ml-1 text-base">{ok ? "✅" : "⚠️"}</span>}
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

function WorkOrderCard({ order, onClick, index }: { order: WorkOrder; onClick: () => void; index: number; }) {
  const isActive = order.status === "active" || order.status === "in-progress";
  const isScheduled = order.status === "scheduled";
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-4 card-hover"
      style={{ animation: `slideUp .25s ${index * 0.04}s ease both` }}
    >
      <div className="flex items-start justify-between mb-3 gap-2">
        <span className="text-sm font-bold text-gray-800 font-mono tracking-tight">{order.id ?? "—"}</span>
        <StatusBadge status={order.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-3">
        <div><span className="text-gray-400">Building: </span><span className="text-gray-700 font-medium">{order.building}</span></div>
        <div><span className="text-gray-400">Lift No.: </span><span className="text-gray-700 font-medium">{order.equipmentCode}</span></div>
        <div><span className="text-gray-400">Technician: </span><span className="text-gray-700 font-medium">{order.technicianName}</span></div>
        {isScheduled
          ? <div><span className="text-gray-400">Type: </span><span className="text-gray-700 font-medium">{order.maintenanceType}</span></div>
          : <div><span className="text-gray-400">Date: </span><span className="text-gray-700 font-medium">{fmtDate(order.arrivalDateTime)}</span></div>
        }
      </div>

      {!isScheduled && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
          <div><span className="text-gray-400">Response: </span><span className="text-green-600 font-medium">45 mins ✅ Met SLA</span></div>
          {isActive
            ? <div><span className="text-gray-400">Started: </span><span className="text-gray-700 font-medium">{fmtDate(order.arrivalDateTime)} {fmtTime(order.arrivalDateTime)}</span></div>
            : <div><span className="text-gray-400">Duration: </span><span className="text-green-600 font-medium">2.3 hrs ✅ Met SLA</span></div>
          }
        </div>
      )}

      {order.findings && (
        <p className="text-xs text-gray-500 mb-3 line-clamp-2 leading-relaxed">{order.findings}</p>
      )}

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={onClick}
          className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-all"
        >
          View Details
        </button>
        {order.status === "invoice-ready" && (
          <button className="btn-green text-xs px-3 py-1.5 rounded text-white font-semibold" style={{ backgroundColor: "#1a7a4a" }}>
            Generate MMPR
          </button>
        )}
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
            <button type="submit" disabled={submitting} className="btn-green flex-1 py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60" style={{ backgroundColor: "#1a7a4a" }}>
              {submitting
                ? <><svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: "spinArc .7s linear infinite" }}><circle cx="7" cy="7" r="5" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="2"/><path d="M7 2A5 5 0 0 1 12 7" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/></svg>Creating...</>
                : "✓ Create CBS Call"
              }
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 transition-colors">Close</button>
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

// ─── DetailModal ───────────────────────────────────────────────────────────────

function DetailModal({ code, onClose, onStatusChange, onToast }: {
  code: string; onClose: () => void;
  onStatusChange: (code: string, status: string) => void;
  onToast: (msg: string, kind: "success" | "error") => void;
}) {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [tab, setTab] = useState<"info" | "notes">("info");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDetail(null);
    fetch(`${API_BASE}/maintenance-reports/admin/${code}`).then(r => r.json()).then(setDetail).catch(console.error);
  }, [code]);

  async function handleStatusChange(status: string) {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/maintenance-reports/admin/${code}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      onStatusChange(code, status);
      if (detail) setDetail({ ...detail, status });
      onToast(`Status updated to ${getStatusCfg(status).label}`, "success");
    } catch {
      onToast("Failed to update status", "error");
    } finally {
      setSaving(false);
    }
  }

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
              className={`px-6 py-3 text-sm font-medium transition-all relative ${tab === t ? "text-green-700" : "text-gray-500 hover:text-gray-700"}`}>
              {t === "info" ? "Details" : "Notes & Activity"}
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
              <Section title="Information">
                <InfoRow label="Report Code" value={detail.id ?? "—"} />
                <InfoRow label="Building Name" value={detail.building} />
                <InfoRow label="Lift No." value={detail.equipmentCode} />
                <InfoRow label="Equipment Type" value={detail.equipmentType} />
                <InfoRow label="Maintenance Type" value={detail.maintenanceType} />
                <InfoRow label="Technician" value={detail.technicianName} />
                <InfoRow label="Assigned To" value={detail.assignedTo ?? "—"} />
                <InfoRow label="Arrival Date" value={fmtDate(detail.arrivalDateTime)} />
                <InfoRow label="Arrival Time" value={fmtTime(detail.arrivalDateTime)} />
                <InfoRow label="Priority" value={detail.priority} />
                <InfoRow label="Status" value={getStatusCfg(detail.status).label} />
              </Section>
              <Section title="SLA Performance">
                <InfoRow label="Response Time" value="45 minutes" />
                <InfoRow label="Work Duration" value="2.3 hours" />
              </Section>
              {detail.findings && <Section title="Issue Description"><p className="text-sm text-gray-700 leading-relaxed">{detail.findings}</p></Section>}
              {detail.workPerformed && <Section title="Action Taken"><p className="text-sm text-gray-700 leading-relaxed">{detail.workPerformed}</p></Section>}
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
              {detail.remarks && <Section title="Remarks"><p className="text-sm text-gray-700 leading-relaxed">{detail.remarks}</p></Section>}
            </div>
          ) : (
            <div className="space-y-3" style={{ animation: "fadeIn .2s ease" }}>
              {!detail.internalNotes || detail.internalNotes.length === 0
                ? <p className="text-sm text-gray-400 text-center py-8">No activity yet.</p>
                : [...detail.internalNotes].sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime()).map(note => (
                  <div key={note.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50 hover:bg-white transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-700">{note.author}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: note.kind === "system" ? "#f0fdf4" : "#eff6ff", color: note.kind === "system" ? "#166534" : "#1e40af" }}>{note.kind}</span>
                      <span className="text-xs text-gray-400 ml-auto">{fmtDate(note.at)} {fmtTime(note.at)}</span>
                    </div>
                    <p className="text-sm text-gray-700">{note.text}</p>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const toastId = useRef(0);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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
        fetch(`${API_BASE}/maintenance-reports/admin/stats`),
      ]);
      setOrders(await ordersRes.json());
      setStats(await statsRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, statusFilter]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  function handleStatusChange(code: string, status: string) {
    setOrders(p => p.map(o => o.id === code ? { ...o, status } : o));
  }

  const inputCls = "border border-gray-300 rounded px-2 py-1 text-sm outline-none transition-all focus:border-green-600 focus:ring-2 focus:ring-green-100";

  return (
    <>
      <style>{ANIM_STYLES}</style>

      {/* Sticky filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 mb-3 flex flex-wrap items-center gap-4 sticky top-3 z-10 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <span className="text-gray-400">📅</span>
          <span className="font-medium">From:</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inputCls} />
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <span className="font-medium">To:</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inputCls} />
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <span className="text-gray-400 text-xs">▼</span>
          <span className="font-medium">Status:</span>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} bg-white`}>
            <option value="all">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="received">CBS Received</option>
            <option value="active">Active</option>
            <option value="submitted">Submitted</option>
            <option value="pc-review">PC Review</option>
            <option value="comm-review">Commercial Review</option>
            <option value="invoice-ready">Invoice Ready</option>
          </select>
        </div>
        <div className="ml-auto">
          <button onClick={() => setShowAddProject(true)} className="btn-green text-sm font-semibold px-4 py-2 rounded text-white" style={{ backgroundColor: "#1a7a4a" }}>
            + Add Project
          </button>
        </div>
      </div>

      {/* Finance export row */}
      <div className="mb-3 flex items-center gap-2 text-sm text-gray-600">
        <span className="font-medium">Finance Report Export:</span>
        <button className="btn-green inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded" style={{ backgroundColor: "#e67e22", color: "#fff" }}>
          ↓ Download Finance Report (CSV)
        </button>
      </div>

      {/* Stats row */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <StatCard icon="📋" label="My Queue"            value={stats?.myQueue ?? 0} />
        <StatCard icon="📅" label="Projects This Month" value={stats?.projectsThisMonth ?? 0} />
        <StatCard icon="⚡" label="Active Jobs"         value={stats?.activeJobs ?? 0} />
        <StatCard icon="🕐" label="Avg Response Time"   value={stats?.avgResponseTimeMin ?? 45} unit="MIN" ok={true} />
        <StatCard icon="⏱" label="Avg Work Duration"   value={stats?.avgWorkDurationHrs ?? 2.3} unit="HRS" ok={true} />
      </div>

      {/* Work orders header */}
      <div className="rounded-t-lg px-5 py-3 flex items-center justify-between" style={{ backgroundColor: "#1a3a2a" }}>
        <h2 className="text-white font-bold text-sm uppercase tracking-widest">All Work Orders</h2>
        {!loading && <span className="text-green-300 text-xs">{orders.length} records</span>}
      </div>

      {/* Work orders list */}
      {loading ? (
        <div className="bg-white rounded-b-lg border border-t-0 border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-b-lg border border-t-0 border-gray-200 p-16 text-center" style={{ animation: "fadeIn .3s ease" }}>
          <div className="text-5xl mb-4">📋</div>
          <p className="text-gray-500 font-medium">No work orders found</p>
          <p className="text-gray-400 text-sm mt-1">Try adjusting the filters or create a new CBS Call.</p>
          <button onClick={() => setShowAddProject(true)} className="btn-green mt-4 text-sm font-semibold px-4 py-2 rounded text-white inline-block" style={{ backgroundColor: "#1a7a4a" }}>
            + Add Project
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-b-lg border border-t-0 border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {orders.map((order, i) => (
              <WorkOrderCard key={order.id ?? order.createdAt} order={order} index={i} onClick={() => order.id && setSelectedCode(order.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedCode && (
        <DetailModal
          code={selectedCode}
          onClose={() => setSelectedCode(null)}
          onStatusChange={handleStatusChange}
          onToast={addToast}
        />
      )}

      {/* Add Project modal */}
      {showAddProject && (
        <AddProjectModal
          onClose={() => setShowAddProject(false)}
          onCreated={(msg) => { void fetchData(); addToast(msg, "success"); }}
        />
      )}

      {/* Toast container */}
      <ToastContainer toasts={toasts} remove={removeToast} />
    </>
  );
}
