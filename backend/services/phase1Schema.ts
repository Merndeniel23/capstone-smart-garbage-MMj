import { db } from "../config/db.js";
import type { PoolConnection } from "mysql2/promise";

// Read-only metadata inspection shared by readiness and the operator preflight.
// No application rows, DDL, connection details or certificate values are read.
const baseColumns: Record<string, string[]> = {
  users: ["id", "role", "status", "barangay_id", "purok_id", "archived_at"],
  puroks: ["id", "barangay_id", "archived_at"],
  garbage_bins: ["id", "purok_id", "is_active", "archived_at"],
  collection_runs: ["id", "barangay_id", "collector_user_id", "collection_date", "status", "started_at", "completed_at"],
  collection_requests: ["id", "bin_id", "assigned_collector_id", "status"],
  household_bins: ["bin_id", "resident_id", "qr_hash"],
  household_collections: ["id", "run_id", "bin_id", "resident_id", "collector_id", "purok_id", "barangay_id", "segregation", "collection_status", "idempotency_key", "collected_at"],
  activity_logs: ["id", "actor_id", "actor_name", "actor_role", "barangay_id", "purok_id", "resident_id", "action", "entity_type", "entity_id", "details", "occurred_at"],
  complaints: ["id", "purok_id", "assigned_collector_id", "admin_only", "archived_at"],
  household_violations: ["id", "resident_id", "policy_id", "suspension_until"],
  barangay_violation_policies: ["id", "action", "suspension_scope"],
  household_violation_reviews: ["violation_id", "decision"],
};
const phaseColumns: Record<string, string[]> = {
  collector_purok_assignments: ["collector_id", "purok_id", "is_active", "assigned_by", "assigned_at"],
  collection_run_puroks: ["run_id", "purok_id"],
  collection_run_bins: ["run_id", "bin_id", "resident_id", "purok_id"],
};
const uniqueKeys: [string, string[]][] = [
  ["users", ["id"]], ["puroks", ["id"]], ["garbage_bins", ["id"]], ["collection_runs", ["id"]],
  ["collection_runs", ["barangay_id", "collection_date"]], ["household_bins", ["bin_id"]], ["household_bins", ["qr_hash"]],
  ["household_collections", ["run_id", "bin_id"]], ["household_collections", ["collector_id", "idempotency_key"]],
  ["collector_purok_assignments", ["collector_id", "purok_id"]], ["collection_run_puroks", ["run_id", "purok_id"]],
  ["collection_run_bins", ["run_id", "bin_id"]],
];
const foreignKeys: [string, string, string[], string, string[]][] = [
  ["household_bins", "fk_household_bin", ["bin_id"], "garbage_bins", ["id"]],
  ["household_bins", "fk_bin_household", ["resident_id"], "users", ["id"]],
  ["household_collections", "fk_pickup_run", ["run_id"], "collection_runs", ["id"]],
  ["household_collections", "fk_pickup_bin", ["bin_id"], "garbage_bins", ["id"]],
  ["collector_purok_assignments", "fk_cpa_collector", ["collector_id"], "users", ["id"]],
  ["collector_purok_assignments", "fk_cpa_purok", ["purok_id"], "puroks", ["id"]],
  ["collector_purok_assignments", "fk_cpa_admin", ["assigned_by"], "users", ["id"]],
  ["collection_run_puroks", "fk_run_purok_run", ["run_id"], "collection_runs", ["id"]],
  ["collection_run_puroks", "fk_run_purok_purok", ["purok_id"], "puroks", ["id"]],
  ["collection_run_bins", "fk_run_bin_run", ["run_id"], "collection_runs", ["id"]],
  ["collection_run_bins", "fk_run_bin_bin", ["bin_id"], "garbage_bins", ["id"]],
  ["collection_run_bins", "fk_run_bin_household", ["resident_id"], "users", ["id"]],
  ["collection_run_bins", "fk_run_bin_purok", ["run_id", "purok_id"], "collection_run_puroks", ["run_id", "purok_id"]],
];

async function readPhase1Schema(connection: PoolConnection) {
  const targets = {...baseColumns, ...phaseColumns}, names = Object.keys(targets);
  const [tables] = await connection.query<any[]>("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)", [names]);
  const [columns] = await connection.query<any[]>("SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)", [names]);
  const [indexes] = await connection.query<any[]>("SELECT TABLE_NAME AS tbl, INDEX_NAME AS idx, COLUMN_NAME AS col, NON_UNIQUE AS non_unique, SUB_PART AS sub_part FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX", [names]);
  const [keys] = await connection.query<any[]>(`SELECT k.TABLE_NAME AS tbl, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col,
    k.REFERENCED_TABLE_NAME AS parent, k.REFERENCED_COLUMN_NAME AS parent_col,
    k.REFERENCED_TABLE_SCHEMA = DATABASE() AS same_schema, r.DELETE_RULE AS delete_rule, r.UPDATE_RULE AS update_rule
    FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.TABLE_NAME IN (?) ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [names]);
  const dependencyIssues: string[] = [], phase1Issues: string[] = [];
  const isPhaseTable = (table: string) => Object.prototype.hasOwnProperty.call(phaseColumns, table);
  const issuesFor = (table: string) => isPhaseTable(table) ? phase1Issues : dependencyIssues;
  const column = (table: string, name: string) => columns.find(c => c.tbl === table && c.col === name);
  const same = (left: string[], right: string[]) => left.join(",") === right.join(",");
  for (const [table, required] of Object.entries(targets)) {
    const found = tables.find(t => t.name === table), issues = issuesFor(table);
    if (!found) { issues.push(`Missing table: ${table}`); continue; }
    if (String(found.engine).toLowerCase() !== "innodb") issues.push(`InnoDB required: ${table}`);
    for (const name of required) if (!column(table, name)) issues.push(`Missing column: ${table}.${name}`);
  }
  const reason = column("household_collections", "not_collected_reason");
  if (!reason || reason.type !== "varchar(1000)" || reason.nullable !== "YES") phase1Issues.push("Nullable VARCHAR(1000) required: household_collections.not_collected_reason");
  for (const [table, field, values] of [
    ["collection_runs", "status", ["pending", "in_progress", "completed", "cancelled"]],
    ["household_collections", "collection_status", ["collected", "not_collected"]],
    ["household_collections", "segregation", ["segregated", "not_segregated"]],
  ] as [string, string, string[]][]) {
    const type = String(column(table, field)?.type || "");
    if (!type.startsWith("enum(") || values.some(value => !type.includes(`'${value}'`))) dependencyIssues.push(`Missing required enum values: ${table}.${field}`);
  }
  const normalizedType = (value: unknown) => String(value || "").toLowerCase().replace(/\(\d+\)/g, "");
  for (const table of ["users", "puroks", "garbage_bins", "collection_runs"]) {
    const expected = table === "collection_runs" ? "bigint unsigned" : "int unsigned";
    if (normalizedType(column(table, "id")?.type) !== expected) dependencyIssues.push(`Incompatible parent ID type: ${table}.id; expected ${expected}`);
  }
  for (const [table, required] of uniqueKeys) {
    const candidates = indexes.filter(i => i.tbl === table && Number(i.non_unique) === 0);
    if (![...new Set(candidates.map(i => i.idx))].some(name => {
      const parts = candidates.filter(i => i.idx === name);
      return parts.every(i => i.sub_part == null) && same(parts.map(i => i.col), required);
    })) issuesFor(table).push(`Missing full unique index: ${table}(${required.join(",")})`);
  }
  for (const [table, name, child, parent, parentColumns] of foreignKeys) {
    const found = keys.filter(k => k.tbl === table && k.name === name);
    if (!same(found.map(k => k.col), child) || !same(found.map(k => k.parent_col), parentColumns) || found.some(k => k.parent !== parent || !Number(k.same_schema) || !["RESTRICT", "NO ACTION"].includes(k.delete_rule) || !["RESTRICT", "NO ACTION"].includes(k.update_rule))) {
      issuesFor(table).push(`Missing/incompatible restrictive foreign key: ${table}.${name}`);
    }
    for (let i = 0; i < child.length; i++) {
      const source = column(table, child[i]), target = column(parent, parentColumns[i]);
      if (source && target && normalizedType(source.type) !== normalizedType(target.type)) issuesFor(table).push(`Foreign-key column type mismatch: ${table}.${child[i]}`);
    }
  }
  for (const [table, required] of [["collector_purok_assignments", ["purok_id", "is_active"]], ["collection_run_puroks", ["purok_id", "run_id"]], ["collection_run_bins", ["bin_id", "run_id"]]] as [string, string[]][]) {
    const candidates = indexes.filter(i => i.tbl === table);
    if (![...new Set(candidates.map(i => i.idx))].some(name => {
      const parts = candidates.filter(i => i.idx === name);
      return parts.every(i => i.sub_part == null) && same(parts.map(i => i.col), required);
    })) phase1Issues.push(`Missing coverage index: ${table}(${required.join(",")})`);
  }
  const markers = tables.filter(t => isPhaseTable(t.name)).length + Number(Boolean(reason));
  const state = markers === 0 ? "unapplied" : markers === 4 ? "applied" : "partial";
  return {state, ready: state === "applied" && !dependencyIssues.length && !phase1Issues.length, dependencyIssues, phase1Issues};
}

export async function inspectPhase1Schema(connection?: PoolConnection) {
  if (connection) return readPhase1Schema(connection);
  const owned = await db.getConnection();
  try { return await readPhase1Schema(owned); }
  finally { owned.release(); }
}
