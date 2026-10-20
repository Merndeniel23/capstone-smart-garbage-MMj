import { Router, type RequestHandler } from "express";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../config/db.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/security.js";
import { audit, canAccess, DomainError, positiveId, requiredText, revisionsEnabled, transaction } from "../services/sgms.js";
import { createTextPdf } from "../services/endorsementPdf.js";
import { sendAccountActivation } from "../services/accountActivation.js";

const router = Router();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const endpoint = (work: (req: AuthRequest, res: any) => Promise<any>): RequestHandler => async (req, res) => {
  try { await work(req as AuthRequest, res); }
  catch (error: any) {
    const status = error instanceof DomainError ? error.status : error?.code === "ER_DUP_ENTRY" ? 409 : 500;
    if (status === 500) console.error("SGMS operation failed", {code: error?.code});
    res.status(status).json({message: error instanceof DomainError ? error.message : status === 409 ? "This record was already submitted or conflicts with another record." : "Unable to complete this operation."});
  }
};
const enabled: RequestHandler = (_req, res, next) => revisionsEnabled() ? next() : res.status(503).json({message: "Panel revisions require the reviewed migration and SGMS_REVISIONS_ENABLED configuration."});
function role(req: AuthRequest, allowed: string[]) { if (!allowed.includes(req.user!.role)) throw new DomainError("You do not have permission for this action.", 403); }
function scope(req: AuthRequest, alias: string, residentColumn = "resident_id"): {sql: string; values: any[]} {
  const user = req.user!;
  if (user.role === "super_admin") return {sql: "1=1", values: []};
  if (user.role === "resident") return {sql: `${alias}.${residentColumn} = ?`, values: [user.id]};
  if (!user.barangay_id) throw new DomainError("Your account has no assigned barangay.", 403);
  if (user.role === "purok_leader") {
    if (!user.purok_id) throw new DomainError("Your account has no assigned purok.", 403);
    return {sql: `${alias}.barangay_id = ? AND ${alias}.purok_id = ?`, values: [user.barangay_id, user.purok_id]};
  }
  if (!["admin","collector"].includes(user.role)) throw new DomainError("Access denied.", 403);
  return {sql: `${alias}.barangay_id = ?`, values: [user.barangay_id]};
}
router.get("/config", (_req, res) => res.json({enabled: revisionsEnabled()}));
router.use(enabled, requireAuth);

router.get("/endorsement-records",endpoint(async(req,res)=>{
  role(req,["admin"]);
  const [endorsements]=await db.query<any[]>("SELECT id,request_code,requester_name_snapshot,purok_name_snapshot,status,purpose,created_at,leader_name_snapshot,leader_reviewed_at,issued_at FROM endorsement_requests WHERE barangay_id = ? AND archived_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 500",[req.user!.barangay_id]);
  res.json({endorsements});
}));
router.post("/complaints/:id/investigate",endpoint(async(req,res)=>{
  role(req,["admin","super_admin"]);
  const id=positiveId(req.params.id);
  await transaction(async connection=>{
    const [rows]=await connection.query<any[]>("SELECT c.*,p.barangay_id FROM complaints c JOIN puroks p ON p.id = c.purok_id WHERE c.id = ? AND c.archived_at IS NULL FOR UPDATE",[id]);
    const complaint=rows[0];
    if(!complaint||!canAccess(req.user!,complaint))throw new DomainError("Complaint not found.",404);
    if(complaint.status==="in_progress")return;
    if(!["pending","assigned"].includes(complaint.status))throw new DomainError("This complaint is already final or ready for resolution.",409);
    await connection.execute("UPDATE complaints SET status = 'in_progress',started_at = NOW() WHERE id = ? AND status = ?",[id,complaint.status]);
    await connection.execute("INSERT INTO complaint_messages (complaint_id,sender_id,message) VALUES (?,?,'Admin investigation started.')",[id,req.user!.id]);
    await audit(connection,req.user!,"complaint_investigation_started","complaints",id,{...complaint,resident_id:complaint.reported_by});
    await connection.execute("INSERT INTO notifications (recipient_user_id,barangay_id,purok_id,title,message,notification_type,created_by) VALUES (?,?,?,'Complaint investigation started','The Admin is investigating your complaint.','complaint_update',?)",[complaint.reported_by,complaint.barangay_id,complaint.purok_id,req.user!.id]);
  });
  res.json({message:"Investigation started."});
}));

router.get("/puroks", endpoint(async (req,res)=>{
  role(req,["admin","purok_leader","resident","collector","super_admin"]);
  const user=req.user!;
  const [puroks]=await db.query<any[]>(`SELECT p.id,p.name,p.description,p.barangay_id FROM puroks p WHERE p.archived_at IS NULL ${user.role==="super_admin"?"":"AND p.barangay_id = ?"} ORDER BY p.name`,user.role==="super_admin"?[]:[user.barangay_id]);
  res.json({puroks});
}));
router.post("/households", endpoint(async(req,res)=>{
  role(req,["admin"]);
  const fullName=requiredText(req.body.fullName,150),email=requiredText(req.body.email,150).toLowerCase(),phone=requiredText(req.body.phone,30),address=requiredText(req.body.address,255),purokId=positiveId(req.body.purokId);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^(09\d{9}|\+639\d{9})$/.test(phone))throw new DomainError("Enter a valid email and Philippine mobile number.");
  const unusableHash=await bcrypt.hash(randomBytes(32).toString("hex"),12);
  await transaction(async connection=>{
    const [puroks]=await connection.query<any[]>("SELECT id FROM puroks WHERE id = ? AND barangay_id = ? AND archived_at IS NULL FOR UPDATE",[purokId,req.user!.barangay_id]);
    if(!puroks.length)throw new DomainError("Choose a purok within your assigned barangay.");
    const [created]:any=await connection.execute("INSERT INTO users (full_name,email,phone,address,password_hash,role,barangay_id,purok_id,status,must_change_password) VALUES (?,?,?,?,?,'resident',?,?,'pending_activation',1)",[fullName,email,phone,address,unusableHash,req.user!.barangay_id,purokId]);
    await sendAccountActivation(connection,{id:Number(created.insertId),email,full_name:fullName});
    await audit(connection,req.user!,"household_registered","users",Number(created.insertId),{resident_id:Number(created.insertId),purok_id:purokId});
  });
  res.status(201).json({message:"Household registered. A single-use password setup link was emailed to its account holder."});
}));
router.get("/payment-history", endpoint(async(req,res)=>{
  role(req,["admin","super_admin","purok_leader","resident"]);
  const area=scope(req,"pay");
  const [payments]=await db.query<any[]>(`SELECT pay.id,pay.transaction_code,pay.resident_id,pay.amount,pay.category,pay.billing_period,pay.payment_method,pay.payment_reference,pay.status,pay.created_at,pay.leader_verified_at,pay.leader_remarks,pay.admin_confirmed_at,u.full_name AS resident_name,leader.full_name AS leader_name,a.archived_at
    FROM payments pay JOIN users u ON u.id = pay.resident_id LEFT JOIN users leader ON leader.id = pay.leader_verified_by LEFT JOIN payment_archives a ON a.payment_id = pay.id WHERE ${area.sql} ORDER BY pay.created_at DESC,pay.id DESC LIMIT 500`,area.values);
  res.json({payments});
}));

router.get("/households", endpoint(async (req, res) => {
  role(req, ["admin","super_admin","purok_leader","resident"]);
  const area = scope(req, "u", "id");
  const [rows] = await db.query<any[]>(`SELECT u.id, u.id AS resident_id, u.full_name, u.email, u.phone, u.address, u.barangay_id, u.purok_id, p.name AS purok_name, b.name AS barangay_name
    FROM users u LEFT JOIN puroks p ON p.id = u.purok_id LEFT JOIN barangays b ON b.id = u.barangay_id
    WHERE u.role = 'resident' AND u.archived_at IS NULL AND u.email NOT LIKE '%@deleted.sgms.local' AND ${area.sql} ORDER BY u.full_name`, area.values);
  const ids = rows.map(row => row.id);
  const [members] = ids.length ? await db.query<any[]>("SELECT * FROM household_members WHERE resident_id IN (?) AND archived_at IS NULL ORDER BY full_name", [ids]) : [[]];
  const [bins] = ids.length ? await db.query<any[]>(`SELECT hb.resident_id, gb.id, gb.bin_code, gb.location_name FROM household_bins hb JOIN garbage_bins gb ON gb.id = hb.bin_id WHERE hb.resident_id IN (?) AND gb.archived_at IS NULL AND gb.is_active = 1`, [ids]) : [[]];
  res.json({households: rows.map(row => ({...row, members: members.filter(member => member.resident_id === row.id), bins: bins.filter(bin => bin.resident_id === row.id)}))});
}));
router.post("/households/:id/members", endpoint(async (req, res) => {
  role(req, ["admin"]);
  const residentId = positiveId(req.params.id);
  const name = requiredText(req.body.fullName, 150), relationship = requiredText(req.body.relationship, 80);
  await transaction(async connection => {
    const [rows] = await connection.query<any[]>("SELECT id AS resident_id, barangay_id, purok_id FROM users WHERE id = ? AND role = 'resident' AND archived_at IS NULL FOR UPDATE", [residentId]);
    if (!rows[0] || !canAccess(req.user!, rows[0])) throw new DomainError("Household not found.", 404);
    const [created]: any = await connection.execute("INSERT INTO household_members (resident_id, full_name, relationship) VALUES (?, ?, ?)", [residentId, name, relationship]);
    await audit(connection, req.user!, "household_member_created", "household_members", Number(created.insertId), rows[0]);
  });
  res.status(201).json({message: "Household member recorded."});
}));
router.patch("/households/:id", endpoint(async (req, res) => {
  role(req, ["admin"]);
  const id = positiveId(req.params.id), purokId = positiveId(req.body.purokId);
  const address = requiredText(req.body.address, 255), phone = requiredText(req.body.phone, 30);
  if (!/^(09\d{9}|\+639\d{9})$/.test(phone)) throw new DomainError("Enter a valid Philippine mobile number.");
  await transaction(async connection => {
    const [rows] = await connection.query<any[]>("SELECT id AS resident_id, purok_id, barangay_id FROM users WHERE id = ? AND role = 'resident' AND archived_at IS NULL FOR UPDATE", [id]);
    if (!rows[0] || !canAccess(req.user!, rows[0])) throw new DomainError("Household not found.", 404);
    const [puroks] = await connection.query<any[]>("SELECT id FROM puroks WHERE id = ? AND barangay_id = ? AND archived_at IS NULL FOR UPDATE", [purokId, req.user!.barangay_id]);
    if (!puroks.length) throw new DomainError("Choose an active purok in your barangay.");
    const [links] = await connection.query<any[]>("SELECT hb.bin_id FROM household_bins hb JOIN garbage_bins gb ON gb.id = hb.bin_id WHERE hb.resident_id = ? AND gb.purok_id <> ?", [id, purokId]);
    if (links.length) throw new DomainError("Reconcile the household's registered bins before changing its purok.", 409);
    await connection.execute("UPDATE users SET address = ?, phone = ?, purok_id = ? WHERE id = ?", [address, phone, purokId, id]);
    await audit(connection, req.user!, "household_updated", "users", id, {...rows[0], purok_id: purokId});
  });
  res.json({message: "Household record updated."});
}));
router.post("/households/:id/bin", endpoint(async (req, res) => {
  role(req, ["admin","purok_leader"]);
  const residentId = positiveId(req.params.id), binId = positiveId(req.body.binId);
  const token = randomBytes(32).toString("hex");
  await transaction(async connection => {
    const [rows] = await connection.query<any[]>(`SELECT u.id AS resident_id, u.barangay_id, u.purok_id FROM users u JOIN garbage_bins gb ON gb.purok_id = u.purok_id JOIN puroks p ON p.id = gb.purok_id AND p.barangay_id = u.barangay_id
      WHERE u.id = ? AND gb.id = ? AND u.role = 'resident' AND u.status = 'active' AND u.archived_at IS NULL AND gb.is_active = 1 AND gb.archived_at IS NULL AND p.archived_at IS NULL FOR UPDATE`, [residentId, binId]);
    if (!rows[0] || !canAccess(req.user!, rows[0])) throw new DomainError("The active bin and household must belong to your assigned area and the same purok.", 404);
    // Refuse silent reassignment of a bin with historical household evidence.
    const [links] = await connection.query<any[]>("SELECT resident_id FROM household_bins WHERE bin_id = ? FOR UPDATE", [binId]);
    if (links[0] && Number(links[0].resident_id) !== residentId) throw new DomainError("This bin is registered to another household.", 409);
    await connection.execute("INSERT INTO household_bins (bin_id, resident_id, qr_hash, registered_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE qr_hash = VALUES(qr_hash), registered_by = VALUES(registered_by)", [binId, residentId, digest(token), req.user!.id]);
    await audit(connection, req.user!, "bin_qr_registered", "garbage_bins", binId, rows[0]);
  });
  res.status(201).json({message: "QR payload registered. Any previous QR for this bin is invalid.", qrPayload: `SGMS:1:${token}`});
}));

router.post("/collections/identify", endpoint(async (req, res) => {
  role(req, ["collector"]);
  const token = String(req.body.qrPayload || "").match(/^SGMS:1:([a-f0-9]{64})$/)?.[1];
  if (!token) throw new DomainError("Invalid household bin QR code.");
  const [rows] = await db.query<any[]>(`SELECT gb.id AS bin_id, gb.bin_code, gb.location_name, u.id AS resident_id, u.full_name, u.barangay_id, u.purok_id, p.name AS purok_name
    FROM household_bins hb JOIN garbage_bins gb ON gb.id = hb.bin_id JOIN users u ON u.id = hb.resident_id JOIN puroks p ON p.id = gb.purok_id
    WHERE hb.qr_hash = ? AND gb.is_active = 1 AND gb.archived_at IS NULL AND u.archived_at IS NULL AND u.status = 'active'
      AND p.archived_at IS NULL AND u.purok_id = gb.purok_id AND u.barangay_id = p.barangay_id AND p.barangay_id = ?`, [digest(token), req.user!.barangay_id]);
  if (!rows[0]) throw new DomainError("No authorized active household bin matches this QR.", 404);
  res.json({bin: rows[0]});
}));
router.post("/collections", endpoint(async (req, res) => {
  role(req, ["collector"]);
  const token = String(req.body.qrPayload || "").match(/^SGMS:1:([a-f0-9]{64})$/)?.[1];
  const key = requiredText(req.body.idempotencyKey, 80);
  if (!token || !["segregated","not_segregated"].includes(req.body.segregation) || !["collected","not_collected"].includes(req.body.collectionStatus)) throw new DomainError("Scan a registered QR and choose segregation and collection results.");
  const result = await transaction(async connection => {
    const [rows] = await connection.query<any[]>(`SELECT hb.bin_id, hb.resident_id, u.barangay_id, u.purok_id FROM household_bins hb
      JOIN garbage_bins gb ON gb.id = hb.bin_id JOIN users u ON u.id = hb.resident_id JOIN puroks p ON p.id = gb.purok_id
      WHERE hb.qr_hash = ? AND gb.is_active = 1 AND gb.archived_at IS NULL AND u.archived_at IS NULL AND u.status = 'active'
        AND p.archived_at IS NULL AND gb.purok_id = u.purok_id AND p.barangay_id = u.barangay_id AND p.barangay_id = ? FOR UPDATE`, [digest(token), req.user!.barangay_id]);
    const bin = rows[0];
    if (!bin) throw new DomainError("No authorized active household bin matches this QR.", 404);
    const [assignedElsewhere]=await connection.query<any[]>("SELECT id FROM collection_requests WHERE bin_id = ? AND assigned_collector_id IS NOT NULL AND assigned_collector_id <> ? AND status IN ('pending','approved','assigned','in_progress') FOR UPDATE",[bin.bin_id,req.user!.id]);
    if(assignedElsewhere.length)throw new DomainError("This bin has an active task assigned to another Collector.",403);
    const [previous] = await connection.query<any[]>("SELECT * FROM household_collections WHERE collector_id = ? AND idempotency_key = ?", [req.user!.id, key]);
    if (previous[0]) {
      if (Number(previous[0].bin_id) !== Number(bin.bin_id) || previous[0].segregation !== req.body.segregation || previous[0].collection_status !== req.body.collectionStatus) throw new DomainError("This submission key has different collection data.", 409);
      return {id: previous[0].id, duplicate: true};
    }
    const [runs] = await connection.query<any[]>("SELECT id FROM collection_runs WHERE collector_user_id = ? AND barangay_id = ? AND collection_date = CURDATE() AND status = 'in_progress' LIMIT 1 FOR UPDATE", [req.user!.id, bin.barangay_id]);
    if (!runs[0]) throw new DomainError("Start today's assigned collection run before submitting a bin scan.", 409);
    if (req.body.collectionStatus === "collected") {
      const [suspensions]=await connection.query<any[]>("SELECT v.id FROM household_violations v JOIN barangay_violation_policies p ON p.id = v.policy_id WHERE v.resident_id = ? AND p.action = 'suspension' AND p.suspension_scope = 'collection' AND v.suspension_until > NOW() AND NOT EXISTS(SELECT 1 FROM household_violation_reviews r WHERE r.violation_id = v.id AND r.decision = 'voided')",[bin.resident_id]);
      if(suspensions.length)throw new DomainError("Collection service is suspended under an approved policy. Record the bin as not collected.",409);
    }
    const [created]: any = await connection.execute("INSERT INTO household_collections (run_id, bin_id, resident_id, collector_id, purok_id, barangay_id, segregation, collection_status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [runs[0].id, bin.bin_id, bin.resident_id, req.user!.id, bin.purok_id, bin.barangay_id, req.body.segregation, req.body.collectionStatus, key]);
    const id = Number(created.insertId);
    if (req.body.collectionStatus === "collected") {
      await connection.execute("UPDATE garbage_bins SET current_status = 'empty' WHERE id = ?", [bin.bin_id]);
      await connection.execute("UPDATE collection_requests SET status = 'completed', assigned_collector_id = ?, completed_at = NOW() WHERE bin_id = ? AND status IN ('pending','approved','assigned','in_progress') AND (assigned_collector_id IS NULL OR assigned_collector_id = ?)", [req.user!.id, bin.bin_id, req.user!.id]);
    }
    await connection.execute(`INSERT INTO notifications (recipient_role, barangay_id, purok_id, notification_type, title, message, related_entity_type, related_entity_id, created_by)
      VALUES ('purok_leader', ?, ?, 'collection_result', 'Household collection recorded', ?, 'household_collection', ?, ?)`, [bin.barangay_id, bin.purok_id, `Household HH-${bin.resident_id}: ${req.body.segregation === "segregated" ? "Segregated" : "Not Segregated"}; ${req.body.collectionStatus.replaceAll("_", " ")}.`, id, req.user!.id]);
    await audit(connection, req.user!, "collection_recorded", "household_collections", id, bin, {segregation: req.body.segregation, collectionStatus: req.body.collectionStatus});
    return {id, duplicate: false};
  });
  res.status(result.duplicate ? 200 : 201).json({...result, message: result.duplicate ? "This submission was already recorded." : "Collection recorded and the assigned Purok Leader notified."});
}));
router.get("/collections", endpoint(async (req, res) => {
  const area = scope(req, "c");
  const [rows] = await db.query<any[]>(`SELECT c.*, u.full_name AS household_name, collector.full_name AS collector_name, gb.bin_code, p.name AS purok_name FROM household_collections c JOIN users u ON u.id = c.resident_id JOIN users collector ON collector.id = c.collector_id JOIN garbage_bins gb ON gb.id = c.bin_id JOIN puroks p ON p.id = c.purok_id WHERE ${area.sql} ${req.user!.role === "collector" ? "AND c.collector_id = ?" : ""} ORDER BY c.collected_at DESC, c.id DESC LIMIT 500`, [...area.values, ...(req.user!.role === "collector" ? [req.user!.id] : [])]);
  res.json({collections: rows});
}));
router.get("/policies", endpoint(async (req, res) => {
  role(req, ["admin","super_admin","purok_leader","resident"]);
  const [rows] = await db.query<any[]>(`SELECT * FROM barangay_violation_policies WHERE is_active = 1 ${req.user!.role === "super_admin" ? "" : "AND barangay_id = ?"} ORDER BY id DESC`, req.user!.role === "super_admin" ? [] : [req.user!.barangay_id]);
  res.json({policies: rows});
}));
router.post("/policies", endpoint(async (req, res) => {
  role(req, ["admin"]);
  const title = requiredText(req.body.title, 180), reference = requiredText(req.body.officialReference, 255), action = req.body.action;
  const fine = action === "fine" ? Number(req.body.fineAmount) : null, days = action === "suspension" ? Number(req.body.suspensionDays) : null;
  if (req.body.confirmApproved !== true || !["warning","fine","suspension"].includes(action) || (fine !== null && (!Number.isFinite(fine) || fine <= 0 || fine > 99999999.99 || Math.abs(Math.round(fine * 100) - fine * 100) > 0.000001)) || (days !== null && (!Number.isSafeInteger(days) || days <= 0 || days > 3650 || !["collection","account"].includes(req.body.suspensionScope)))) throw new DomainError("Supply an approved policy reference and its exact approved amount, duration and scope.");
  await transaction(async connection => {
    const [created]: any = await connection.execute("INSERT INTO barangay_violation_policies (barangay_id,title,official_reference,action,fine_amount,suspension_days,suspension_scope,approved_by) VALUES (?,?,?,?,?,?,?,?)", [req.user!.barangay_id,title,reference,action,fine,days,action === "suspension" ? req.body.suspensionScope : null,req.user!.id]);
    await audit(connection, req.user!, "approved_policy_recorded", "barangay_violation_policies", Number(created.insertId));
  });
  res.status(201).json({message: "Approved policy recorded. Existing policy versions remain unchanged."});
}));
router.get("/violations", endpoint(async (req, res) => {
  role(req, ["admin","super_admin","purok_leader","resident"]);
  const area = scope(req, "c");
  const [rows] = await db.query<any[]>(`SELECT v.*, p.title, p.action, p.fine_amount, p.official_reference, u.full_name AS household_name, actor.full_name AS issued_by_name, r.decision AS review_decision, r.reason AS review_reason, r.reviewed_at FROM household_violations v JOIN household_collections c ON c.id = v.collection_id JOIN barangay_violation_policies p ON p.id = v.policy_id JOIN users u ON u.id = v.resident_id JOIN users actor ON actor.id = v.issued_by LEFT JOIN household_violation_reviews r ON r.violation_id = v.id WHERE ${area.sql} ORDER BY v.issued_at DESC, v.id DESC LIMIT 500`, area.values);
  res.json({violations: rows});
}));
router.post("/violations", endpoint(async (req, res) => {
  role(req, ["purok_leader"]);
  const collectionId = positiveId(req.body.collectionId), policyId = positiveId(req.body.policyId), reason = requiredText(req.body.reason, 1000);
  await transaction(async connection => {
    const [events] = await connection.query<any[]>("SELECT * FROM household_collections WHERE id = ? AND segregation = 'not_segregated' FOR UPDATE", [collectionId]);
    if (!events[0] || !canAccess(req.user!, events[0])) throw new DomainError("Non-compliant collection not found in your purok.", 404);
    const [policies] = await connection.query<any[]>("SELECT * FROM barangay_violation_policies WHERE id = ? AND barangay_id = ? AND is_active = 1 FOR UPDATE", [policyId, events[0].barangay_id]);
    const policy = policies[0];
    if (!policy) throw new DomainError("Choose an approved active barangay policy.");
    const [created]: any = await connection.execute("INSERT INTO household_violations (collection_id,policy_id,resident_id,issued_by,reason,suspension_until) VALUES (?,?,?,?,?,CASE WHEN ? IS NULL THEN NULL ELSE DATE_ADD(NOW(), INTERVAL ? DAY) END)", [collectionId,policyId,events[0].resident_id,req.user!.id,reason,policy.suspension_days,policy.suspension_days]);
    await audit(connection, req.user!, `violation_${policy.action}_issued`, "household_violations", Number(created.insertId), events[0], {policyId, reason});
    await connection.execute("INSERT INTO notifications (recipient_user_id,barangay_id,purok_id,title,message,notification_type,created_by) VALUES (?,?,?,?,?,'violation',?)", [events[0].resident_id,events[0].barangay_id,events[0].purok_id,"Household violation recorded",`${policy.title}: ${reason}`,req.user!.id]);
  });
  res.status(201).json({message: "Violation recorded under the selected approved policy."});
}));
router.post("/violations/:id/review",endpoint(async(req,res)=>{
  role(req,["admin"]);
  const id=positiveId(req.params.id),reason=requiredText(req.body.reason,1000),decision=req.body.decision;
  if(!["upheld","voided"].includes(decision))throw new DomainError("Choose an explicit review decision.");
  await transaction(async connection=>{
    const [rows]=await connection.query<any[]>("SELECT v.id,c.resident_id,c.barangay_id,c.purok_id FROM household_violations v JOIN household_collections c ON c.id = v.collection_id WHERE v.id = ? FOR UPDATE",[id]);
    if(!rows[0]||!canAccess(req.user!,rows[0]))throw new DomainError("Violation not found.",404);
    await connection.execute("INSERT INTO household_violation_reviews (violation_id,decision,reason,reviewed_by) VALUES (?,?,?,?)",[id,decision,reason,req.user!.id]);
    await audit(connection,req.user!,"violation_reviewed","household_violations",id,rows[0],{decision,reason});
  });
  res.json({message:"Review recorded. The original violation and policy remain preserved."});
}));
router.get("/activity", endpoint(async (req, res) => {
  role(req, ["admin","super_admin","purok_leader","resident","collector"]);
  const area = scope(req, "a");
  const [rows] = await db.query<any[]>(`SELECT a.* FROM activity_logs a WHERE ${area.sql} ${["purok_leader","collector"].includes(req.user!.role) ? "AND a.entity_type <> 'complaints'" : ""} ${req.user!.role === "collector" ? "AND a.actor_id = ?" : ""} ORDER BY a.occurred_at DESC,a.id DESC LIMIT 500`, [...area.values,...(req.user!.role === "collector" ? [req.user!.id] : [])]);
  res.json({activities: rows, timezone: "Asia/Manila"});
}));
router.post("/endorsement-templates", endpoint(async (req, res) => {
  role(req, ["admin"]);
  const body = requiredText(req.body.body, 20000), reference = requiredText(req.body.officialReference, 255);
  const placeholders = ["resident_name","address","barangay","purok","purpose","leader_name","certificate_number","issue_date"];
  if (req.body.confirmApproved !== true || [...body.matchAll(/\{\{([^}]+)\}\}/g)].some(match => !placeholders.includes(match[1].trim()))) throw new DomainError("Confirm that the template is officially approved and use supported placeholders.");
  await transaction(async connection => {
    const [created]: any = await connection.execute("INSERT INTO barangay_endorsement_templates (barangay_id,official_reference,body,approved_by) VALUES (?,?,?,?)", [req.user!.barangay_id,reference,body,req.user!.id]);
    await audit(connection, req.user!, "approved_template_recorded", "barangay_endorsement_templates", Number(created.insertId));
  });
  res.status(201).json({message: "Approved template version recorded."});
}));
router.get("/endorsements/:id/pdf", endpoint(async (req, res) => {
  const id = positiveId(req.params.id);
  const [rows] = await db.query<any[]>("SELECT *, requester_id AS resident_id FROM endorsement_requests WHERE id = ? AND status = 'approved'", [id]);
  const request = rows[0];
  role(req, ["admin","purok_leader","resident"]);
  if (!request || !canAccess(req.user!, request)) throw new DomainError("Approved endorsement not found.", 404);
  if (!request.issued_document_text) throw new DomainError("This legacy endorsement has no approved document snapshot. Its existing print copy remains available.", 409);
  await transaction(connection => audit(connection, req.user!, "endorsement_downloaded", "endorsement_requests", id, request));
  res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `attachment; filename="endorsement-${id}.pdf"`);
  res.send(createTextPdf(request.issued_document_text));
}));

export const archiveRouter = Router();
const archiveWriteLimit=createRateLimiter({windowMs:60_000,maxRequests:10,message:"Too many archive actions. Please wait before continuing."});
const archiveDefinitions: Record<string, {table: string; query: string; roles: string[]}> = {
  users: {table:"users",query:"SELECT u.*, u.id AS resident_id FROM users u WHERE u.id = ? FOR UPDATE",roles:["admin","super_admin"]},
  puroks: {table:"puroks",query:"SELECT p.*, p.id AS purok_id FROM puroks p WHERE p.id = ? FOR UPDATE",roles:["admin"]},
  bins: {table:"garbage_bins",query:"SELECT gb.*,p.barangay_id FROM garbage_bins gb JOIN puroks p ON p.id = gb.purok_id WHERE gb.id = ? FOR UPDATE",roles:["admin","purok_leader"]},
  inspections: {table:"bin_inspections",query:"SELECT bi.*,gb.purok_id,p.barangay_id FROM bin_inspections bi JOIN garbage_bins gb ON gb.id = bi.bin_id JOIN puroks p ON p.id = gb.purok_id WHERE bi.id = ? FOR UPDATE",roles:["admin","purok_leader"]},
  schedules: {table:"barangay_collection_schedules",query:"SELECT s.* FROM barangay_collection_schedules s WHERE s.id = ? FOR UPDATE",roles:["admin"]},
  complaints: {table:"complaints",query:"SELECT c.*,p.barangay_id FROM complaints c JOIN puroks p ON p.id = c.purok_id WHERE c.id = ? FOR UPDATE",roles:["admin","super_admin"]},
  endorsements: {table:"endorsement_requests",query:"SELECT e.*, e.requester_id AS resident_id FROM endorsement_requests e WHERE e.id = ? FOR UPDATE",roles:["purok_leader"]},
  payments: {table:"payments",query:"SELECT p.* FROM payments p WHERE p.id = ? FOR UPDATE",roles:["purok_leader","super_admin"]},
  members: {table:"household_members",query:"SELECT m.*,u.barangay_id,u.purok_id FROM household_members m JOIN users u ON u.id = m.resident_id WHERE m.id = ? FOR UPDATE",roles:["admin"]},
  policies: {table:"barangay_violation_policies",query:"SELECT p.* FROM barangay_violation_policies p WHERE p.id = ? FOR UPDATE",roles:["admin"]},
};
const archiveAction = (entity: string, restore = false) => endpoint(async (req, res) => {
  const definition = Object.prototype.hasOwnProperty.call(archiveDefinitions,entity) ? archiveDefinitions[entity] : undefined;
  if (!definition) throw new DomainError("Unknown archive type.");
  role(req, definition.roles);
  const id = positiveId(req.params.id);
  await transaction(async connection => {
    const [rows] = await connection.query<any[]>(definition.query, [id]);
    const record = rows[0];
    if (!record || !canAccess(req.user!, record)) throw new DomainError("Record not found in your assigned area.", 404);
    if (entity === "users") {
      if (id === req.user!.id || record.role === "super_admin" || (req.user!.role === "admin" && !["resident","collector","purok_leader"].includes(record.role))) throw new DomainError("This account is protected.", 403);
      if (String(record.email).endsWith("@deleted.sgms.local")) throw new DomainError("Legacy account archives require manual identity recovery; no credentials are fabricated.", 409);
      if (!restore) {
        const [dependencies]=await connection.query<any[]>(`SELECT (EXISTS(SELECT 1 FROM garbage_trucks WHERE collector_user_id = ? AND status = 'active') OR EXISTS(SELECT 1 FROM collection_runs WHERE collector_user_id = ? AND status = 'in_progress') OR EXISTS(SELECT 1 FROM online_payment_attempts WHERE resident_id = ? AND status IN ('creating','pending'))) AS has_active`,[id,id,id]);
        if(Number(dependencies[0].has_active))throw new DomainError("Reassign active trucks and finish or reconcile ongoing collection/payment operations before archiving this account.",409);
      }
      if (restore && record.role === "purok_leader" && record.status !== "inactive") {
        const [leaders] = await connection.query<any[]>("SELECT id FROM users WHERE purok_id = ? AND role = 'purok_leader' AND id <> ? AND archived_at IS NULL AND status IN ('active','pending','pending_activation') FOR UPDATE", [record.purok_id,id]);
        if (leaders.length) throw new DomainError("Another Leader is already assigned to this purok.", 409);
      }
    }
    if (entity === "endorsements" && !["approved","leader_rejected","admin_rejected","withdrawn"].includes(record.status)) throw new DomainError("Only final endorsement records may be archived.", 409);
    if (entity === "complaints" && !["resolved","completed","cancelled"].includes(record.status)) throw new DomainError("Resolve the complaint before archiving it.", 409);
    if (entity === "payments" && record.status !== "completed") throw new DomainError("Only completed payments may be archived.", 409);
    if (entity === "puroks" && !restore) {
      const [dependants] = await connection.query<any[]>("SELECT (EXISTS(SELECT 1 FROM users WHERE purok_id = ? AND archived_at IS NULL AND email NOT LIKE '%@deleted.sgms.local') OR EXISTS(SELECT 1 FROM garbage_bins WHERE purok_id = ? AND archived_at IS NULL)) AS has_records", [id,id]);
      if (Number(dependants[0].has_records)) throw new DomainError("Archive or reassign active purok accounts and bins first.", 409);
    }
    if (entity === "bins" && !restore) {
      const [requests] = await connection.query<any[]>("SELECT id FROM collection_requests WHERE bin_id = ? AND status IN ('pending','approved','assigned','in_progress')", [id]);
      if (requests.length) throw new DomainError("Resolve active collection requests before archiving this bin.", 409);
    }
    if (entity === "schedules" && !restore) {
      const [runs]=await connection.query<any[]>("SELECT id FROM collection_runs WHERE schedule_id = ? AND status = 'in_progress'",[id]);
      if(runs.length)throw new DomainError("Complete the active collection run before archiving its schedule.",409);
    }
    if (restore && record.purok_id && entity !== "puroks") {
      const [parents] = await connection.query<any[]>("SELECT archived_at FROM puroks WHERE id = ?", [record.purok_id]);
      if (!parents[0] || parents[0].archived_at) throw new DomainError("Restore the parent purok first.", 409);
    }
    if(restore&&entity==="members") {
      const [parents]=await connection.query<any[]>("SELECT archived_at FROM users WHERE id = ?",[record.resident_id]);
      if(!parents[0]||parents[0].archived_at)throw new DomainError("Restore the household account first.",409);
    }
    let changed = false;
    if (entity === "payments") {
      const [existing] = await connection.query<any[]>("SELECT payment_id FROM payment_archives WHERE payment_id = ?", [id]);
      changed = restore ? existing.length > 0 : existing.length === 0;
      if (restore) await connection.execute("DELETE FROM payment_archives WHERE payment_id = ?", [id]);
      else await connection.execute("INSERT INTO payment_archives (payment_id,archived_by) VALUES (?,?) ON DUPLICATE KEY UPDATE payment_id = payment_id", [id,req.user!.id]);
    } else {
      changed = restore ? Boolean(record.archived_at) : !record.archived_at;
      if (changed) {
        const nativeActive=["bins","schedules","policies"].includes(entity);
        await connection.execute(`UPDATE ${definition.table} SET archived_at = ?, archived_by = ? ${nativeActive?", is_active = ?, archive_was_active = ?":""} WHERE id = ?`, [restore ? null : new Date(), restore ? null : req.user!.id,...(nativeActive?[restore ? record.archive_was_active ?? 1 : 0,restore ? null : record.is_active]:[]),id]);
      }
    }
    if (changed) await audit(connection, req.user!, restore ? "record_restored" : "record_archived", entity, id, record);
  });
  res.json({message: restore ? "Record restored." : "Record archived. Relationships and history are preserved.", archived: !restore});
});
for (const [path, entity] of [
  ["/admin/users/:id","users"],["/garbage-bins/:id","bins"],["/inspections/:id","inspections"],["/collection-schedules/:id","schedules"],["/payments/:id","payments"],["/endorsements/:id","endorsements"],["/complaints/:id","complaints"],
]) archiveRouter.delete(path, requireAuth, (req: AuthRequest, res, next) => {
  // Retain residents' existing withdrawal/cancellation semantics.
  if (req.user!.role === "resident" && ["endorsements","complaints"].includes(entity)) return next("route");
  enabled(req, res, () => archiveWriteLimit(req,res,()=>archiveAction(entity)(req, res, next)));
});
archiveRouter.patch("/payments/:id/archive", requireAuth, enabled, archiveWriteLimit, archiveAction("payments"));
router.post("/archives/:entity/:id", (req, res, next) => archiveAction(String(req.params.entity))(req, res, next));
router.post("/archives/:entity/:id/restore", (req, res, next) => archiveAction(String(req.params.entity), true)(req, res, next));
router.get("/archives", endpoint(async (req, res) => {
  role(req, ["admin","super_admin","purok_leader"]);
  const records: any[] = [];
  for (const [entity, definition] of Object.entries(archiveDefinitions)) {
    if (!definition.roles.includes(req.user!.role)) continue;
    // Reuse each entity's joins/scope; only identifiers from this allowlist enter SQL.
    const from = definition.query.slice(definition.query.indexOf(" FROM "));
    const base = from.slice(0, from.lastIndexOf(" WHERE "));
    const alias = entity === "bins" ? "gb" : entity === "inspections" ? "bi" : entity === "members" ? "m" : entity === "users" ? "u" : entity === "schedules" ? "s" : entity === "endorsements" ? "e" : entity === "complaints" ? "c" : "p";
    const [rows] = entity === "payments"
      ? await db.query<any[]>("SELECT pay.*,a.archived_at,a.archived_by FROM payments pay JOIN payment_archives a ON a.payment_id = pay.id")
      : await db.query<any[]>(`${definition.query.slice(0,definition.query.indexOf(" FROM "))}${base} WHERE ${alias}.archived_at IS NOT NULL`);
    for (const row of rows) if (canAccess(req.user!, row) && !(entity === "users" && row.role === "super_admin")) records.push({entity,id:row.id,label:row.full_name || row.bin_code || row.request_code || row.transaction_code || row.name || `#${row.id}`,archived_at:row.archived_at,archived_by:row.archived_by});
  }
  res.json({archives: records.sort((a,b)=>new Date(b.archived_at).getTime()-new Date(a.archived_at).getTime())});
}));
export default router;
