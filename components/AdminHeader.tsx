"use client";

import { usePathname } from "next/navigation";
import { useAdminSession } from "../lib/admin-session-context";
import { formatAdminRole } from "../lib/admin-auth";

export default function AdminHeader() {
  const { session, loading, logout } = useAdminSession();
  const pathname = usePathname();

  // Don't render header on the login page
  if (pathname === "/login") return null;

  return (
    <header style={{ backgroundColor: "#1a3a2a" }} className="px-6 py-4">
      <div className="mx-auto max-w-screen-xl flex items-center justify-between">
        {/* Logo + title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white flex items-center justify-center">
            <img src="/logo.jpg" alt="Yoma Elevator" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg tracking-wide leading-none">
              YECL MAINTENANCE SYSTEM
            </h1>
            <p className="text-green-200 text-xs mt-0.5">
              Elevator Service &amp; Reporting Dashboard
            </p>
          </div>
        </div>

        {/* Right: role badge + user + logout */}
        {!loading && session && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-900/50 text-green-200 border border-green-700/50">
              {formatAdminRole(session.role)}
            </span>
            <span className="text-white text-sm font-medium">{session.name ?? session.email}</span>
            <button
              onClick={logout}
              className="text-green-300 hover:text-white text-xs font-medium transition-colors ml-1"
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
