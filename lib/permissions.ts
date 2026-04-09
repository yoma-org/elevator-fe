/**
 * Role-based permission matrix for the admin dashboard.
 *
 * Actions:
 *   view     – can see reports at this status
 *   approve  – can advance the report to the next status
 *   comment  – can add internal notes / comments
 *   review   – can view + comment (alias kept for clarity in the matrix)
 *   download – can download / export the report
 */

export const ADMIN_ROLES = [
  "operation",
  "mnt-manager",
  "pc-team",
  "commercial",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type PermissionAction =
  | "view"
  | "approve"
  | "comment"
  | "review"
  | "download";

export type ReportStatus =
  | "received"
  | "pc-review"
  | "comm-review"
  | "invoice-ready"
  | "closed";

/** The next status in the approval flow */
export const NEXT_STATUS: Record<ReportStatus, string> = {
  received: "pc-review",
  "pc-review": "comm-review",
  "comm-review": "invoice-ready",
  "invoice-ready": "closed",
  closed: "closed",
};

const PERMISSIONS: Record<
  AdminRole,
  Partial<Record<ReportStatus, PermissionAction[]>>
> = {
  operation: {
    received: ["view", "approve"],
    "pc-review": ["view", "comment"],
    "comm-review": ["view"],
    "invoice-ready": ["view", "download"],
    closed: ["view", "download"],
  },
  "mnt-manager": {
    "pc-review": ["view"],
    "comm-review": ["comment"],
    "invoice-ready": ["view"],
    closed: ["view"],
  },
  "pc-team": {
    "pc-review": ["review", "approve", "comment"],
    "comm-review": ["view"],
    "invoice-ready": ["view"],
    closed: ["view"],
  },
  commercial: {
    "comm-review": ["review", "approve", "comment"],
    "invoice-ready": ["view", "approve", "download"],
    closed: ["view", "download"],
  },
};

/** Check whether `role` is allowed to perform `action` on a report with the given `status`. */
export function can(
  role: AdminRole | string | undefined,
  status: string,
  action: PermissionAction,
): boolean {
  if (!role || !ADMIN_ROLES.includes(role as AdminRole)) return false;
  return (
    PERMISSIONS[role as AdminRole]?.[status as ReportStatus]?.includes(
      action,
    ) ?? false
  );
}

/** Return every action a role can perform at a given status. */
export function allowedActions(
  role: AdminRole | string | undefined,
  status: string,
): PermissionAction[] {
  if (!role || !ADMIN_ROLES.includes(role as AdminRole)) return [];
  return PERMISSIONS[role as AdminRole]?.[status as ReportStatus] ?? [];
}

/** Return true if the role can see reports at this status at all. */
export function canView(
  role: AdminRole | string | undefined,
  status: string,
): boolean {
  const actions = allowedActions(role, status);
  return (
    actions.includes("view") ||
    actions.includes("review") ||
    actions.includes("approve") ||
    actions.includes("comment") ||
    actions.includes("download")
  );
}

/** Statuses that are visible to a given role. */
export function visibleStatuses(role: AdminRole | string | undefined): string[] {
  if (!role || !ADMIN_ROLES.includes(role as AdminRole)) return [];
  const perms = PERMISSIONS[role as AdminRole];
  return Object.keys(perms);
}
