import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Pool } from "mysql2/promise";
import { EmailDomainError } from "./emailDomain.js";
import {
  EMAIL_OTP_EXPIRY_SECONDS,
  EMAIL_OTP_MAX_ATTEMPTS,
  EMAIL_OTP_RESEND_SECONDS,
  VerificationError,
} from "./emailVerification.js";
import {
  createPendingRegistrationService,
  type PendingRegistrationInput,
} from "./pendingRegistration.js";

interface StagedRow extends PendingRegistrationInput {
  otp_hash: string;
  registration_token_hash: string;
  attempt_count: number;
  expires_at: Date;
  created_at: Date;
}

interface UserRow extends PendingRegistrationInput {
  id: number;
  role: string;
  status: string;
  email_verified_at: Date | null;
}

interface Store {
  requests: Map<string, StagedRow>;
  users: UserRow[];
}

const resident: PendingRegistrationInput = {
  email: "resident@example.test",
  full_name: "Test Resident",
  password_hash: "offline-test-password-hash",
  barangay_id: 4,
  purok_id: 9,
  phone: "09123456789",
  address: "Test Street",
};

/** A transaction has its own snapshot; rollback must discard all mutations. */
function fixture() {
  let state: Store = { requests: new Map(), users: [] };
  let time = Date.UTC(2026, 8, 28, 8);
  let deliveryFails = false;
  let domainError: Error | undefined;
  let locationAvailable = true;
  let failRequestDeletion = false;
  const calls = { connections: 0, commits: 0, rollbacks: 0, releases: 0 };
  const deliveries: Array<{ email: string; name: string; otp: string }> = [];
  const checkedDomains: string[] = [];
  const pool = {
    async getConnection() {
      calls.connections += 1;
      let working: Store | undefined;
      function current() {
        assert.ok(working, "SQL must run inside a transaction");
        return working;
      }
      return {
        async beginTransaction() { working = structuredClone(state); },
        async commit() {
          state = current();
          working = undefined;
          calls.commits += 1;
        },
        async rollback() {
          working = undefined;
          calls.rollbacks += 1;
        },
        release() { calls.releases += 1; },
        async query(sql: string, values: any[]) {
          const store = current();
          if (sql.includes("FROM pending_registrations")) {
            const row = store.requests.get(values[0]);
            return [row ? [structuredClone(row)] : []];
          }
          if (sql.includes("FROM users")) {
            return [store.users.filter(user => user.email.toLowerCase() === values[0])];
          }
          if (sql.includes("FROM puroks")) {
            return [locationAvailable && values[0] === resident.purok_id && values[1] === resident.barangay_id
              ? [{ id: resident.purok_id }] : []];
          }
          throw new Error(`Unexpected test query: ${sql}`);
        },
        async execute(sql: string, values: any[]) {
          const store = current();
          if (sql.includes("INSERT INTO pending_registrations")) {
            const [email, full_name, password_hash, barangay_id, purok_id, phone, address,
              otp_hash, registration_token_hash, expires_at, created_at] = values;
            store.requests.set(email, { email, full_name, password_hash, barangay_id,
              purok_id, phone, address, otp_hash, registration_token_hash, attempt_count: 0, expires_at, created_at });
          } else if (sql.includes("UPDATE pending_registrations SET full_name")) {
            const [full_name, password_hash, barangay_id, purok_id, phone, address,
              otp_hash, registration_token_hash, expires_at, created_at, email] = values;
            Object.assign(store.requests.get(email)!, { full_name, password_hash, barangay_id,
              purok_id, phone, address, otp_hash, registration_token_hash, attempt_count: 0, expires_at, created_at });
          } else if (sql.includes("SET attempt_count = attempt_count + 1")) {
            store.requests.get(values[0])!.attempt_count += 1;
          } else if (sql.includes("UPDATE pending_registrations SET otp_hash")) {
            const [otp_hash, expires_at, created_at, email] = values;
            Object.assign(store.requests.get(email)!, {
              otp_hash, expires_at, created_at, attempt_count: 0,
            });
          } else if (sql.includes("INSERT INTO users")) {
            const [email, full_name, password_hash, barangay_id, purok_id, phone, address,
              status, email_verified_at] = values;
            if (store.users.some(user => user.email.toLowerCase() === email)) {
              throw Object.assign(new Error("Duplicate email"), { code: "ER_DUP_ENTRY" });
            }
            store.users.push({ id: store.users.length + 1, email, full_name, password_hash,
              barangay_id, purok_id, phone, address, role: "resident", status, email_verified_at });
          } else if (sql.includes("DELETE FROM pending_registrations")) {
            if (failRequestDeletion) throw new Error("Simulated request deletion failure");
            store.requests.delete(values[0]);
          } else {
            throw new Error(`Unexpected test mutation: ${sql}`);
          }
          return [{ affectedRows: 1 }];
        },
      };
    },
  } as unknown as Pick<Pool, "getConnection">;
  const service = createPendingRegistrationService({
    pool,
    secret: () => "offline-test-signing-key-never-used-in-production",
    now: () => time,
    checkDomain: async email => {
      checkedDomains.push(email);
      if (domainError) throw domainError;
    },
    sendOtp: async (email, name, otp) => {
      if (deliveryFails) throw new Error("Simulated delivery failure");
      deliveries.push({ email, name, otp });
    },
  });
  return {
    service, calls, deliveries, checkedDomains,
    get state() { return state; },
    get time() { return time; },
    advance(seconds: number) { time += seconds * 1000; },
    failDelivery() { deliveryFails = true; },
    rejectDomain(error: Error) { domainError = error; },
    removeLocation() { locationAvailable = false; },
    failDeletion() { failRequestDeletion = true; },
  };
}

function hasCode(code: string, status?: number) {
  return (error: unknown) => error instanceof VerificationError &&
    error.code === code && (status === undefined || error.status === status);
}

function wrongCode(actual: string) {
  return actual === "000000" ? "000001" : "000000";
}

test("registration sends an OTP and stores only a request, never an account", async () => {
  const f = fixture();
  const result = await f.service.startPendingRegistration({ ...resident, email: " Resident@EXAMPLE.test " });

  assert.equal(f.state.users.length, 0);
  assert.equal(f.state.requests.size, 1);
  assert.deepEqual(f.checkedDomains, [resident.email]);
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].email, resident.email);
  assert.match(f.deliveries[0].otp, /^\d{6}$/);
  const request = f.state.requests.get(resident.email)!;
  assert.match(request.otp_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(request.otp_hash, f.deliveries[0].otp);
  assert.match(result.registrationToken, /^[a-f0-9]{64}$/);
  assert.equal(request.registration_token_hash, createHash("sha256").update(result.registrationToken).digest("hex"));
  assert.notEqual(request.registration_token_hash, result.registrationToken);
  assert.equal(request.password_hash, resident.password_hash);
  assert.equal(request.expires_at.getTime(), f.time + EMAIL_OTP_EXPIRY_SECONDS * 1000);
  assert.equal(result.resendAfter, EMAIL_OTP_RESEND_SECONDS);
  assert.deepEqual(f.calls, { connections: 1, commits: 1, rollbacks: 0, releases: 1 });
});

test("correct OTP creates one verified resident, consumes the request, and cannot create another", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  const result = await f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, registration.registrationToken);

  assert.equal(result?.status, "active");
  assert.equal(f.state.users.length, 1);
  assert.deepEqual(f.state.users[0], {
    ...resident, id: 1, role: "resident", status: "active", email_verified_at: new Date(f.time),
  });
  assert.equal(f.state.requests.size, 0);
  assert.equal(await f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, registration.registrationToken), null);
  assert.equal(f.state.users.length, 1);
  assert.equal(f.calls.releases, f.calls.connections);
});

test("incorrect OTP attempts are committed and five failures block even the correct code", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  const code = f.deliveries[0].otp;
  for (let attempt = 1; attempt <= EMAIL_OTP_MAX_ATTEMPTS; attempt += 1) {
    await assert.rejects(f.service.verifyPendingRegistration(resident.email, wrongCode(code), registration.registrationToken), hasCode("INVALID_OTP", 400));
    assert.equal(f.state.requests.get(resident.email)!.attempt_count, attempt);
    assert.equal(f.calls.commits, attempt + 1);
  }
  await assert.rejects(f.service.verifyPendingRegistration(resident.email, code, registration.registrationToken), hasCode("OTP_ATTEMPTS_EXCEEDED", 429));
  assert.equal(f.state.users.length, 0);
  assert.equal(f.state.requests.get(resident.email)!.attempt_count, EMAIL_OTP_MAX_ATTEMPTS);
  assert.equal(f.calls.releases, f.calls.connections);
});

test("an OTP expires exactly at its deadline without creating an account", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  f.advance(EMAIL_OTP_EXPIRY_SECONDS);
  await assert.rejects(f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, registration.registrationToken), hasCode("OTP_EXPIRED", 400));
  assert.equal(f.state.users.length, 0);
  assert.equal(f.state.requests.get(resident.email)!.attempt_count, 0);
});

test("resend enforces its cooldown, replaces the code, and resets exhausted attempts", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  const originalTokenHash = f.state.requests.get(resident.email)!.registration_token_hash;
  const oldCode = f.deliveries[0].otp;
  f.advance(EMAIL_OTP_RESEND_SECONDS - 1);
  await assert.rejects(f.service.resendPendingRegistration(resident.email, registration.registrationToken), error =>
    hasCode("OTP_RESEND_COOLDOWN", 429)(error) && (error as VerificationError).retryAfterSeconds === 1);
  assert.equal(f.deliveries.length, 1);
  for (let attempt = 0; attempt < EMAIL_OTP_MAX_ATTEMPTS; attempt += 1) {
    await assert.rejects(f.service.verifyPendingRegistration(resident.email, wrongCode(oldCode), registration.registrationToken), hasCode("INVALID_OTP"));
  }
  f.advance(1);
  await f.service.resendPendingRegistration(resident.email, registration.registrationToken);
  const newCode = f.deliveries[1].otp;
  assert.notEqual(newCode, oldCode);
  assert.equal(f.state.requests.get(resident.email)!.attempt_count, 0);
  assert.equal(f.state.requests.get(resident.email)!.registration_token_hash, originalTokenHash);
  assert.equal(f.state.requests.get(resident.email)!.expires_at.getTime(), f.time + EMAIL_OTP_EXPIRY_SECONDS * 1000);
  await assert.rejects(f.service.verifyPendingRegistration(resident.email, oldCode, registration.registrationToken), hasCode("INVALID_OTP"));
  await f.service.verifyPendingRegistration(resident.email, newCode, registration.registrationToken);
  assert.equal(f.state.users.length, 1);
});

test("failed initial email delivery rolls back the staged registration", async () => {
  const f = fixture();
  f.failDelivery();
  await assert.rejects(f.service.startPendingRegistration(resident), hasCode("EMAIL_DELIVERY_FAILED", 503));
  assert.equal(f.state.requests.size, 0);
  assert.equal(f.state.users.length, 0);
  assert.deepEqual(f.calls, { connections: 1, commits: 0, rollbacks: 1, releases: 1 });
});

test("failed resend preserves the old request and its usable OTP", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  const original = structuredClone(f.state.requests.get(resident.email));
  f.advance(EMAIL_OTP_RESEND_SECONDS);
  f.failDelivery();
  await assert.rejects(f.service.resendPendingRegistration(resident.email, registration.registrationToken), hasCode("EMAIL_DELIVERY_FAILED", 503));
  assert.deepEqual(f.state.requests.get(resident.email), original);
  await f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, registration.registrationToken);
  assert.equal(f.state.users.length, 1);
});

test("invalid email format and rejected mail domain fail before opening a database connection", async () => {
  const f = fixture();
  await assert.rejects(f.service.startPendingRegistration({ ...resident, email: "not-an-email" }), hasCode("EMAIL_VERIFICATION_ERROR", 400));
  assert.equal(f.checkedDomains.length, 0);
  f.rejectDomain(new EmailDomainError("Domain cannot receive mail.", 400, "EMAIL_DOMAIN_NO_MAIL"));
  await assert.rejects(f.service.startPendingRegistration(resident), hasCode("EMAIL_DOMAIN_NO_MAIL", 400));
  assert.equal(f.calls.connections, 0);
  assert.equal(f.deliveries.length, 0);
  assert.equal(f.state.requests.size, 0);
});

test("an already registered email cannot open another signup request", async () => {
  const f = fixture();
  f.state.users.push({ ...resident, id: 30, role: "resident", status: "active", email_verified_at: new Date(f.time) });
  await assert.rejects(f.service.startPendingRegistration({ ...resident, email: resident.email.toUpperCase() }), hasCode("ER_DUP_ENTRY", 409));
  assert.equal(f.state.users.length, 1);
  assert.equal(f.state.requests.size, 0);
  assert.equal(f.deliveries.length, 0);
});

test("verification clears a request shadowed by an existing account and permits its original OTP flow", async () => {
  const f = fixture();
  await f.service.startPendingRegistration(resident);
  f.state.users.push({ ...resident, id: 30, role: "resident", status: "active", email_verified_at: new Date(f.time) });
  assert.equal(await f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp), null);
  assert.equal(f.state.users.length, 1);
  assert.equal(f.state.users[0].id, 30);
  assert.equal(f.state.requests.size, 0);
});

test("repeated signup during cooldown rejects without overwriting the pending credentials", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  const original = structuredClone(f.state.requests.get(resident.email));
  f.advance(EMAIL_OTP_RESEND_SECONDS - 1);
  await assert.rejects(f.service.startPendingRegistration({
    ...resident, password_hash: "different-password-hash", full_name: "Different Name", address: "Different address",
  }), hasCode("OTP_RESEND_COOLDOWN", 429));
  assert.deepEqual(f.state.requests.get(resident.email), original);
  assert.equal(f.deliveries.length, 1);
  await f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, registration.registrationToken);
  assert.equal(f.state.users[0].password_hash, resident.password_hash);
  assert.equal(f.state.users[0].full_name, resident.full_name);
});

test("fresh signup after cooldown replaces credentials and invalidates the earlier OTP together", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  f.advance(EMAIL_OTP_RESEND_SECONDS);
  const updated = { ...resident, password_hash: "updated-password-hash", full_name: "Updated Resident", address: "Updated address" };
  const replacement = await f.service.startPendingRegistration(updated);
  assert.notEqual(replacement.registrationToken, registration.registrationToken);
  assert.equal(f.deliveries.length, 2);
  assert.notEqual(f.deliveries[0].otp, f.deliveries[1].otp);
  assert.equal(f.state.users.length, 0);
  await assert.rejects(f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, replacement.registrationToken), hasCode("INVALID_OTP"));
  await f.service.verifyPendingRegistration(resident.email, f.deliveries[1].otp, replacement.registrationToken);
  assert.equal(f.state.users[0].password_hash, updated.password_hash);
  assert.equal(f.state.users[0].full_name, updated.full_name);
  assert.equal(f.state.users[0].address, updated.address);
});

test("failed replacement delivery preserves the original credentials and OTP", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  const original = structuredClone(f.state.requests.get(resident.email));
  f.advance(EMAIL_OTP_RESEND_SECONDS);
  f.failDelivery();
  await assert.rejects(f.service.startPendingRegistration({ ...resident, password_hash: "replacement-password-hash" }), hasCode("EMAIL_DELIVERY_FAILED"));
  assert.deepEqual(f.state.requests.get(resident.email), original);
  await f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, registration.registrationToken);
  assert.equal(f.state.users[0].password_hash, resident.password_hash);
});

test("expired registration can restart with new credentials and a fresh OTP", async () => {
  const f = fixture();
  await f.service.startPendingRegistration(resident);
  f.advance(EMAIL_OTP_EXPIRY_SECONDS);
  const replacement = await f.service.startPendingRegistration({ ...resident, password_hash: "replacement-password-hash" });
  assert.equal(f.deliveries.length, 2);
  assert.notEqual(f.deliveries[0].otp, f.deliveries[1].otp);
  assert.equal(f.state.users.length, 0);
  await assert.rejects(f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, replacement.registrationToken), hasCode("INVALID_OTP"));
  await f.service.verifyPendingRegistration(resident.email, f.deliveries[1].otp, replacement.registrationToken);
  assert.equal(f.state.users[0].password_hash, "replacement-password-hash");
});

test("Google signup without a profile creates a verified pending account only after OTP", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration({
    ...resident, barangay_id: null, purok_id: null, phone: null, address: null,
  });
  assert.equal(f.state.users.length, 0);
  const result = await f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, registration.registrationToken);
  assert.equal(result?.status, "pending");
  assert.equal(f.state.users.length, 1);
  assert.equal(f.state.users[0].role, "resident");
  assert.equal(f.state.users[0].status, "pending");
  assert.deepEqual(f.state.users[0].email_verified_at, new Date(f.time));
  assert.equal(f.state.requests.size, 0);
});

test("missing staged requests return null for legacy account verification and resend", async () => {
  const f = fixture();
  f.state.users.push({ ...resident, id: 30, role: "admin", status: "pending", email_verified_at: null });
  assert.equal(await f.service.verifyPendingRegistration(resident.email, "123456"), null);
  assert.equal(await f.service.resendPendingRegistration(resident.email), null);
  assert.equal(f.state.users.length, 1);
  assert.equal(f.state.users[0].status, "pending");
  assert.equal(f.deliveries.length, 0);
});

test("resend clears a request shadowed by an existing staff account before the legacy flow", async () => {
  const f = fixture();
  await f.service.startPendingRegistration(resident);
  f.state.users.push({ ...resident, id: 30, role: "admin", status: "pending", email_verified_at: null });
  assert.equal(await f.service.resendPendingRegistration(resident.email), null);
  assert.equal(f.state.requests.size, 0);
  assert.equal(f.state.users[0].role, "admin");
  assert.equal(f.state.users[0].email_verified_at, null);
  assert.equal(f.deliveries.length, 1);
});

test("an unavailable service area prevents account creation even with the right OTP", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  f.removeLocation();
  await assert.rejects(f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, registration.registrationToken), hasCode("REGISTRATION_LOCATION_UNAVAILABLE", 400));
  assert.equal(f.state.users.length, 0);
  assert.equal(f.state.requests.size, 0);
  assert.equal(f.calls.commits, 2);
  await f.service.startPendingRegistration(resident);
  assert.equal(f.deliveries.length, 2);
});

test("account creation rolls back if consuming the request fails", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  f.failDeletion();
  await assert.rejects(f.service.verifyPendingRegistration(resident.email, f.deliveries[0].otp, registration.registrationToken), /Simulated request deletion failure/);
  assert.equal(f.state.users.length, 0);
  assert.equal(f.state.requests.size, 1);
  assert.equal(f.calls.rollbacks, 1);
  assert.equal(f.calls.releases, f.calls.connections);
});

test("verification and resend reject missing or mismatched registration tokens without spending OTP attempts", async () => {
  const f = fixture();
  const registration = await f.service.startPendingRegistration(resident);
  const code = f.deliveries[0].otp;
  const incorrectToken = registration.registrationToken === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64);
  f.advance(EMAIL_OTP_RESEND_SECONDS);
  const original = structuredClone(f.state.requests.get(resident.email));

  for (const token of [undefined, "", "malformed-token", incorrectToken]) {
    await assert.rejects(f.service.verifyPendingRegistration(resident.email, code, token), hasCode("REGISTRATION_RESTART_REQUIRED", 409));
    await assert.rejects(f.service.resendPendingRegistration(resident.email, token), hasCode("REGISTRATION_RESTART_REQUIRED", 409));
    assert.deepEqual(f.state.requests.get(resident.email), original);
  }
  assert.equal(f.state.users.length, 0);
  assert.equal(f.deliveries.length, 1);
  await f.service.verifyPendingRegistration(resident.email, code, registration.registrationToken);
  assert.equal(f.state.users.length, 1);
});

test("a victim cannot accidentally verify an attacker's replacement credentials using the newest email code", async () => {
  const f = fixture();
  const victim = await f.service.startPendingRegistration(resident);
  f.advance(EMAIL_OTP_RESEND_SECONDS);
  const attacker = await f.service.startPendingRegistration({
    ...resident, password_hash: "attacker-selected-password-hash", full_name: "Attacker Name",
  });
  const newestCode = f.deliveries[1].otp;

  assert.notEqual(victim.registrationToken, attacker.registrationToken);
  await assert.rejects(f.service.verifyPendingRegistration(resident.email, newestCode, victim.registrationToken), hasCode("REGISTRATION_RESTART_REQUIRED", 409));
  await assert.rejects(f.service.resendPendingRegistration(resident.email, victim.registrationToken), hasCode("REGISTRATION_RESTART_REQUIRED", 409));
  assert.equal(f.state.requests.get(resident.email)!.attempt_count, 0);
  assert.equal(f.state.users.length, 0);

  // The mailbox owner restarts with their own details and verifies that new request.
  f.advance(EMAIL_OTP_RESEND_SECONDS);
  const restarted = await f.service.startPendingRegistration(resident);
  await assert.rejects(f.service.verifyPendingRegistration(resident.email, f.deliveries[2].otp, attacker.registrationToken), hasCode("REGISTRATION_RESTART_REQUIRED", 409));
  assert.equal(f.state.requests.get(resident.email)!.attempt_count, 0);
  await f.service.verifyPendingRegistration(resident.email, f.deliveries[2].otp, restarted.registrationToken);
  assert.equal(f.state.users.length, 1);
  assert.equal(f.state.users[0].password_hash, resident.password_hash);
  assert.equal(f.state.users[0].full_name, resident.full_name);
});
