import { db } from "../config/db.js";
import { inspectPhase1Schema } from "../services/phase1Schema.js";

// Operator-invoked only. SELECTs from information_schema; no DDL or row writes.
try {
  const report = await inspectPhase1Schema();
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--before-up")) {
    if (report.state !== "unapplied" || report.dependencyIssues.length) {
      console.error("STOP: dependencies must pass and Phase 1 must be entirely unapplied. Never rerun a partial/applied migration.");
      process.exitCode = 1;
    } else console.log("Schema preconditions only: review backup, maintenance and the migration before separately authorizing execution.");
  } else if (!report.ready) process.exitCode = 1;
} catch {
  console.error("Preflight unavailable. No migration was executed. Check database configuration and metadata-read permissions privately.");
  process.exitCode = 1;
} finally { await db.end().catch(() => { process.exitCode = 1; }); }
