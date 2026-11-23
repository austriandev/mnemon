import type { Sql, TransactionSql } from "postgres";

/**
 * Which meetings a store or search sees, and who owns what it saves (ADR-0017).
 * - all: every meeting; what it saves is common. For operator tools: the CLI, evals.
 * - viewer: the common meetings plus the owner's own; what it saves is the owner's.
 *   A null owner (no access code) sees and saves common meetings only.
 */
export type Visibility =
  | { readonly kind: "all" }
  | { readonly kind: "viewer"; readonly owner: string | null };

export const ALL_MEETINGS: Visibility = { kind: "all" };

/** The owner a meeting saved under this visibility gets. */
export const ownerOf = (v: Visibility): string | null => (v.kind === "viewer" ? v.owner : null);

/** A condition on the meetings row aliased `m`: true for the meetings this visibility sees. */
export function seenBy(sql: Sql | TransactionSql, v: Visibility) {
  if (v.kind === "all") return sql`true`;
  return v.owner === null ? sql`m.owner is null` : sql`(m.owner is null or m.owner = ${v.owner})`;
}
