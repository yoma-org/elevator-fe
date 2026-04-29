"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import EditBuildingModal from "../../../components/EditBuildingModal";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

interface BuildingRow {
  id: string;
  name: string;
  team: string | null;
  equipmentCount: number;
  equipmentTypes: string[];
}

type SortField = "name" | "team" | "equipmentCount";
type SortDir = "asc" | "desc";

export default function BuildingsPage() {
  const [rows, setRows] = useState<BuildingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterTeam, setFilterTeam] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [toast, setToast] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const token = typeof document !== "undefined"
    ? document.cookie.split("; ").find((c) => c.startsWith("yecl-admin-session="))?.split("=")[1] ?? ""
    : "";

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    fetch(`${API_BASE}/admin/buildings`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((j) => {
        if (id !== reqId.current) return;
        const list: BuildingRow[] = (j?.data ?? []).map((b: any) => ({
          id: b.id,
          name: b.name,
          team: b.team,
          equipmentCount: b.equipmentCount ?? 0,
          equipmentTypes: b.equipmentTypes ?? [],
        }));
        setRows(list);
      })
      .catch(() => {})
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [token, refreshTick]);

  const knownTeams = useMemo(() => {
    const all = new Set<string>();
    for (const r of rows) {
      if (!r.team) continue;
      r.team.split(",").map((s) => s.trim()).filter(Boolean).forEach((t) => all.add(t));
    }
    return [...all].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.team ?? "").toLowerCase().includes(q) ||
          r.equipmentTypes.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (filterTeam) {
      list = list.filter((r) =>
        (r.team ?? "")
          .split(",")
          .map((t) => t.trim())
          .includes(filterTeam),
      );
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else if (sortField === "team") cmp = (a.team ?? "").localeCompare(b.team ?? "");
      else if (sortField === "equipmentCount") cmp = a.equipmentCount - b.equipmentCount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, debouncedSearch, filterTeam, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
    setCurrentPage(1);
  }

  // Reset to first page when filters / sort / page size change
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, filterTeam, pageSize]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  const selectCls = "text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">Building Management</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage buildings, teams, and equipment assignments</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search building, team, equipment type..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
            />
          </div>
          <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} className={selectCls}>
            <option value="">All Teams</option>
            {knownTeams.map((t) => <option key={t} value={t}>Team {t}</option>)}
          </select>
          <span className="text-xs text-gray-400 font-medium">{filtered.length} buildings</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "#1a3a2a" }}>
                {([
                  { key: "name", label: "Building" },
                  { key: "team", label: "Team" },
                  { key: "equipmentCount", label: "Equipment Count" },
                ] as const).map((c) => (
                  <th
                    key={c.key}
                    onClick={() => handleSort(c.key as SortField)}
                    className="text-left text-[11px] font-bold uppercase tracking-wider text-white px-4 py-3 cursor-pointer select-none hover:bg-white/10 transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      {c.label}
                      <span className="inline-flex flex-col leading-none">
                        <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className={sortField === c.key && sortDir === "asc" ? "opacity-100" : "opacity-30"}><path d="M4 0L8 5H0L4 0Z" fill="currentColor"/></svg>
                        <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className={sortField === c.key && sortDir === "desc" ? "opacity-100" : "opacity-30"}><path d="M4 5L0 0H8L4 5Z" fill="currentColor"/></svg>
                      </span>
                    </div>
                  </th>
                ))}
                <th className="text-left text-[11px] font-bold uppercase tracking-wider text-white px-4 py-3 whitespace-nowrap">Equipment Types</th>
                <th className="text-center text-[11px] font-bold uppercase tracking-wider text-white px-4 py-3 whitespace-nowrap">Edit</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 rounded bg-gray-100" style={{ width: `${50 + j * 8}%`, animation: "shimmer 1.4s infinite linear", background: "linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%)", backgroundSize: "400px 100%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">No buildings match your filters</td>
                </tr>
              ) : (
                paginated.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-800 text-xs font-semibold">{row.name}</td>
                    <td className="px-4 py-3">
                      {row.team ? (
                        <div className="flex flex-wrap gap-1">
                          {row.team.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                            <span key={t} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-bold">{t}</span>
                          ))}
                        </div>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        {row.equipmentCount}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.equipmentTypes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.equipmentTypes.map((t) => (
                            <span key={t} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] font-medium border border-gray-200">{t}</span>
                          ))}
                        </div>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setEditingId(row.id)}
                        title="Edit building"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-400 active:scale-95 transition-all"
                      >
                        <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2 12V10l7-7 2 2-7 7H2z M9 3l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between px-4 py-3 border-t border-gray-100 gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, total)} of {total}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span>Show</span>
                {[10, 25, 50].map((size) => (
                  <button key={size} onClick={() => setPageSize(size)}
                    className={`min-w-[32px] py-1 rounded border text-xs transition-all ${pageSize === size ? "bg-green-700 text-white border-green-700 font-bold" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                    {size}
                  </button>
                ))}
              </div>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
                  className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                  .reduce<(number | "ellipsis")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("ellipsis");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, idx) =>
                    item === "ellipsis" ? (
                      <span key={`e${idx}`} className="px-1.5 text-gray-400 text-xs">...</span>
                    ) : (
                      <button key={item} onClick={() => setCurrentPage(item as number)}
                        className={`min-w-[32px] py-1.5 rounded border text-xs transition-all ${safePage === item ? "bg-green-700 text-white border-green-700 font-bold" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                        {item}
                      </button>
                    ),
                  )}
                <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                  className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {editingId && (
        <EditBuildingModal
          buildingId={editingId}
          knownTeams={knownTeams}
          token={token}
          onClose={() => setEditingId(null)}
          onSaved={(msg) => {
            showToast(msg);
            setRefreshTick((t) => t + 1);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-semibold animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
