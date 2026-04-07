import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "YECL Maintenance Dashboard | Yoma Elevator",
  description: "Operations & Routing Dashboard",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Dark green top header */}
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

          {/* Right: team selector + user */}
          <div className="flex items-center gap-3">
            <button
              style={{ borderColor: "#4a7a5a", backgroundColor: "transparent" }}
              className="text-white text-sm px-4 py-2 rounded border flex items-center gap-2"
            >
              Operations Team
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <span className="text-white text-sm font-medium">Rita Chen</span>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-screen-xl px-4 py-5">
        {children}
      </main>
    </div>
  );
}
