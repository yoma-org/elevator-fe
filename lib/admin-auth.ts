import type { AdminRole } from "./permissions";
import { ADMIN_ROLES } from "./permissions";

export { ADMIN_ROLES };
export type { AdminRole };

export const ADMIN_SESSION_COOKIE = "yecl-admin-session";
export const DEFAULT_ADMIN_REDIRECT = "/admin";

export type AdminSession = {
  sub?: string;
  email?: string;
  name?: string;
  role?: AdminRole;
  exp?: number;
  iat?: number;
};

function decodeJwtPayload(token: string) {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded)) as AdminSession;
  } catch {
    return null;
  }
}

export function decodeAdminSession(value?: string) {
  if (!value?.trim()) {
    return null;
  }

  return decodeJwtPayload(value);
}

export function hasValidAdminSession(value?: string) {
  const payload = decodeAdminSession(value);
  if (!payload) {
    return false;
  }

  if (!payload.exp) {
    return true;
  }

  return payload.exp * 1000 > Date.now();
}

export function normalizeAdminRole(value?: string | null): AdminRole {
  if (value && ADMIN_ROLES.includes(value as AdminRole)) {
    return value as AdminRole;
  }
  return "operation";
}

export function formatAdminRole(value?: string | null) {
  const LABELS: Record<AdminRole, string> = {
    operation: "Operation",
    "mnt-manager": "MNT Manager",
    "pc-team": "PC Team",
    commercial: "Commercial",
  };
  const role = normalizeAdminRole(value);
  return LABELS[role] ?? role;
}

export function normalizeAdminRedirect(value?: string | null) {
  if (!value || !value.startsWith("/")) {
    return DEFAULT_ADMIN_REDIRECT;
  }

  if (value.startsWith("/login")) {
    return DEFAULT_ADMIN_REDIRECT;
  }

  return value;
}
