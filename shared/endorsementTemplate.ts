export const ENDORSEMENT_PLACEHOLDERS = [
  "resident_name", "address", "barangay", "purok", "purpose",
  "leader_name", "certificate_number", "issue_date",
] as const;

// Deliberately incomplete. Neither this outline nor its placeholders constitute
// an approved barangay policy, endorsement statement or authorized signature.
export const DRAFT_ENDORSEMENT_TEMPLATE = `SGMS DRAFT - NOT FOR ISSUANCE

ENDORSEMENT OUTLINE FOR BARANGAY REVIEW
Reference: {{certificate_number}}
Date: {{issue_date}}

Resident: {{resident_name}}
Registered address: {{address}}
Barangay: {{barangay}}
Purok: {{purok}}

Requested purpose:
{{purpose}}

[OFFICIAL ENDORSEMENT WORDING REQUIRED]

[AUTHORIZED SIGNATORY DETAILS REQUIRED]
Purok Leader recorded by SGMS: {{leader_name}}

Review and replace all draft notices with officially approved content before issuance.`;

export function unsupportedEndorsementPlaceholders(body: string): string[] {
  return [...body.matchAll(/\{\{([^}]+)\}\}/g)]
    .map(match => match[1].trim())
    .filter(key => !(ENDORSEMENT_PLACEHOLDERS as readonly string[]).includes(key));
}

export function hasEndorsementDraftMarkers(body: string): boolean {
  return /SGMS DRAFT|NOT FOR ISSUANCE|\[(?:OFFICIAL ENDORSEMENT WORDING|AUTHORIZED SIGNATORY DETAILS) REQUIRED\]/i.test(body);
}
