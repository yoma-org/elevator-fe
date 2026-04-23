"use client";

import { useEffect, useState, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

interface Row {
  building_id: string;
  building_name: string;
  team: string | null;
  equipment_id: string;
  equipment_code: string;
  equipment_type: string;
  equipment_category: string | null;
  maintenance_count: number;
  first_maintenance: string | null;
  last_maintenance: string | null;
}

interface Response {
  data: Row[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: {
    buildings: Array<{ id: string; name: string }>;
    equipmentTypes: string[];
  };
}

type SortField = keyof Row;
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortField; label: string }[] = [
  { key: "building_name", label: "Building" },
  { key: "team", label: "Team" },
  { key: "equipment_code", label: "Lift No." },
  { key: "equipment_type", label: "Equipment Type" },
  { key: "equipment_category", label: "Category" },
  { key: "maintenance_count", label: "Visits" },
  { key: "first_maintenance", label: "First Maintenance" },
  { key: "last_maintenance", label: "Last Maintenance" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [datePart] = iso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d).padStart(2, "0")} ${months[m - 1]} ${y}`;
}

export default function ManagementPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [buildings, setBuildings] = useState<Array<{ id: string; name: string }>>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterBuilding, setFilterBuilding] = useState("");
  const [filterEquipment, setFilterEquipment] = useState("");
  const [sortField, setSortField] = useState<SortField>("building_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const token = typeof document !== "undefined"
    ? document.cookie.split("; ").find(c => c.startsWith("yecl-admin-session="))?.split("=")[1] ?? ""
    : "";

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const reqIdRef = useRef(0);
  useEffect(() => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(currentPage));
    params.set("pageSize", String(pageSize));
    params.set("sortField", sortField);
    params.set("sortDir", sortDir);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filterEquipment) params.set("equipmentType", filterEquipment);
    if (filterBuilding) params.set("buildingId", filterBuilding);

    fetch(`${API_BASE}/maintenance-reports/admin/management-schedule?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then((d: Response) => {
        if (reqId !== reqIdRef.current) return;
        setRows(d.data ?? []);
        setTotal(d.total ?? 0);
        setTotalPages(d.totalPages ?? 1);
        setBuildings(d.filters?.buildings ?? []);
        setEquipmentTypes(d.filters?.equipmentTypes ?? []);
        setLoading(false);
      })
      .catch(() => { if (reqId === reqIdRef.current) setLoading(false); });
  }, [token, currentPage, pageSize, sortField, sortDir, debouncedSearch, filterEquipment, filterBuilding]);

  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, filterEquipment, filterBuilding, pageSize]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setCurrentPage(1);
  }

  const selectCls = "text-xs border border-gray-300 rounded-lg px-2.5 py-2 bg-white outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">Equipment Maintenance Overview</h1>
        <p className="text-sm text-gray-500 mt-0.5">Equipment per building that has at least one maintenance record</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search building, lift, equipment type, team..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
            />
          </div>
          <select value={filterBuilding} onChange={e => setFilterBuilding(e.target.value)} className={selectCls}>
            <option value="">All Buildings</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={filterEquipment} onChange={e => setFilterEquipment(e.target.value)} className={selectCls}>
            <option value="">All Equipment Types</option>
            {equipmentTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-xs text-gray-400 font-medium">{total} equipment</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "#1a3a2a" }}>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="text-left text-[11px] font-bold uppercase tracking-wider text-white px-4 py-3 cursor-pointer select-none hover:bg-white/10 transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1.5">
                      {col.label}
                      <span className="inline-flex flex-col leading-none">
                        <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className={sortField === col.key && sortDir === "asc" ? "opacity-100" : "opacity-30"}>
                          <path d="M4 0L8 5H0L4 0Z" fill="currentColor"/>
                        </svg>
                        <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className={sortField === col.key && sortDir === "desc" ? "opacity-100" : "opacity-30"}>
                          <path d="M4 5L0 0H8L4 5Z" fill="currentColor"/>
                        </svg>
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: pageSize }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: COLUMNS.length }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 rounded bg-gray-100" style={{ width: `${50 + j * 8}%`, animation: "shimmer 1.4s infinite linear", background: "linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%)", backgroundSize: "400px 100%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-gray-400 text-sm">No equipment with maintenance records</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.equipment_id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-800 text-xs font-semibold">{row.building_name}</td>
                    <td className="px-4 py-3">
                      {row.team ? (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-bold">{row.team}</span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs font-mono">{row.equipment_code}</td>
                    <td className="px-4 py-3 text-gray-700 text-xs">{row.equipment_type}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{row.equipment_category ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        {row.maintenance_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{fmtDate(row.first_maintenance)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{fmtDate(row.last_maintenance)}</td>
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
                Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)} of {total}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span>Show</span>
                {[10, 25, 50].map(size => (
                  <button key={size} onClick={() => setPageSize(size)}
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
                  Prev
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
                      <span key={`e${idx}`} className="px-1.5 text-gray-400 text-xs">...</span>
                    ) : (
                      <button key={item} onClick={() => setCurrentPage(item as number)}
                        className={`min-w-[32px] py-1.5 rounded border text-xs transition-all ${currentPage === item ? "bg-green-700 text-white border-green-700 font-bold" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                        {item}
                      </button>
                    )
                  )}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                  className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
