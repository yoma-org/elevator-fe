"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox } from "./Combobox";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

interface Props {
  buildingId: string;
  knownTeams: string[];     // pass from parent (extracted from list)
  onClose: () => void;
  onSaved: (msg: string) => void;
  token?: string | null;
}

interface EquipmentItem {
  id: string;
  equipment_code: string;
  equipment_type: string;
  equipment_type_id?: string | null;
  location?: string | null;
}
interface EquipmentTypeOption {
  id: string;
  name: string;
}

export default function EditBuildingModal({ buildingId, knownTeams, onClose, onSaved, token }: Props) {
  const [name, setName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [teams, setTeams] = useState<string[]>([]);
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  // Track typeId changes by equipment id
  const [typeChanges, setTypeChanges] = useState<Record<string, string>>({});
  // Track pending equipment deletions (by equipment id)
  const [pendingDeletes, setPendingDeletes] = useState<Record<string, true>>({});
  const [knownTypes, setKnownTypes] = useState<EquipmentTypeOption[]>([]);
  // New equipment to add: { rowId, code, equipmentTypeId }
  const [newEquipments, setNewEquipments] = useState<Array<{ rowId: string; code: string; equipmentTypeId: string }>>([]);
  const newRowCounter = useRef(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const teamOptions = useMemo(
    () => [...new Set(knownTeams)].sort().map((t) => ({ value: t, label: t })),
    [knownTeams],
  );

  useEffect(() => {
    setLoading(true);
    Promise.all([
      // Fetch the building
      fetch(`${API_BASE}/equipment/buildings`).then((r) => r.json()).then((j) => {
        const list: any[] = j?.data ?? [];
        const b = list.find((x) => x.id === buildingId);
        return b ?? null;
      }),
      // Equipment of this building
      fetch(`${API_BASE}/equipment/by-building?building_id=${buildingId}`).then((r) => r.json()).then((j) => j?.data ?? []),
      // Equipment types
      fetch(`${API_BASE}/equipment/types`).then((r) => r.json()).then((j) => j?.data ?? []),
    ])
      .then(([building, equips, types]) => {
        if (building) {
          setName(building.name ?? "");
          setOriginalName(building.name ?? "");
          const teamStr = building.team as string | null;
          if (teamStr) {
            setTeams(
              teamStr.split(",").map((t: string) => t.trim()).filter(Boolean),
            );
          }
        }
        setEquipmentList(
          (equips as any[]).map((e) => ({
            id: e.id,
            equipment_code: e.equipment_code ?? e.code ?? "",
            equipment_type: e.equipment_type ?? e.name ?? "",
            equipment_type_id: e.equipment_type_id ?? null,
            location: e.location ?? null,
          })),
        );
        setKnownTypes((types as any[]).map((t) => ({ id: t.id, name: t.equipment_type ?? t.name ?? "" })).filter((t) => t.name));
      })
      .catch(() => setError("Failed to load building data"))
      .finally(() => setLoading(false));
  }, [buildingId]);

  function addNewEquipmentRow() {
    setNewEquipments((p) => [...p, { rowId: `new-${newRowCounter.current++}`, code: "", equipmentTypeId: "" }]);
  }
  function updateNewEquipment(rowId: string, patch: Partial<{ code: string; equipmentTypeId: string }>) {
    setNewEquipments((p) => p.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }
  function removeNewEquipment(rowId: string) {
    setNewEquipments((p) => p.filter((r) => r.rowId !== rowId));
  }

  function togglePendingDelete(eqId: string) {
    setPendingDeletes((p) => {
      const next = { ...p };
      if (next[eqId]) delete next[eqId];
      else next[eqId] = true;
      return next;
    });
  }

  function setEquipmentType(eqId: string, typeId: string) {
    setTypeChanges((p) => {
      const next = { ...p };
      // Find original type id from equipmentList
      const eq = equipmentList.find((e) => e.id === eqId);
      if (eq && eq.equipment_type_id === typeId) {
        delete next[eqId];
      } else {
        next[eqId] = typeId;
      }
      return next;
    });
  }

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Building name is required"); return; }

    setSaving(true);
    try {
      const buildingChanged = name.trim() !== originalName.trim();
      const teamPayload = teams.length > 0 ? teams.join(", ") : null;
      const typeChangesArr = Object.entries(typeChanges);

      // 1. Update building (name + team) — always send both since team may have changed
      const res = await fetch(`${API_BASE}/admin/buildings/${buildingId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: name.trim(), team: teamPayload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.message ?? `Failed to update building (${res.status})`);
        return;
      }

      // 2. Update each changed equipment type (skip rows that will be deleted)
      for (const [eqId, typeId] of typeChangesArr) {
        if (pendingDeletes[eqId]) continue;
        const r = await fetch(`${API_BASE}/equipment/${eqId}/type`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ equipmentTypeId: typeId }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          setError(`Equipment type update failed: ${err.message ?? r.status}`);
          return;
        }
      }

      // 2b. Delete pending equipment
      const deleteIds = Object.keys(pendingDeletes);
      let deletedCount = 0;
      for (const eqId of deleteIds) {
        const r = await fetch(`${API_BASE}/equipment/${eqId}`, {
          method: "DELETE",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          setError(`Failed to delete equipment: ${err.message ?? r.status}`);
          return;
        }
        deletedCount += 1;
      }

      // 3. Add any new equipments (only complete rows)
      const newItems = newEquipments
        .map((e) => ({ code: e.code.trim(), equipmentTypeId: e.equipmentTypeId.trim() }))
        .filter((e) => e.code && e.equipmentTypeId);
      let addedCount = 0;
      let skippedCount = 0;
      if (newItems.length > 0) {
        const r = await fetch(`${API_BASE}/admin/buildings/${buildingId}/equipment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ items: newItems }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          setError(`Failed to add equipment: ${err.message ?? r.status}`);
          return;
        }
        const data = await r.json();
        addedCount = (data.equipment ?? []).length;
        skippedCount = data.skipped ?? 0;
      }

      const effectiveTypeChanges = typeChangesArr.filter(([id]) => !pendingDeletes[id]).length;
      onSaved(
        `Saved "${name.trim()}"` +
        (effectiveTypeChanges > 0 ? ` + ${effectiveTypeChanges} type change(s)` : "") +
        (deletedCount > 0 ? ` + ${deletedCount} deleted` : "") +
        (addedCount > 0 ? ` + ${addedCount} new equipment` : "") +
        (skippedCount > 0 ? ` (${skippedCount} duplicate skipped)` : "") +
        (buildingChanged ? "" : ""),
      );
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Network error");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full h-10 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-all";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overlay-fade" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="modal-slide bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Edit Building</h2>
            <p className="text-xs text-gray-500 mt-0.5">Update name, team, and equipment types</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading...</div>
          ) : (
            <>
              {/* Building Name */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">
                  Building Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* Team multi-select */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">Team</label>
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
                <Combobox
                  options={teamOptions.filter((t) => !teams.includes(t.value))}
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

              {/* Equipment table */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">
                  Equipment ({equipmentList.length})
                </label>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {equipmentList.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-400">No equipment in this building yet</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Lift No.</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Equipment Type</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {equipmentList.map((eq) => {
                          const currentTypeId = typeChanges[eq.id] ?? eq.equipment_type_id ?? "";
                          const isChanged = !!typeChanges[eq.id];
                          const isPendingDelete = !!pendingDeletes[eq.id];
                          return (
                            <tr key={eq.id} className={`border-t border-gray-100 ${isPendingDelete ? "bg-red-50/60" : ""}`}>
                              <td className={`px-3 py-2 font-mono ${isPendingDelete ? "text-red-700 line-through" : "text-gray-700"}`}>
                                {eq.equipment_code}
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={currentTypeId}
                                  onChange={(e) => setEquipmentType(eq.id, e.target.value)}
                                  disabled={isPendingDelete}
                                  className={`w-full h-8 rounded-md border px-2 text-xs outline-none focus:ring-2 focus:ring-green-100 disabled:opacity-50 disabled:cursor-not-allowed ${
                                    isChanged && !isPendingDelete ? "border-amber-400 bg-amber-50" : "border-gray-300 bg-white focus:border-green-600"
                                  }`}
                                >
                                  {!currentTypeId && <option value="">(unspecified)</option>}
                                  {knownTypes.map((t) => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-2 text-center">
                                {isPendingDelete ? (
                                  <button
                                    type="button"
                                    onClick={() => togglePendingDelete(eq.id)}
                                    className="text-[10px] font-semibold text-red-700 hover:text-red-900 px-1.5 py-0.5 rounded hover:bg-red-100"
                                    title="Undo delete"
                                  >
                                    Undo
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => togglePendingDelete(eq.id)}
                                    className="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                                    title="Remove this equipment"
                                  >
                                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                                      <path d="M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8M5.75 6.5v4.5M8.25 6.5v4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                {Object.keys(typeChanges).length > 0 && (
                  <p className="text-[11px] text-amber-700 mt-1.5">
                    {Object.keys(typeChanges).length} equipment type change(s) pending
                  </p>
                )}
                {Object.keys(pendingDeletes).length > 0 && (
                  <p className="text-[11px] text-red-700 mt-1.5">
                    {Object.keys(pendingDeletes).length} equipment will be deleted on Save
                  </p>
                )}
              </div>

              {/* Add new equipment */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wide text-gray-600">
                    Add New Equipment
                  </label>
                  <button
                    type="button"
                    onClick={addNewEquipmentRow}
                    className="text-[11px] font-semibold text-green-700 hover:text-green-800 inline-flex items-center gap-1"
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                    Add equipment
                  </button>
                </div>
                {newEquipments.length === 0 ? (
                  <p className="text-[11px] text-gray-400 italic">Click "Add equipment" to register a new lift under this building.</p>
                ) : (
                  <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-emerald-50">
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Lift No. *</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Equipment Type *</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {newEquipments.map((row) => (
                          <tr key={row.rowId} className="border-t border-emerald-100">
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={row.code}
                                onChange={(e) => updateNewEquipment(row.rowId, { code: e.target.value })}
                                placeholder="e.g. PL3"
                                className="w-full h-8 rounded-md border border-emerald-300 bg-white px-2 text-xs font-mono outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={row.equipmentTypeId}
                                onChange={(e) => updateNewEquipment(row.rowId, { equipmentTypeId: e.target.value })}
                                className="w-full h-8 rounded-md border border-emerald-300 bg-white px-2 text-xs outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                              >
                                <option value="">Select type...</option>
                                {knownTypes.map((t) => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeNewEquipment(row.rowId)}
                                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                                title="Remove"
                              >
                                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 flex-shrink-0 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-gray-700 rounded-lg border border-gray-300 hover:bg-white transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || !name.trim()}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-green-700 hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
