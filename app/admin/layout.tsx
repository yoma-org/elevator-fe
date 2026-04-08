import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminSessionProvider } from "../../lib/admin-session-context";
import AdminHeader from "../../components/AdminHeader";

export const metadata: Metadata = {
  title: "YECL Maintenance Dashboard | Yoma Elevator",
  description: "Operations & Routing Dashboard",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <div className="min-h-screen bg-gray-100">
        <AdminHeader />
        <main className="mx-auto max-w-screen-xl px-4 py-5">
          {children}
        </main>
      </div>
    </AdminSessionProvider>
  );
}
