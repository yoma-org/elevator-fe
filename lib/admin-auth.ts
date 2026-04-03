export const ADMIN_SESSION_COOKIE = "yecl-admin-session";
export const PREVIEW_ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "ops@yomaelevator.com";
export const PREVIEW_ADMIN_PASSWORD =
  process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? "preview-access";
export const DEFAULT_ADMIN_REDIRECT = "/admin";
export const ADMIN_ROLES = ["admin", "dispatcher", "viewer"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminSession = {
  sub?: string;
  email?: string;
  name?: string;
  role?: string;
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
  if (value === "admin" || value === "dispatcher" || value === "viewer") {
    return value;
  }

  return "viewer";
}

export function formatAdminRole(value?: string | null) {
  return normalizeAdminRole(value)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeAdminRedirect(value?: string | null) {
  if (!value || !value.startsWith("/")) {
    return DEFAULT_ADMIN_REDIRECT;
  }

  if (value.startsWith("/admin/login")) {
    return DEFAULT_ADMIN_REDIRECT;
  }

  return value;
}
