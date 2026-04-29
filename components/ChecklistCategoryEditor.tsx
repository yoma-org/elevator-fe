"use client";

import { useMemo } from "react";

export interface ChecklistItem {
  no?: string;
  label: string;
}

export interface ChecklistCategory {
  category: string;
  items: ChecklistItem[];
}

interface Props {
  value: ChecklistCategory[];
  onChange: (next: ChecklistCategory[]) => void;
  showEmptyHint?: boolean;
}

/** Pull the leading number out of "3. Condition of step" → "3", or fallback to (index+1). */
function categoryPrefix(title: string, index: number): string {
  const m = (title ?? "").trim().match(/^(\d+)/);
  if (m) return m[1];
  return String(index + 1);
}

function suggestNo(category: string, categoryIndex: number, itemIndex: number, totalItems: number): string {
  const prefix = categoryPrefix(category, categoryIndex);
  if (totalItems <= 1) return prefix;
  return `${prefix}-${itemIndex + 1}`;
}

export default function ChecklistCategoryEditor({ value, onChange, showEmptyHint }: Props) {
  const totalItems = useMemo(
    () => value.reduce((acc, c) => acc + (c.items?.length ?? 0), 0),
    [value],
  );

  function updateCategory(idx: number, patch: Partial<ChecklistCategory>) {
    const next = value.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  }
  function removeCategory(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function addCategory() {
    onChange([...value, { category: `${value.length + 1}. New category`, items: [] }]);
  }
  function addItem(catIdx: number) {
    const cat = value[catIdx];
    const newItems = [...cat.items, { no: "", label: "" }];
    // Auto-suggest "no" for the new item
    const suggested = suggestNo(cat.category, catIdx, newItems.length - 1, newItems.length);
    newItems[newItems.length - 1].no = suggested;
    // If list now has 2 items and the existing first one had a singleton "no", upgrade it to "prefix-1"
    if (newItems.length === 2) {
      const prefix = categoryPrefix(cat.category, catIdx);
      if (newItems[0].no === prefix) newItems[0].no = `${prefix}-1`;
    }
    updateCategory(catIdx, { items: newItems });
  }
  function updateItem(catIdx: number, itemIdx: number, patch: Partial<ChecklistItem>) {
    const cat = value[catIdx];
    const newItems = cat.items.map((it, i) => (i === itemIdx ? { ...it, ...patch } : it));
    updateCategory(catIdx, { items: newItems });
  }
  function removeItem(catIdx: number, itemIdx: number) {
    const cat = value[catIdx];
    updateCategory(catIdx, { items: cat.items.filter((_, i) => i !== itemIdx) });
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && showEmptyHint && (
        <p className="text-[11px] text-gray-400 italic">No checklist yet. Click "Add category" to get started.</p>
      )}

      {value.map((cat, catIdx) => (
        <div key={catIdx} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
          {/* Category header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 w-12">Category</span>
            <input
              type="text"
              value={cat.category}
              onChange={(e) => updateCategory(catIdx, { category: e.target.value })}
              placeholder="e.g. 1. General operating conditions"
              className="flex-1 h-8 rounded-md border border-gray-300 px-2 text-xs font-semibold outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
            />
            <button
              type="button"
              onClick={() => removeCategory(catIdx)}
              title="Remove category"
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8M5.75 6.5v4.5M8.25 6.5v4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Items table */}
          {cat.items.length === 0 ? (
            <p className="px-3 py-3 text-[11px] italic text-gray-400">No items. Click "Add item" below.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/60">
                  <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 w-20">No.</th>
                  <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Item label</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {cat.items.map((it, itemIdx) => (
                  <tr key={itemIdx} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={it.no ?? ""}
                        onChange={(e) => updateItem(catIdx, itemIdx, { no: e.target.value })}
                        placeholder={suggestNo(cat.category, catIdx, itemIdx, cat.items.length)}
                        className="w-full h-7 rounded-md border border-gray-300 px-2 text-[11px] font-mono outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={it.label}
                        onChange={(e) => updateItem(catIdx, itemIdx, { label: e.target.value })}
                        placeholder="Describe the checklist item"
                        className="w-full h-7 rounded-md border border-gray-300 px-2 text-xs outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeItem(catIdx, itemIdx)}
                        title="Remove item"
                        className="w-6 h-6 inline-flex items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Add item */}
          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/40">
            <button
              type="button"
              onClick={() => addItem(catIdx)}
              className="text-[11px] font-semibold text-green-700 hover:text-green-800 inline-flex items-center gap-1"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              Add item
            </button>
          </div>
        </div>
      ))}

      {/* Add category */}
      <button
        type="button"
        onClick={addCategory}
        className="w-full h-9 rounded-lg border-2 border-dashed border-gray-300 text-xs font-semibold text-gray-500 hover:border-green-600 hover:text-green-700 hover:bg-green-50/40 transition-all inline-flex items-center justify-center gap-1.5"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        Add category
      </button>

      {value.length > 0 && (
        <p className="text-[10px] text-gray-400 text-right">
          {value.length} categor{value.length === 1 ? "y" : "ies"} · {totalItems} item{totalItems === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
