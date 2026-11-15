import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, REDACTED } from "../lib/redact.mjs";

test("redacts common key formats and secret assignments", () => {
  const cases = [
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    "sk-proj-abcdefghijklmnopqrstuvwxyz0123",
    "xai-abcdefghijklmnopqrstuvwxyz",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "github_pat_11ABCDEFG0abcdefghijklmnop",
    "AKIAABCDEFGHIJKLMNOP",
    "xoxb-1234567890-abcdefghij",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
  ];
  for (const c of cases) assert.equal(redact(`x ${c} y`), `x ${REDACTED} y`, c);
  assert.equal(redact("DB_PASSWORD=hunter2hunter"), `DB_PASSWORD=${REDACTED}`);
  assert.equal(redact('"apiKey": "abcdef123456"'), `"apiKey": "${REDACTED}"`);
  assert.equal(redact("postgres://admin:s3cretpass@db:5432/app"), `postgres://admin:${REDACTED}@db:5432/app`);
  assert.equal(redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123"), `Authorization: ${REDACTED}`);
});

test("leaves ordinary text alone", () => {
  for (const t of ["the token budget is 12", "password reset flow", "see docs/brainium/sessions", "sk-short"]) {
    assert.equal(redact(t), t);
  }
});
