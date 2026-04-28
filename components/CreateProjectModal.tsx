"use client";

import { useEffect, useRef, useState } from "react";
import { Combobox } from "./Combobox";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

interface Props {
  onClose: () => void;
  onCreated: (msg: string) => void;
  token?: string | null;
}

export default function CreateProjectModal({ onClose, onCreated, token }: Props) {
  const [buildingName, setBuildingName] = useState("");
  const [teams, setTeams] = useState<string[]>([]);
  const [equipmentType, setEquipmentType] = useState("");
  const [equipmentCodes, setEquipmentCodes] = useState<Array<{ id: string; value: string }>>([{ id: "ec-0", value: "" }]);
  const nextId = useRef(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [knownTypes, setKnownTypes] = useState<{ value: string; label: string }[]>([]);
  const [knownTeams, setKnownTeams] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/equipment/types`)
      .then((r) => r.json())
      .then((j) => {
        const list: any[] = j?.data ?? j ?? [];
        // Backend trả field tên là `equipment_type` (alias từ name) — fallback sang `name` nếu shape thay đổi
        const uniq = [...new Set(list.map((t) => String(t.equipment_type ?? t.name ?? "").trim()).filter(Boolean))];
        setKnownTypes(uniq.map((name) => ({ value: name, label: name })));
      })
      .catch(() => {});

    fetch(`${API_BASE}/equipment/buildings`)
      .then((r) => r.json())
      .then((j) => {
        const list: any[] = j?.data ?? j ?? [];
        const teams = [
          ...new Set(
            list
              .map((b: any) => b.team)
              .filter(Boolean)
              .flatMap((t: string) => t.split(",").map((s) => s.trim()))
              .filter(Boolean),
          ),
        ].sort();
        setKnownTeams(teams.map((t) => ({ value: t, label: t })));
      })
      .catch(() => {});
  }, []);

  function addCodeRow() {
    const id = `ec-${nextId.current++}`;
    setEquipmentCodes((p) => [...p, { id, value: "" }]);
  }
  function updateCode(id: string, v: string) {
    setEquipmentCodes((p) => p.map((row) => (row.id === id ? { ...row, value: v } : row)));
  }
  function removeCode(id: string) {
    setEquipmentCodes((p) => {
      if (p.length <= 1) return [{ id: `ec-${nextId.current++}`, value: "" }];
      return p.filter((row) => row.id !== id);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const codes = equipmentCodes.map((c) => c.value.trim()).filter(Boolean);
    if (!buildingName.trim()) { setError("Building name is required"); return; }
    if (!equipmentType.trim()) { setError("Equipment type is required"); return; }
    if (codes.length === 0) { setError("At least one Equipment ID is required"); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/admin/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          buildingName: buildingName.trim(),
          team: teams.length > 0 ? teams.join(", ") : undefined,
          equipmentTypeName: equipmentType.trim(),
          equipmentCodes: codes,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.message ?? `Failed (${res.status})`);
        return;
      }
      const data = await res.json();
      const skippedNote = data.skipped > 0 ? ` (${data.skipped} duplicate skipped)` : "";
      onCreated(`Created ${data.equipment.length} equipment in ${data.building.name}${skippedNote}`);
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full h-10 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-all";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overlay-fade" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="modal-slide bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Create New Project</h2>
            <p className="text-xs text-gray-500 mt-0.5">Add a building with equipment + team</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Building Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">
              Building Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={buildingName}
              onChange={(e) => setBuildingName(e.target.value)}
              placeholder="e.g. Yoma Tower"
              className={inputCls}
              autoFocus
            />
          </div>

          {/* Team — multi-select via Combobox */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">Team</label>

            {/* Selected pills */}
            {teams.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {teams.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-200">
                    Team {t}
                    <button
                      type="button"
                      onClick={() => setTeams((p) => p.filter((x) => x !== t))}
                      className="text-indigo-500 hover:text-indigo-700 active:scale-90"
                      title="Remove"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Combobox to add a team (open dropdown again to add another) */}
            <Combobox
              options={knownTeams.filter((t) => !teams.includes(t.value))}
              value=""
              onChange={(v) => {
                const trimmed = v.trim();
                if (trimmed && !teams.includes(trimmed)) setTeams((p) => [...p, trimmed]);
              }}
              placeholder={teams.length === 0 ? "Select or type new team..." : "+ Add another team"}
              allowCreate
              createLabel="Use"
            />
          </div>

          {/* Equipment Type */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">
              Equipment Type <span className="text-red-500">*</span>
            </label>
            <Combobox
              options={knownTypes}
              value={equipmentType}
              onChange={setEquipmentType}
              placeholder="Select or type new equipment type..."
              allowCreate
              createLabel="Use"
            />
            <p className="text-[11px] text-gray-400 mt-1">Service checklist will be applied automatically by type</p>
          </div>

          {/* Equipment IDs */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">
              Equipment IDs <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {equipmentCodes.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => updateCode(row.id, e.target.value)}
                    placeholder={`Lift code, e.g. ${i === 0 ? "PL1" : "PL" + (i + 1)}`}
                    className={inputCls + " flex-1"}
                  />
                  <button
                    type="button"
                    onClick={() => removeCode(row.id)}
                    disabled={equipmentCodes.length === 1 && !row.value}
                    className="w-9 h-10 flex items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:bg-red-50 hover:border-red-300 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    title="Remove"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addCodeRow}
              className="mt-2 text-xs font-semibold text-green-700 hover:text-green-800 flex items-center gap-1"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              Add another equipment
            </button>
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
            onClick={(e) => handleSubmit(e as any)}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-green-700 hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
          >
            {submitting ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="animate-spin"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                Creating...
              </>
            ) : (
              "Create Project"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
