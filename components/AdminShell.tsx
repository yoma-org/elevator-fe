"use client";

import { useRef, type ReactNode } from "react";
import AdminHeader from "./AdminHeader";
import AdminSidebar, { type AdminSidebarHandle } from "./AdminSidebar";

export default function AdminShell({ children }: { children: ReactNode }) {
  const sidebarRef = useRef<AdminSidebarHandle>(null);

  return (
    <div className="min-h-screen bg-gray-100">
      <AdminHeader onMenuToggle={() => sidebarRef.current?.toggle()} />
      <AdminSidebar ref={sidebarRef} />
      <main className="mx-auto max-w-screen-xl px-4 py-5">
        {children}
      </main>
    </div>
  );
}
