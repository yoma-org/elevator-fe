"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ADMIN_SESSION_COOKIE, decodeAdminSession, type AdminSession } from "./admin-auth";
import type { AdminRole } from "./permissions";

interface AdminSessionCtx {
  session: AdminSession | null;
  role: AdminRole | undefined;
  token: string | null;
  loading: boolean;
  logout: () => void;
}

const Ctx = createContext<AdminSessionCtx>({
  session: null,
  role: undefined,
  token: null,
  loading: true,
  logout: () => {},
});

export function useAdminSession() {
  return useContext(Ctx);
}

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1];
}

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  const readSession = useCallback(() => {
    const raw = getCookie(ADMIN_SESSION_COOKIE);
    if (raw) {
      const decoded = decodeAdminSession(raw);
      if (decoded && decoded.exp && decoded.exp * 1000 > Date.now()) {
        setSession(decoded);
        setToken(raw);
        setLoading(false);
        return;
      }
    }
    setSession(null);
    setToken(null);
    setLoading(false);
  }, []);

  // Re-read cookie on mount and whenever the route changes
  useEffect(() => {
    readSession();
  }, [pathname, readSession]);

  function logout() {
    document.cookie = `${ADMIN_SESSION_COOKIE}=; path=/; max-age=0`;
    setSession(null);
    setToken(null);
    window.location.href = "/login";
  }

  return (
    <Ctx value={{
      session,
      role: session?.role,
      token,
      loading,
      logout,
    }}>
      {children}
    </Ctx>
  );
}
