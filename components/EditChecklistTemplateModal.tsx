"use client";

import { useEffect, useState } from "react";
import ChecklistCategoryEditor, { ChecklistCategory } from "./ChecklistCategoryEditor";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

interface Props {
  equipmentTypeId: string;
  equipmentTypeName: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
  token?: string | null;
}

export default function EditChecklistTemplateModal({
  equipmentTypeId,
  equipmentTypeName,
  onClose,
  onSaved,
  token,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState<ChecklistCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/admin/service-management/${equipmentTypeId}/template`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then((r) => r.json())
      .then((j) => {
        const tpl = j?.data?.template;
        if (tpl) {
          setName(tpl.name ?? `${equipmentTypeName} Service Sheet`);
          setDescription(tpl.description ?? "");
          setCategories(Array.isArray(tpl.categories) ? tpl.categories : []);
        } else {
          setName(`${equipmentTypeName} Service Sheet`);
          setDescription("");
          setCategories([]);
        }
      })
      .catch(() => setError("Failed to load checklist template"))
      .finally(() => setLoading(false));
  }, [equipmentTypeId, equipmentTypeName, token]);

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Template name is required"); return; }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/service-management/${equipmentTypeId}/template`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, categories }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.message ?? `Save failed (${res.status})`);
        return;
      }
      const itemCount = categories.reduce((acc, c) => acc + (c.items?.length ?? 0), 0);
      onSaved(`Saved checklist for "${equipmentTypeName}" — ${categories.length} categor${categories.length === 1 ? "y" : "ies"}, ${itemCount} item${itemCount === 1 ? "" : "s"}`);
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
            <h2 className="text-base font-bold text-gray-900">Edit Checklist</h2>
            <p className="text-xs text-gray-500 mt-0.5">Service checklist for <span className="font-semibold text-gray-700">{equipmentTypeName}</span></p>
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
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">
                  Template Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-1.5">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-all resize-none"
                  placeholder="Optional — short description shown to technicians"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-gray-600 mb-2">
                  Checklist
                </label>
                <ChecklistCategoryEditor value={categories} onChange={setCategories} showEmptyHint />
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
