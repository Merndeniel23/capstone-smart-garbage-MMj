import type { PoolConnection } from "mysql2/promise";
import { DomainError, revisionsEnabled } from "./sgms.js";

export async function snapshotEndorsement(connection: PoolConnection, request: any, leaderName: string, certificateNumber: string) {
  if (!revisionsEnabled()) return;
  const [templates] = await connection.query<any[]>("SELECT body FROM barangay_endorsement_templates WHERE barangay_id = ? ORDER BY id DESC LIMIT 1", [request.barangay_id]);
  if (!templates[0]) throw new DomainError("An officially approved endorsement template must be configured before issuing PDFs.", 409);
  const [residents] = await connection.query<any[]>(`SELECT u.full_name, u.address, u.email, u.phone, b.name AS barangay_name, p.name AS purok_name, DATE_FORMAT(NOW(), '%Y-%m-%d') AS issue_date
    FROM users u JOIN puroks p ON p.id = u.purok_id JOIN barangays b ON b.id = u.barangay_id AND b.id = p.barangay_id
    WHERE u.id = ? AND u.role = 'resident' AND u.status = 'active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND p.archived_at IS NULL
      AND u.barangay_id = ? AND u.purok_id = ? FOR UPDATE`, [request.requester_id, request.barangay_id, request.purok_id]);
  const resident = residents[0];
  if (!resident) throw new DomainError("Verify the resident's active account and current household assignment before approval.", 409);
  const values: Record<string,string> = {resident_name:resident.full_name,address:resident.address || "",barangay:resident.barangay_name,purok:resident.purok_name,purpose:request.purpose,leader_name:leaderName,certificate_number:certificateNumber,issue_date:resident.issue_date};
  const document = String(templates[0].body).replace(/\{\{([^}]+)\}\}/g, (_match,key)=>values[key.trim()] ?? "");
  // The dependency-free PDF uses WinAnsi. Reject unsupported text instead of
  // silently changing a resident's name or officially approved document.
  if (/[^\x09\x0a\x0d\x20-\xff\u2018-\u201d\u2013\u2014]/.test(document)) throw new DomainError("This template requires a Unicode-capable PDF font. Configure that support before issuance.", 409);
  await connection.execute(`UPDATE endorsement_requests SET issued_document_text = ?, requester_name_snapshot = ?, requester_address_snapshot = ?, requester_email_snapshot = ?, requester_phone_snapshot = ?, barangay_name_snapshot = ?, purok_name_snapshot = ? WHERE id = ?`, [document,resident.full_name,resident.address,resident.email,resident.phone,resident.barangay_name,resident.purok_name,request.id]);
}
