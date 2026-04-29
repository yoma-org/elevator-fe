"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

type ChecklistItem = string | { no?: string; label?: string };
interface ChecklistGroup {
  category: string;
  items: ChecklistItem[];
}

interface Props {
  row: {
    building_id: string;
    building_name: string;
    team: string | null;
    equipment_id: string;
    equipment_code: string;
    equipment_type: string;
  };
  onClose: () => void;
  onSaved: (msg: string) => void;
  token?: string | null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getItemLabel(item: ChecklistItem): string {
  return typeof item === "string" ? item : item.label ?? "";
}

const CHECKLIST_STATUSES = ["good", "adjusted", "repair", "na"] as const;
const CHECKLIST_STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  good:     { label: "Good",             color: "#166534", bg: "#dcfce7", border: "#16a34a" },
  adjusted: { label: "Adjusted",         color: "#854d0e", bg: "#fef9c3", border: "#ca8a04" },
  repair:   { label: "Repair / Replace", color: "#991b1b", bg: "#fee2e2", border: "#ef4444" },
  na:       { label: "N/A",              color: "#475569", bg: "#f1f5f9", border: "#94a3b8" },
};

export default function AddHistoryModal({ row, onClose, onSaved, token }: Props) {
  const [completionDate, setCompletionDate] = useState<string>(todayISO());
  const [checklist, setChecklist] = useState<ChecklistGroup[] | null>(null);
  const [loadingChecklist, setLoadingChecklist] = useState(true);
  // key = `${ci}-${ii}`, value = array of selected statuses (good/adjusted/repair/na)
  const [statusMap, setStatusMap] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [takenDates, setTakenDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoadingChecklist(true);
    fetch(`${API_BASE}/checklists/template?equipment_type=${encodeURIComponent(row.equipment_type)}`)
      .then((r) => r.json())
      .then((j) => {
        // API returns { success, data: { categories } } — fallback to top-level categories for safety
        const cats: ChecklistGroup[] = j?.data?.categories ?? j?.categories ?? [];
        setChecklist(cats);
      })
      .catch(() => setError("Failed to load checklist template"))
      .finally(() => setLoadingChecklist(false));

    // Fetch dates already used to prevent duplicates
    fetch(`${API_BASE}/maintenance-reports/admin/equipment-dates/${row.equipment_id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((j) => {
        const dates: string[] = j?.dates ?? [];
        setTakenDates(new Set(dates));
      })
      .catch(() => {});
  }, [row.equipment_type, row.equipment_id, token]);

  // Single-select: clicking the active status clears it; clicking a different status replaces.
  function toggleStatus(ci: number, ii: number, status: string) {
    const key = `${ci}-${ii}`;
    setStatusMap((p) => {
      const current = p[key] ?? [];
      const isActive = current.length === 1 && current[0] === status;
      const next = isActive ? [] : [status];
      return { ...p, [key]: next };
    });
  }
  function setAllInCategory(ci: number, status: string | null) {
    if (!checklist) return;
    const cat = checklist[ci];
    setStatusMap((p) => {
      const next = { ...p };
      cat.items.forEach((_, ii) => {
        const key = `${ci}-${ii}`;
        next[key] = status === null ? [] : [status];
      });
      return next;
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!completionDate) { setError("Completion date is required"); return; }
    if (takenDates.has(completionDate)) {
      setError(`A maintenance record already exists on ${completionDate}. Please pick a different date.`);
      return;
    }

    const items: Array<{ label: string; statuses: string[] }> = [];
    if (checklist) {
      for (let ci = 0; ci < checklist.length; ci++) {
        for (let ii = 0; ii < checklist[ci].items.length; ii++) {
          const statuses = statusMap[`${ci}-${ii}`] ?? [];
          if (statuses.length === 0) continue;
          const label = getItemLabel(checklist[ci].items[ii]);
          if (label) items.push({ label, statuses });
        }
      }
    }

    if (totalItems === 0) {
      setError("No checklist template available for this equipment type.");
      return;
    }
    if (items.length < totalItems) {
      setError(`Please assign a status to all ${totalItems} checklist items (${items.length}/${totalItems} assessed).`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/maintenance-reports/admin/history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          buildingId: row.building_id,
          equipmentId: row.equipment_id,
          completionDateTime: `${completionDate}T00:00:00`,
          items,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.message ?? `Failed (${res.status})`);
        return;
      }
      const data = await res.json();
      onSaved(`History added for ${row.equipment_code}: ${data.checkedCount}/${data.totalCount} items checked`);
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const totalItems = checklist?.reduce((n, c) => n + c.items.length, 0) ?? 0;
  const checkedCount = Object.values(statusMap).filter((arr) => (arr ?? []).length > 0).length;
  const readonlyCls = "w-full h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 cursor-not-allowed";
  const inputCls = "w-full h-10 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-all";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overlay-fade" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="modal-slide bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Add Maintenance History</h2>
            <p className="text-xs text-gray-500 mt-0.5">Backfill a closed maintenance record for this equipment</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Read-only fields grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">Building</label>
              <input value={row.building_name} readOnly className={readonlyCls} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">Equipment Type</label>
              <input value={row.equipment_type} readOnly className={readonlyCls} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">Equipment ID</label>
              <input value={row.equipment_code} readOnly className={readonlyCls + " font-mono"} />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">Team</label>
              <input value={row.team ?? "—"} readOnly className={readonlyCls} />
            </div>
          </div>

          {/* Completion Date */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">
              Completion Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
              max={todayISO()}
              className={inputCls + (takenDates.has(completionDate) ? " border-red-500 bg-red-50" : "")}
            />
            {takenDates.has(completionDate) ? (
              <p className="text-[11px] text-red-600 mt-1 font-medium">
                ⚠ A maintenance record already exists on this date. Please pick another.
              </p>
            ) : takenDates.size > 0 ? (
              <p className="text-[11px] text-gray-400 mt-1">{takenDates.size} date(s) already used for this equipment</p>
            ) : null}
          </div>

          {/* Checklist */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-600">Service Checklist</label>
              {totalItems > 0 && (
                <span className="text-[11px] text-gray-500">{checkedCount} / {totalItems} checked</span>
              )}
            </div>
            <div className="border border-gray-200 rounded-lg max-h-[280px] overflow-y-auto">
              {loadingChecklist ? (
                <div className="p-4 text-center text-sm text-gray-400">Loading checklist...</div>
              ) : !checklist || checklist.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-400">
                  No checklist template found for &quot;{row.equipment_type}&quot;
                </div>
              ) : (
                checklist.map((cat, ci) => (
                  <div key={ci} className="border-b border-gray-100 last:border-0">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600">{cat.category}</p>
                      <div className="flex gap-2 text-[10px]">
                        <button type="button" onClick={() => setAllInCategory(ci, "good")} className="text-green-700 hover:underline">All Good</button>
                        <button type="button" onClick={() => setAllInCategory(ci, null)} className="text-gray-500 hover:underline">Clear</button>
                      </div>
                    </div>
                    <ul className="divide-y divide-gray-50">
                      {cat.items.map((item, ii) => {
                        const key = `${ci}-${ii}`;
                        const label = getItemLabel(item);
                        const no = typeof item === "object" && item.no ? item.no : null;
                        const currentStatuses = statusMap[key] ?? [];
                        return (
                          <li key={ii} className="px-3 py-2">
                            <div className="flex items-start gap-2 mb-1.5">
                              {no && <span className="text-[10px] font-mono text-gray-400 w-7 mt-0.5 flex-shrink-0">{no}</span>}
                              <span className="text-sm text-gray-700 flex-1">{label}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 ml-7">
                              {CHECKLIST_STATUSES.map((status) => {
                                const cfg = CHECKLIST_STATUS_LABELS[status];
                                const isSelected = currentStatuses.includes(status);
                                return (
                                  <button
                                    key={status}
                                    type="button"
                                    onClick={() => toggleStatus(ci, ii, status)}
                                    className="rounded-md border-2 px-2 py-0.5 text-[11px] font-semibold transition-all"
                                    style={isSelected
                                      ? { borderColor: cfg.border, background: cfg.bg, color: cfg.color }
                                      : { borderColor: "#e2e8f0", background: "#fff", color: "#94a3b8" }
                                    }
                                  >
                                    {cfg.label}
                                  </button>
                                );
                              })}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 flex-shrink-0 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-gray-700 rounded-lg border border-gray-300 hover:bg-white transition-all"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => handleSave(e as any)}
            disabled={submitting || loadingChecklist || checkedCount < totalItems || totalItems === 0 || takenDates.has(completionDate)}
            title={
              takenDates.has(completionDate)
                ? "A record already exists on this date"
                : totalItems === 0
                  ? "No checklist template available"
                  : checkedCount < totalItems
                    ? `Assign a status to all ${totalItems} items (${checkedCount}/${totalItems} done)`
                    : ""
            }
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-green-700 hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
          >
            {submitting ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="animate-spin"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                Saving...
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
