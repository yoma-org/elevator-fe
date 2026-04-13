import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminSessionProvider } from "../../lib/admin-session-context";
import AdminShell from "../../components/AdminShell";

export const metadata: Metadata = {
  title: "YECL Maintenance Dashboard | Yoma Elevator",
  description: "Operations & Routing Dashboard",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <AdminShell>{children}</AdminShell>
    </AdminSessionProvider>
  );
}
