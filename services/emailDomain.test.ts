import test from "node:test";
import assert from "node:assert/strict";
import {
  assertEmailDomainAcceptsMail,
  EmailDomainError,
  type EmailDomainResolver,
} from "./emailDomain.ts";

function dnsFailure(code: string): never {
  throw Object.assign(new Error("DNS lookup failed"), { code });
}

function resolver(overrides: Partial<EmailDomainResolver> = {}): EmailDomainResolver {
  return {
    resolveMx: async () => [{ exchange: "mx.example.test", priority: 10 }],
    resolve4: async () => dnsFailure("ENODATA"),
    resolve6: async () => dnsFailure("ENODATA"),
    ...overrides,
  };
}

const isError = (code: string, status: number) => (error: unknown) => {
  assert.ok(error instanceof EmailDomainError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  return true;
};

test("malformed addresses are rejected without a DNS query", async () => {
  let queries = 0;
  const dns = resolver({ resolveMx: async () => { queries++; return []; } });
  for (const email of [
    "not-an-email", "name@@example.test", "name@example", "name @example.test",
    "name@example..test", "name@-example.test", "name@example-.test",
    "name@example.test/path", "name@example.test:25", "name@example.test?x",
    "name@example.test%00", ".name@example.test", "name..one@example.test",
    "name. @example.test", "Name<name>@example.test", `${"a".repeat(65)}@example.test`,
    `name@${"a".repeat(64)}.test`, `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(30)}`,
  ]) {
    await assert.rejects(assertEmailDomainAcceptsMail(email, dns), isError("INVALID_EMAIL", 400));
  }
  assert.equal(queries, 0);
});

test("normal MX records accept custom domains and plus addresses without probing the mailbox", async () => {
  await assertEmailDomainAcceptsMail("resident+tag@custom.example.test", resolver({
    resolveMx: async domain => {
      assert.equal(domain, "custom.example.test");
      return [{ exchange: "mx.example.test", priority: 10 }];
    },
    resolve4: async () => { assert.fail("MX domain does not need address fallback"); },
    resolve6: async () => { assert.fail("MX domain does not need address fallback"); },
  }));
});

test("international domain names are converted to their DNS representation", async () => {
  await assertEmailDomainAcceptsMail("resident@bücher.test", resolver({
    resolveMx: async domain => {
      assert.equal(domain, "xn--bcher-kva.test");
      return [{ exchange: "mx.example.test", priority: 10 }];
    },
  }));
});

test("nonexistent domains are rejected without falling back to address records", async () => {
  await assert.rejects(assertEmailDomainAcceptsMail("resident@missing.test", resolver({
    resolveMx: async () => dnsFailure("ENOTFOUND"),
    resolve4: async () => { assert.fail("NXDOMAIN must not fall back"); },
  })), isError("EMAIL_DOMAIN_NO_MAIL", 400));
});

test("null MX rejects mail even when the domain has a web server", async () => {
  for (const exchange of ["", "."]) {
    await assert.rejects(assertEmailDomainAcceptsMail("resident@example.test", resolver({
      resolveMx: async () => [{ exchange, priority: 0 }],
      resolve4: async () => { assert.fail("Null MX must not fall back"); },
    })), isError("EMAIL_DOMAIN_NO_MAIL", 400));
  }
});

test("absent MX permits implicit IPv4 and IPv6 delivery", async () => {
  await assertEmailDomainAcceptsMail("resident@example.test", resolver({
    resolveMx: async () => dnsFailure("ENODATA"),
    resolve4: async () => ["192.0.2.1"],
  }));
  await assertEmailDomainAcceptsMail("resident@example.test", resolver({
    resolveMx: async () => [],
    resolve6: async () => ["2001:db8::1"],
  }));
});

test("domains with neither MX nor address records are rejected", async () => {
  await assert.rejects(assertEmailDomainAcceptsMail("resident@example.test", resolver({
    resolveMx: async () => dnsFailure("ENODATA"),
  })), isError("EMAIL_DOMAIN_NO_MAIL", 400));
});

test("DNS outages produce retryable errors, not claims that the email is fake", async () => {
  for (const code of ["ETIMEOUT", "ESERVFAIL", "EREFUSED", "ECANCELLED"]) {
    await assert.rejects(assertEmailDomainAcceptsMail("resident@example.test", resolver({
      resolveMx: async () => dnsFailure(code),
    })), isError("EMAIL_DOMAIN_CHECK_UNAVAILABLE", 503));
  }
  await assert.rejects(assertEmailDomainAcceptsMail("resident@example.test", resolver({
    resolveMx: async () => [],
    resolve6: async () => dnsFailure("ETIMEOUT"),
  })), isError("EMAIL_DOMAIN_CHECK_UNAVAILABLE", 503));
});

test("one working address family suffices when the other lookup fails temporarily", async () => {
  await assertEmailDomainAcceptsMail("resident@example.test", resolver({
    resolveMx: async () => [],
    resolve4: async () => dnsFailure("ETIMEOUT"),
    resolve6: async () => ["2001:db8::1"],
  }));
});
