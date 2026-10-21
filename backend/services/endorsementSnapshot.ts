import type { PoolConnection } from "mysql2/promise";
import { DomainError, revisionsEnabled } from "./sgms.js";
import { hasEndorsementDraftMarkers, unsupportedEndorsementPlaceholders } from "../../shared/endorsementTemplate.js";

export async function snapshotEndorsement(connection: PoolConnection, request: any, leaderName: string, certificateNumber: string) {
  if (!revisionsEnabled()) return;
  const [templates] = await connection.query<any[]>("SELECT body FROM barangay_endorsement_templates WHERE barangay_id = ? ORDER BY id DESC LIMIT 1", [request.barangay_id]);
  if (!templates[0]) throw new DomainError("An officially approved endorsement template must be configured before issuing PDFs.", 409);
  const template = String(templates[0].body);
  if (hasEndorsementDraftMarkers(template) || unsupportedEndorsementPlaceholders(template).length) throw new DomainError("Replace the draft or invalid template with an officially approved version before issuance.", 409);
  const [residents] = await connection.query<any[]>(`SELECT u.full_name, u.address, u.email, u.phone, b.name AS barangay_name, p.name AS purok_name, DATE_FORMAT(NOW(), '%Y-%m-%d') AS issue_date
    FROM users u JOIN puroks p ON p.id = u.purok_id JOIN barangays b ON b.id = u.barangay_id AND b.id = p.barangay_id
    WHERE u.id = ? AND u.role = 'resident' AND u.status = 'active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND p.archived_at IS NULL
      AND u.barangay_id = ? AND u.purok_id = ? FOR UPDATE`, [request.requester_id, request.barangay_id, request.purok_id]);
  const resident = residents[0];
  if (!resident) throw new DomainError("Verify the resident's active account and current household assignment before approval.", 409);
  const values: Record<string,string> = {resident_name:resident.full_name,address:resident.address || "",barangay:resident.barangay_name,purok:resident.purok_name,purpose:request.purpose,leader_name:leaderName,certificate_number:certificateNumber,issue_date:resident.issue_date};
  const document = template.replace(/\{\{([^}]+)\}\}/g, (_match,key) => {
    const value = values[key.trim()];
    if (!value?.trim()) throw new DomainError("Complete the verified resident and request details required by the approved template.", 409);
    return value;
  });
  // Preserve Unicode exactly. Direct PDFs use WinAnsi; the authenticated
  // approved-document print view offers a Unicode Save as PDF fallback.
  if (Buffer.byteLength(document, "utf8") > 60_000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(document)) throw new DomainError("The approved document is too large or contains unsupported control characters.", 409);
  await connection.execute(`UPDATE endorsement_requests SET issued_document_text = ?, requester_name_snapshot = ?, requester_address_snapshot = ?, requester_email_snapshot = ?, requester_phone_snapshot = ?, barangay_name_snapshot = ?, purok_name_snapshot = ? WHERE id = ?`, [document,resident.full_name,resident.address,resident.email,resident.phone,resident.barangay_name,resident.purok_name,request.id]);
}
