"use client";

import { usePathname } from "next/navigation";
import { useAdminSession } from "../lib/admin-session-context";
import { formatAdminRole } from "../lib/admin-auth";

export default function AdminHeader({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { session, loading, logout } = useAdminSession();
  const pathname = usePathname();

  if (pathname === "/login") return null;

  return (
    <header style={{ backgroundColor: "#1a3a2a" }} className="px-4 sm:px-6 py-3 sticky top-0 z-30 shadow-md">
      <div className="mx-auto max-w-screen-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Hamburger */}
          {onMenuToggle && (
            <button
              onClick={onMenuToggle}
              className="p-2 -ml-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-all active:scale-95"
              aria-label="Toggle menu"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 5h14M3 10h14M3 15h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          {/* Logo + title */}
          <div className="w-9 h-9 rounded-lg overflow-hidden bg-white flex items-center justify-center flex-shrink-0">
            <img src="/logo.jpg" alt="Yoma Elevator" className="w-full h-full object-contain" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-white font-bold text-base tracking-wide leading-none">
              YECL MAINTENANCE SYSTEM
            </h1>
            <p className="text-green-200/70 text-[10px] mt-0.5">
              Elevator Service &amp; Reporting Dashboard
            </p>
          </div>
        </div>

        {!loading && session && (
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden sm:inline text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-900/50 text-green-200 border border-green-700/50">
              {formatAdminRole(session.role)}
            </span>
            <span className="text-white text-sm font-medium hidden sm:inline">{session.name ?? session.email}</span>
            <button
              onClick={logout}
              className="text-green-300/70 hover:text-white text-xs font-medium transition-colors p-1.5 rounded-lg hover:bg-white/10"
              title="Sign out"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
