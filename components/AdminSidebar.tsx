"use client";

import { usePathname } from "next/navigation";
import { useEffect, useCallback, forwardRef, useImperativeHandle, useState } from "react";
import { useAdminSession } from "../lib/admin-session-context";
import { formatAdminRole } from "../lib/admin-auth";

const NAV_ITEMS = [
  {
    section: "Main",
    items: [
      {
        label: "Dashboard",
        href: "/admin",
        desc: "Work orders & stats",
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/><rect x="11" y="2" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/><rect x="2" y="11" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/><rect x="11" y="11" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.5"/></svg>,
      },
    ],
  },
  {
    section: "Reports",
    items: [
      {
        label: "Management",
        href: "/admin/management",
        desc: "Maintenance schedule",
        icon: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M2 7h16M6 3v4M14 3v4M6 11h2M6 14h2M10 11h2M10 14h2M14 11h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
      },
    ],
  },
];

export interface AdminSidebarHandle {
  toggle: () => void;
}

const AdminSidebar = forwardRef<AdminSidebarHandle>(function AdminSidebar(_, ref) {
  const pathname = usePathname();
  const { session, logout } = useAdminSession();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen(v => !v), []);

  useImperativeHandle(ref, () => ({ toggle }), [toggle]);

  // Close on route change
  useEffect(() => { close(); }, [pathname, close]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  if (!session) return null;

  const roleLabel = formatAdminRole(session.role);
  const initials = (session.name ?? "U").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={close}
      />

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 bottom-0 z-40 w-64 flex flex-col shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "linear-gradient(175deg, #1e4434 0%, #152e22 50%, #0f2018 100%)" }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-white flex items-center justify-center flex-shrink-0 shadow-lg ring-1 ring-white/20">
              <img src="/logo.jpg" alt="Yoma" className="w-full h-full object-contain" />
            </div>
            <div>
              <p className="text-white font-bold text-[15px] leading-tight tracking-wide">YECL</p>
              <p className="text-emerald-400/60 text-[10px] font-medium tracking-wider uppercase">Maintenance</p>
            </div>
          </div>
          <button onClick={close} className="text-white/40 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-all active:scale-90">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 overflow-y-auto">
          {NAV_ITEMS.map((group) => (
            <div key={group.section} className="mb-4">
              <p className="px-3 mb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-500/40">{group.section}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      className={`group relative flex items-center gap-3 px-3 py-3 rounded-xl text-[13px] font-semibold transition-all duration-150 ${
                        active
                          ? "bg-emerald-500/15 text-white"
                          : "text-white/50 hover:bg-white/5 hover:text-white/90"
                      }`}
                    >
                      {/* Active indicator bar */}
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-emerald-400" />
                      )}
                      <span className={`flex-shrink-0 transition-all duration-150 ${
                        active ? "text-emerald-400" : "text-white/30 group-hover:text-emerald-400/60"
                      }`}>
                        {item.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate leading-tight">{item.label}</p>
                        <p className={`text-[10px] font-normal truncate mt-0.5 transition-colors ${
                          active ? "text-emerald-300/50" : "text-white/20 group-hover:text-white/30"
                        }`}>
                          {item.desc}
                        </p>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-5 h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent" />

        {/* User card */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 mb-3">
            <div className="w-9 h-9 rounded-full bg-emerald-600/30 flex items-center justify-center flex-shrink-0 ring-1 ring-emerald-500/20">
              <span className="text-emerald-300 text-[11px] font-bold">{initials}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-semibold truncate leading-tight">{session.name}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[9px] font-semibold px-1.5 py-px rounded-full bg-emerald-700/40 text-emerald-300/70 border border-emerald-600/20">
                  {roleLabel}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-semibold text-white/40 hover:text-red-300 hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
});

export default AdminSidebar;
