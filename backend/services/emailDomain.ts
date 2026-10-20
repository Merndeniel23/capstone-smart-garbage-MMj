import { Resolver } from "node:dns/promises";
import { domainToASCII } from "node:url";

export type EmailDomainErrorCode =
  | "INVALID_EMAIL"
  | "EMAIL_DOMAIN_NO_MAIL"
  | "EMAIL_DOMAIN_CHECK_UNAVAILABLE";

export class EmailDomainError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: EmailDomainErrorCode,
  ) {
    super(message);
    this.name = "EmailDomainError";
  }
}

export interface EmailDomainResolver {
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

function invalidEmail(): never {
  throw new EmailDomainError("Enter a valid email address.", 400, "INVALID_EMAIL");
}

function noMail(): never {
  throw new EmailDomainError(
    "This email domain does not accept email. Check the address and try again.",
    400,
    "EMAIL_DOMAIN_NO_MAIL",
  );
}

function unavailable(): never {
  throw new EmailDomainError(
    "We could not check this email domain right now. Please try again shortly.",
    503,
    "EMAIL_DOMAIN_CHECK_UNAVAILABLE",
  );
}

function dnsCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function emailDomain(email: string): string {
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalidEmail();
  const [local, rawDomain] = email.split("@");
  // The app accepts plain mailbox addresses, without display names or comments.
  if (Buffer.byteLength(local, "utf8") > 64 || /[\x00-\x20\x7f<>()[\]\\,;:"]/.test(local) ||
    local.startsWith(".") || local.endsWith(".") || local.includes("..")) invalidEmail();
  // Validate before URL-based IDNA conversion, which otherwise accepts URL separators.
  if (/[\x00-\x20\x7f:/\\?#@%]/.test(rawDomain)) invalidEmail();
  const domain = domainToASCII(rawDomain).toLowerCase();
  const labels = domain.split(".");
  if (!domain || domain.length > 253 || labels.length < 2 || labels.some(label =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) invalidEmail();
  return domain;
}

/** Checks domain mail routing only. A successful check does not prove the mailbox
 * exists or belongs to the registrant; the email OTP is still required. */
export async function assertEmailDomainAcceptsMail(
  email: string,
  resolver: EmailDomainResolver = new Resolver({ timeout: 3000, tries: 1 }),
): Promise<void> {
  const domain = emailDomain(email);
  let mx: Array<{ exchange: string; priority: number }>;
  try {
    mx = await resolver.resolveMx(domain);
  } catch (error) {
    if (dnsCode(error) === "ENOTFOUND") noMail();
    if (dnsCode(error) !== "ENODATA") unavailable();
    mx = [];
  }

  if (mx.length > 0) {
    // RFC 7505: a null MX explicitly refuses mail, even if A/AAAA records exist.
    // c-ares may expose the DNS root exchange as an empty string instead of ".".
    if (!mx.some(record => record.exchange !== "" && record.exchange !== ".")) noMail();
    return;
  }

  // RFC 5321 section 5.1 permits delivery to A/AAAA when no MX is published.
  const addresses = await Promise.allSettled([
    resolver.resolve4(domain),
    resolver.resolve6(domain),
  ]);
  if (addresses.some(result => result.status === "fulfilled" && result.value.length > 0)) return;
  if (addresses.some(result => result.status === "rejected" &&
    !["ENODATA", "ENOTFOUND"].includes(dnsCode(result.reason) || ""))) unavailable();
  noMail();
}
