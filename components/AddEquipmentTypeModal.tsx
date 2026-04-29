"use client";

import { useState } from "react";
import ChecklistCategoryEditor, { ChecklistCategory } from "./ChecklistCategoryEditor";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

interface Props {
  onClose: () => void;
  onSaved: (msg: string) => void;
  token?: string | null;
}

export default function AddEquipmentTypeModal({ onClose, onSaved, token }: Props) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [categories, setCategories] = useState<ChecklistCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Equipment type name is required"); return; }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/service-management`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim() || undefined,
          description: description.trim() || undefined,
          is_active: isActive,
          categories,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.message ?? `Failed to create equipment type (${res.status})`);
        return;
      }
      const itemCount = categories.reduce((acc, c) => acc + (c.items?.length ?? 0), 0);
      onSaved(
        `Created "${name.trim()}"` +
        (itemCount > 0 ? ` with ${itemCount} checklist item${itemCount === 1 ? "" : "s"}` : ""),
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
      <div className="modal-slide bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Add Equipment Type</h2>
            <p className="text-xs text-gray-500 mt-0.5">Create a new equipment type and its initial checklist</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dumbwaiter"
                className={inputCls}
                maxLength={80}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. DWT"
                className={inputCls}
                maxLength={40}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional — shown in admin views"
                className={inputCls}
                maxLength={160}
              />
            </div>
            <div className="col-span-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-700">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-green-700 focus:ring-green-500"
                />
                Active
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-2">
              Initial Checklist
            </label>
            <ChecklistCategoryEditor value={categories} onChange={setCategories} showEmptyHint />
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
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
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-green-700 hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
