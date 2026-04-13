"use client";

import { useEffect, useState } from "react";
import { useAdminSession } from "../../../lib/admin-session-context";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

interface ScheduleRow {
  date: string;
  equipment_type: string;
  equipment_code: string;
  maintenance_type: string;
  frequency: string;
  technician_name: string;
  status: string;
}

type SortField = keyof ScheduleRow;
type SortDir = "asc" | "desc";

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  received:       { bg: "#fef9c3", text: "#713f12" },
  "pc-review":    { bg: "#dbeafe", text: "#1e40af" },
  "comm-review":  { bg: "#ede9fe", text: "#5b21b6" },
  "invoice-ready":{ bg: "#cffafe", text: "#155e75" },
  closed:         { bg: "#d1fae5", text: "#065f46" },
  pending:        { bg: "#dbeafe", text: "#1e40af" },
  "in-progress":  { bg: "#dbeafe", text: "#1e40af" },
  active:         { bg: "#dbeafe", text: "#1e40af" },
};

function statusLabel(s: string) {
  const lower = s.toLowerCase();
  const labels: Record<string, string> = {
    received: "CBS Received", "pc-review": "PC Review", "comm-review": "Comm. Review",
    "invoice-ready": "Invoice Ready", closed: "Closed", pending: "PC Review",
    "in-progress": "PC Review", active: "PC Review",
  };
  return labels[lower] ?? s;
}

const COLUMNS: { key: SortField; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "equipment_type", label: "List of Equipment" },
  { key: "equipment_code", label: "Serial No." },
  { key: "maintenance_type", label: "Parts in Scope" },
  { key: "frequency", label: "Frequency" },
  { key: "technician_name", label: "Service Engineer" },
  { key: "status", label: "Status" },
];

function parseDate(d: string): number {
  const t = Date.parse(d);
  return isNaN(t) ? 0 : t;
}

function parseFrequency(f: string): number {
  // Dash → sort to bottom (largest value)
  if (!f || f === "—") return Number.MAX_SAFE_INTEGER;
  const m = f.match(/^(\d+)\s*(Day|Week|Month|Year)s?/i);
  if (!m) return 0;
  const n = parseInt(m[1]);
  const unit = m[2].toLowerCase();
  // Normalize to days for comparison
  if (unit === "year") return n * 365;
  if (unit === "month") return n * 30;
  if (unit === "week") return n * 7;
  return n; // day
}

export default function ManagementPage() {
  const { session } = useAdminSession();
  const [data, setData] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterEquipment, setFilterEquipment] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const token = typeof document !== "undefined"
    ? document.cookie.split("; ").find(c => c.startsWith("yecl-admin-session="))?.split("=")[1] ?? ""
    : "";

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/maintenance-reports/admin/management-schedule`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(d => { setData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  // Unique values for filters
  const equipmentTypes = [...new Set(data.map(r => r.equipment_type))].sort();
  const statuses = [...new Set(data.map(r => r.status))].sort();

  // Filtered
  const filtered = data.filter(r => {
    if (filterEquipment && r.equipment_type !== filterEquipment) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.equipment_type.toLowerCase().includes(q)
        || r.equipment_code.toLowerCase().includes(q)
        || r.technician_name.toLowerCase().includes(q)
        || r.maintenance_type.toLowerCase().includes(q);
    }
    return true;
  });

  // Sorted
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "date") {
      cmp = parseDate(a.date) - parseDate(b.date);
    } else if (sortField === "frequency") {
      cmp = parseFrequency(a.frequency) - parseFrequency(b.frequency);
    } else {
      cmp = (a[sortField] ?? "").localeCompare(b[sortField] ?? "");
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Paginated
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Reset page on filter/search change
  useEffect(() => { setCurrentPage(1); }, [search, filterEquipment, filterStatus, pageSize]);

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
      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">Maintenance Schedule</h1>
        <p className="text-sm text-gray-500 mt-0.5">Overview of all maintenance activities and service frequency</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search equipment, technician, type..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100"
            />
          </div>
          <select value={filterEquipment} onChange={e => setFilterEquipment(e.target.value)} className={selectCls}>
            <option value="">All Equipment</option>
            {equipmentTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={selectCls}>
            <option value="">All Status</option>
            {statuses.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <span className="text-xs text-gray-400 font-medium">{filtered.length} records</span>
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
                    className="text-left text-[11px] font-bold uppercase tracking-wider text-white px-4 py-3 cursor-pointer select-none hover:bg-white/10 transition-colors"
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
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 rounded bg-gray-100" style={{ width: `${50 + j * 10}%`, animation: "shimmer 1.4s infinite linear", background: "linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%)", backgroundSize: "400px 100%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">No records found</td>
                </tr>
              ) : (
                paginated.map((row, i) => {
                  const sc = STATUS_COLORS[row.status.toLowerCase()] ?? { bg: "#f3f4f6", text: "#374151" };
                  return (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors" style={i % 2 === 0 ? { backgroundColor: "#f0f9ff08" } : {}}>
                      <td className="px-4 py-3 text-gray-700 text-xs font-medium whitespace-nowrap">{row.date}</td>
                      <td className="px-4 py-3 text-gray-800 text-xs font-semibold">{row.equipment_type}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs font-mono">{row.equipment_code}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{row.maintenance_type}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                          {row.frequency}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs">{row.technician_name}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: sc.bg, color: sc.text }}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && sorted.length > 0 && (
          <div className="flex flex-wrap items-center justify-between px-4 py-3 border-t border-gray-100 gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
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
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                  className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
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
                    )
                  )}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
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
